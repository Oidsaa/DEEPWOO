/**
 * Tiny in-memory response cache for the WooCommerce client (main process).
 *
 * Every read IPC handler funnels its result through cachedRun(), so
 * navigating between views in the same session reuses the last response
 * instead of re-downloading the store. Entries expire after a per-endpoint
 * TTL and are invalidated by bumpCacheVersion() whenever the app WRITES to
 * the store (orders, customers, products, settings) — the next read then
 * fetches fresh data automatically. Manual refresh buttons additionally call
 * clearCaches() through the preload bridge so the user can force a resync
 * (e.g. for orders placed on the site by customers).
 *
 * Only successful results are stored — errors are never cached.
 */

interface Entry {
  value: unknown
  expiresAt: number
  /** Version of the cache when the entry was stored (see bumpCacheVersion). */
  version: number
  /** Insertion timestamp — used to evict the oldest entry over the cap. */
  at: number
}

const STORE = new Map<string, Entry>()
const MAX_ENTRIES = 500
let version = 0

/** Run `loader`, serving a still-fresh entry when one exists for `key`. */
export function cachedRun<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = STORE.get(key)
  if (hit && hit.version === version && Date.now() < hit.expiresAt) {
    return Promise.resolve(hit.value as T)
  }
  return loader().then((value) => {
    if (STORE.size >= MAX_ENTRIES) evictOldest()
    STORE.set(key, { value, expiresAt: Date.now() + ttlMs, version, at: Date.now() })
    return value
  })
}

/** Drop every cached entry immediately (manual «به‌روزرسانی» / force resync). */
export function clearCaches(): void {
  STORE.clear()
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
}

function evictOldest(): void {
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [key, e] of STORE) {
    if (e.at < oldestAt) {
      oldestAt = e.at
      oldestKey = key
    }
  }
  if (oldestKey !== null) STORE.delete(oldestKey)
}
