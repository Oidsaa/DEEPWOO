/**
 * Response cache for the WooCommerce client (main process) with disk persistence.
 *
 * Every read IPC handler funnels its result through cachedRun(), so navigating
 * between views in the same session reuses the last response instead of
 * re-downloading the store. Entries expire after a per-endpoint TTL and are
 * invalidated by bumpCacheVersion() whenever the app WRITES to the store
 * (orders, customers, products, settings) — the next read then fetches fresh
 * data automatically. Manual refresh buttons additionally call clearCaches()
 * through the preload bridge so the user can force a resync.
 *
 * PERSISTENCE: the cache is snapshotted to <userData>/wc-cache.json (debounced
 * writes + a final flush on quit), so relaunching the app does not throw the
 * session cache away. On startup initCache() hydrates the in-memory store:
 *  - entries still inside their hot TTL behave exactly as if the app had
 *    never closed (served instantly, no request);
 *  - entries that expired while the app was closed but are younger than
 *    STALE_MAX_MS are served ONCE immediately (fast cold start) while a
 *    background refresh re-validates them — the next read of that key is
 *    fresh. If the refresh fails the stale copy is kept and retried later;
 *  - anything older than STALE_MAX_MS is dropped and refetched normally.
 *
 * Only successful results are stored — errors are never cached.
 */

import fs from 'node:fs'
import path from 'node:path'

interface Entry {
  value: unknown
  /** Hot expiry (fetch time + endpoint TTL) — governs in-session freshness. */
  expiresAt: number
  /** >0 → serve this (possibly stale) copy on cold start while refreshing. */
  staleUntil: number
  /** Version of the cache when the entry was stored (see bumpCacheVersion). */
  version: number
  /** Insertion/fetch timestamp — used for disk horizon + oldest-first eviction. */
  at: number
}

interface DiskEntry {
  k: string
  value: unknown
  expiresAt: number
  staleUntil: number
  version: number
  at: number
}

interface DiskFile {
  schema: number
  version: number
  savedAt: number
  entries: DiskEntry[]
  /** Incremental-sync cursors per cache key (see syncMarks). */
  marks?: Record<string, number>
}

/** Bump when the on-disk format changes (old files are ignored). */
const SCHEMA = 2
/** Oldest disk snapshot we are willing to serve on a cold start. */
const STALE_MAX_MS = 12 * 60 * 60 * 1000 // 12h
/** Debounce between cache mutations and their disk snapshot. */
const SAVE_DEBOUNCE_MS = 500
/** Minimum gap between two background refreshes of the same key. */
const REFRESH_MIN_GAP_MS = 60_000

const STORE = new Map<string, Entry>()
const MAX_ENTRIES = 500
let version = 0
let filePath: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
/** Loader runs per key, shared by concurrent readers (cold miss + SWR refresh). */
const inflight = new Map<string, Promise<unknown>>()
const lastRefresh = new Map<string, number>()

/** Usage counters + real store-sync stamps per endpoint prefix (UI «آخرین همگام‌سازی»). */
let hits = 0
let misses = 0
let staleServes = 0
let fetches = 0
const syncedAt = new Map<string, number>()

/**
 * Incremental-sync cursors (ms epoch) per cache key. They survive version
 * bumps (external changes are picked up by the next modified_after delta) but
 * are cleared together with the values on a manual refresh (clearCaches) so
 * the next sync re-baselines with a full walk. Persisted alongside the entries.
 */
const syncMarks = new Map<string, number>()

/** Last incremental-sync cursor stored for `key` (undefined → full fetch). */
export function getSyncMark(key: string): number | undefined {
  return syncMarks.get(key)
}

/** Store the new sync cursor for `key` (call after a successful sync only). */
export function setSyncMark(key: string, atMs: number): void {
  syncMarks.set(key, atMs)
  scheduleSave()
}

/** Snapshot of the cache statistics shown by the status IPC / UI badge. */
export interface CacheStatus {
  /** Reads served from a fresh in-memory entry. */
  hits: number
  /** Reads that had to invoke the store loader. */
  misses: number
  /** Cold-start reads served from a disk snapshot (refreshed in the background). */
  staleServes: number
  /** Successful store fetches (fresh loads + background refreshes). */
  fetches: number
  /** Live cache entries (memory). */
  size: number
  /** Last time each endpoint prefix was really fetched from the store (ms epoch). */
  syncedAt: Record<string, number>
}

export function cacheStatus(): CacheStatus {
  return {
    hits,
    misses,
    staleServes,
    fetches,
    size: STORE.size,
    syncedAt: Object.fromEntries(syncedAt),
  }
}

/** Endpoint prefix of a cache key ('customers:[…]' → 'customers'). */
function prefixOf(key: string): string {
  const i = key.indexOf(':')
  return i > 0 ? key.slice(0, i) : key
}

/**
 * Run `loader`, serving a still-fresh entry when one exists for `key`. On a
 * miss (and on background revalidations) the loader receives the PREVIOUS
 * value — `undefined` when none exists — so snapshot loaders can merge
 * incremental changes (modified_after deltas) instead of re-downloading the
 * whole store. The previous value is passed even when version-stale: a write
 * invalidates freshness, not the data itself.
 */
export function cachedRun<T>(key: string, ttlMs: number, loader: (prev?: T) => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = STORE.get(key)
  if (hit && hit.version === version && now < hit.expiresAt) {
    hits += 1
    return Promise.resolve(hit.value as T)
  }
  // Stale-while-revalidate: the entry expired (in-session or on cold start)
  // but is young enough to be trustworthy — serve it instantly while a
  // background refresh re-validates it. Filter clicks and pagination thus
  // NEVER wait for the store as long as a recent snapshot exists.
  const staleHorizon = Math.max(hit?.staleUntil ?? 0, (hit?.at ?? 0) + STALE_MAX_MS)
  if (hit && hit.version === version && now < staleHorizon) {
    staleServes += 1
    void refreshInBackground(key, ttlMs, loader)
    return Promise.resolve(hit.value as T)
  }
  return loadAndStore(key, ttlMs, loader) as Promise<T>
}

/**
 * Run the loader ONCE per key and store the result. Concurrent readers of the
 * same key (cold miss, or a read racing a background revalidation) join the
 * running promise instead of duplicating the request — on a slow store this
 * halves visible latency and avoids hammering WooCommerce.
 */
function loadAndStore<T>(key: string, ttlMs: number, loader: (prev?: T) => Promise<T>): Promise<T> {
  const running = inflight.get(key)
  if (running) {
    hits += 1
    return running as Promise<T>
  }
  misses += 1
  const p = loader(STORE.get(key)?.value as T | undefined)
    .then((value) => {
      fetches += 1
      syncedAt.set(prefixOf(key), Date.now())
      STORE.set(key, { value, expiresAt: Date.now() + ttlMs, staleUntil: 0, version, at: Date.now() })
      if (STORE.size > MAX_ENTRIES) evictOldest()
      scheduleSave()
      return value
    })
    .finally(() => {
      inflight.delete(key)
      lastRefresh.set(key, Date.now())
    })
  inflight.set(key, p)
  return p
}

/**
 * Surgical update of the cached orders snapshot after a successful write:
 * replace the order by id (status change) or prepend it (new order), so the
 * orders list stays consistent WITHOUT invalidating the whole snapshot (a
 * full re-walk is expensive on slow stores). Returns true when a live
 * snapshot was patched; false means there is nothing to patch (caller should
 * invalidate normally).
 */
export function patchCachedOrder<T extends { id: number; customer_name?: string }>(order: T): boolean {
  const e = STORE.get('orders-all')
  if (!e || e.version !== version) return false
  const arr = e.value as Array<{ id: number; customer_name?: string }>
  if (!Array.isArray(arr)) return false
  const i = arr.findIndex((o) => o && o.id === order.id)
  if (i >= 0) {
    const old = arr[i]
    // Keep the enriched display name — the write response usually lacks it.
    arr[i] = order.customer_name || !old.customer_name ? order : { ...order, customer_name: old.customer_name }
  } else {
    arr.unshift(order)
  }
  scheduleSave()
  return true
}

/**
 * Surgical update of a cached value WITHOUT invalidating it: the updater
 * folds a fresh write result into the stored value and the entry is
 * re-stamped with the CURRENT cache version. Call it AFTER bumpCacheVersion()
 * for the few keys that carry their own fresh data (e.g. 'warehouses-overview'
 * and the touched 'product-detail') — every other key goes stale as usual.
 * Returns true when a resident entry was patched.
 */
export function patchCacheKeepFresh<T>(key: string, updater: (value: T) => T): boolean {
  const e = STORE.get(key)
  if (!e) return false
  const next = updater(e.value as T)
  if (next === (e.value as T)) return false
  e.value = next
  e.version = version
  scheduleSave()
  return true
}

function refreshInBackground<T>(key: string, ttlMs: number, loader: (prev?: T) => Promise<T>): void {
  const now = Date.now()
  if (now - (lastRefresh.get(key) ?? 0) < REFRESH_MIN_GAP_MS) return
  void loadAndStore(key, ttlMs, loader).catch(() => {
    /* network hiccup on cold start — keep the stale copy, retry later */
  })
}

/** Drop every cached entry immediately (manual «به‌روزرسانی» / force resync). */
export function clearCaches(): void {
  STORE.clear()
  // Sync cursors go too: the next read must re-baseline with a FULL walk so a
  // manual refresh is a genuine resync, not a delta on top of unknown state.
  syncMarks.clear()
  scheduleSave()
}

/**
 * Invalidate every cached entry after a write to the store without dropping
 * them (entries stay resident but are treated as stale — cheaper than a
 * full clear, identical behaviour for readers).
 */
export function bumpCacheVersion(): void {
  version += 1
  if (version > 1_000_000) {
    STORE.clear()
    version = 0
  }
  scheduleSave()
}

/**
 * Drop ONE cache entry (and its sync cursor) — for snapshots a write made
 * genuinely wrong (e.g. the warehouses overview after a stock change) while
 * the rest of the cache stays fresh. The next read of this key fetches for real.
 */
export function dropCacheKey(key: string): void {
  if (!STORE.has(key) && !syncMarks.has(key)) return
  STORE.delete(key)
  syncMarks.delete(key)
  scheduleSave()
}

/**
 * Load the on-disk snapshot (call once at startup, before IPC handlers run).
 * Missing or corrupt files start the app with an empty cache.
 *
 * @param shelfMs how old (ms) a snapshot may be before cold-start serving is
 *   refused — pass the user-tunable cacheStaleHours from settings; 0 = strict.
 */
export function initCache(file: string, shelfMs: number = STALE_MAX_MS): void {
  filePath = file
  STORE.clear()
  syncMarks.clear()
  const shelf = shelfMs > 0 ? shelfMs : 0
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const data = JSON.parse(raw) as Partial<DiskFile>
    if (!data || data.schema !== SCHEMA || !Array.isArray(data.entries)) return
    version = typeof data.version === 'number' && Number.isInteger(data.version) && data.version >= 0 ? data.version : 0
    for (const [k, v] of Object.entries(data.marks ?? {})) {
      if (Number.isFinite(v)) syncMarks.set(k, v)
    }
    const now = Date.now()
    for (const e of data.entries) {
      if (!e || typeof e.k !== 'string') continue
      // Drop only what is useless: expired AND past the (possibly zero) stale shelf.
      if (now >= e.expiresAt && !(shelf > 0 && now < e.at + shelf)) continue
      if (now >= e.expiresAt) {
        // Expired while closed — keep as a one-shot stale copy (SWR).
        STORE.set(e.k, { value: e.value, expiresAt: e.expiresAt, staleUntil: e.at + shelf, version: e.version, at: e.at })
      } else {
        // Still fresh — behaves like a normal in-session entry.
        STORE.set(e.k, { value: e.value, expiresAt: e.expiresAt, staleUntil: 0, version: e.version, at: e.at })
      }
      if (STORE.size > MAX_ENTRIES) evictOldest()
    }
  } catch {
    /* missing file / corrupt JSON — start empty */
  }
}

/** Synchronously persist the cache now (used on app quit; no-op pre-init). */
export function flushCache(): void {
  if (!filePath) return
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  saveNow()
}

function scheduleSave(): void {
  if (!filePath) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
}

function saveNow(): void {
  if (!filePath) return
  try {
    const now = Date.now()
    const entries: DiskEntry[] = []
    for (const [k, e] of STORE) {
      // Skip what is useless on disk: already expired AND past its stale horizon.
      if (now >= e.expiresAt && now >= e.staleUntil) continue
      entries.push({ k, value: e.value, expiresAt: e.expiresAt, staleUntil: e.staleUntil, version: e.version, at: e.at })
    }
    const data: DiskFile = {
      schema: SCHEMA,
      version,
      savedAt: now,
      entries,
      ...(syncMarks.size > 0 ? { marks: Object.fromEntries(syncMarks) } : {}),
    }
    const tmp = filePath + '.tmp'
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(tmp, filePath)
  } catch {
    /* disk full / permissions — keep running with the in-memory cache */
  }
}

function evictOldest(): void {
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [k, e] of STORE) {
    if (e.at < oldestAt) {
      oldestAt = e.at
      oldestKey = k
    }
  }
  if (oldestKey !== null) STORE.delete(oldestKey)
}
