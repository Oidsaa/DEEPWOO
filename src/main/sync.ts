/**
 * Sync engine (سینک پس‌زمینه) — the WooDesktop two-tier design:
 * every entity read is answered from the local SQLite store, and this module
 * keeps the store fresh. Each pass is DELTA: orders/products walk with
 * `modified_after` (the cursor from the previous pass, widened by an overlap
 * window), customers walk newest-registrations-first and stop early once a
 * page holds nothing fresh. Upserts detect created/updated/status_changed and
 * feed the «تغییرات فروشگاه» log (store.ts).
 *
 * Delete diffs (rows vanished from the site) run at most once per gap and
 * ONLY when both the sync walk and the id scan were complete (not truncated) —
 * an incomplete remote id list must never delete local rows.
 */

import type { Settings, SyncEntityState } from '../shared/types'
import { SYNC_DEFAULTS, getSettings } from './settings'
import {
  PRODUCT_STATUSES,
  catalog,
  deleteMissingOrders,
  deleteMissingProducts,
  finishSync,
  getSyncRow,
  replaceVariationsOf,
  upsertCustomer,
  upsertOrder,
  upsertProduct,
  upsertVariation,
} from './store'
import type { SyncEntity } from './store'
import {
  scanOrderIds,
  scanProductIds,
  walkCustomerPages,
  walkOrderPages,
  walkProductPages,
  walkVariationPages,
} from './woo'
import type { WooConfig } from './woo'

const ENTITIES: SyncEntity[] = ['orders', 'products', 'customers']
const lastDeleteScan: Partial<Record<SyncEntity, number>> = {}
const lastProgressPing: Partial<Record<SyncEntity, number>> = {}

/**
 * Live-refresh ping fired while a walk is landing pages (first-run baseline on
 * big stores takes minutes — the UI must see rows stream in, not wait for the
 * whole pass). Throttled; shares the data:synced channel with pass-end events.
 */
function pingProgress(entity: SyncEntity): void {
  const now = Date.now()
  if (now - (lastProgressPing[entity] ?? 0) < 2500) return
  lastProgressPing[entity] = now
  onSyncedCb?.(entity)
}

/** Widen every delta cursor by this much so a write racing the previous pass is not missed. */
const SYNC_OVERLAP_MS = 5 * 60 * 1000
/** Minimum gap between two delete-diff scans of one entity. */
const DELETE_SCAN_GAP_MS = 10 * 60 * 1000
/** After a failed baseline attempt, reads wait this long before retrying it. */
const FAILED_RETRY_MS = 60 * 1000
/** Concurrency of the per-product variation walks. */
const VARIATION_WALK_CONCURRENCY = 4

/** Run tasks with at most `limit` in flight. */
export async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const current = i
      i += 1
      await fn(items[current])
    }
  })
  await Promise.all(workers)
}

function configured(cfg: WooConfig | Settings): boolean {
  return Boolean(cfg.siteUrl && cfg.consumerKey && cfg.consumerSecret)
}

/* ------------------------------------------------------------------ */
/* Per-entity passes                                                    */
/* ------------------------------------------------------------------ */

function deltaExtra(cursorMs: number | null): Record<string, string | number> {
  // `modified_after` narrows the walk server-side; older WooCommerce versions
  // ignore it and return everything — the upserts are idempotent, so a full
  // re-walk stays correct (just slower).
  return cursorMs != null ? { modified_after: new Date(cursorMs).toISOString() } : {}
}

async function syncOrders(cfg: WooConfig): Promise<{ truncated: boolean }> {
  const row = getSyncRow('orders')
  const cursor = row.lastSyncAt && row.cursor != null ? row.cursor : null
  const res = await walkOrderPages(cfg, deltaExtra(cursor), (orders) => {
    for (const o of orders) upsertOrder(o)
    pingProgress('orders')
  })

  const now = Date.now()
  if (!res.truncated && now - (lastDeleteScan.orders ?? 0) >= DELETE_SCAN_GAP_MS) {
    lastDeleteScan.orders = now
    const scan = await scanOrderIds(cfg)
    if (scan && !scan.truncated) deleteMissingOrders(scan.ids)
  }
  return { truncated: res.truncated }
}

async function syncProducts(cfg: WooConfig): Promise<{ truncated: boolean }> {
  const row = getSyncRow('products')
  const full = !(row.lastSyncAt && row.cursor != null)
  const extra = deltaExtra(full ? null : row.cursor)

  let truncated = false
  const changedVariable: number[] = []
  for (const status of PRODUCT_STATUSES) {
    const res = await walkProductPages(cfg, status, extra, (products) => {
      for (const p of products) {
        const outcome = upsertProduct(p)
        if (p.type === 'variable' && outcome !== 'unchanged') changedVariable.push(p.id)
      }
      pingProgress('products')
    })
    truncated = truncated || res.truncated
  }

  // Combinations are re-walked for every variable product on a full pass and
  // for changed parents on a delta pass (variation-only site edits surface on
  // the next full pass — بارگذاری مجدد or first sync). A failed walk skips the
  // product's replacement so a flaky page never deletes valid combinations.
  const targets = full
    ? catalog().products.filter((p) => p.type === 'variable').map((p) => p.id)
    : changedVariable
  await mapLimit(targets, VARIATION_WALK_CONCURRENCY, async (productId) => {
    try {
      const seen = new Set<number>()
      await walkVariationPages(cfg, productId, (variations) => {
        for (const v of variations) {
          seen.add(v.id)
          upsertVariation(productId, v)
        }
      })
      replaceVariationsOf(productId, seen)
    } catch {
      /* گذر بعدی جبران می‌کند */
    }
  })

  const now = Date.now()
  if (!truncated && now - (lastDeleteScan.products ?? 0) >= DELETE_SCAN_GAP_MS) {
    lastDeleteScan.products = now
    const scan = await scanProductIds(cfg, PRODUCT_STATUSES)
    if (scan && !scan.truncated) {
      for (const status of PRODUCT_STATUSES) deleteMissingProducts(status, scan.ids)
    }
  }
  return { truncated }
}

async function syncCustomers(cfg: WooConfig): Promise<{ truncated: boolean }> {
  const row = getSyncRow('customers')
  // Customers have no `modified_after` filter — the walk stops early once a
  // whole page holds no registration newer than the cursor; edits of older
  // customers surface on the next full pass (first sync / بارگذاری مجدد).
  const cursor = row.lastSyncAt && row.cursor != null ? row.cursor : null
  return walkCustomerPages(cfg, cursor, (customers) => {
    for (const c of customers) upsertCustomer(c)
    pingProgress('customers')
  })
}

async function syncEntity(cfg: WooConfig, entity: SyncEntity): Promise<void> {
  const start = Date.now()
  let truncated = false
  try {
    const res =
      entity === 'orders'
        ? await syncOrders(cfg)
        : entity === 'products'
          ? await syncProducts(cfg)
          : await syncCustomers(cfg)
    truncated = res.truncated
  } catch (err) {
    finishSync(entity, { error: err instanceof Error ? err.message : String(err) })
    return
  }
  finishSync(entity, { cursor: start - SYNC_OVERLAP_MS, truncated })
  onSyncedCb?.(entity)
}

/* ------------------------------------------------------------------ */
/* Worker — background interval + on-demand passes                      */
/* ------------------------------------------------------------------ */

const inflight = new Map<SyncEntity, Promise<void>>()
const lastAttempt = new Map<SyncEntity, number>()
let onSyncedCb: ((entity: SyncEntity) => void) | null = null
let timer: ReturnType<typeof setInterval> | null = null
let ticking = false

/** Hook fired after an entity's successful pass (UI broadcast + reconcile). */
export function setOnSynced(cb: (entity: SyncEntity) => void): void {
  onSyncedCb = cb
}

/** One pass of `entity`, deduplicated — concurrent callers share the promise. */
function runEntity(entity: SyncEntity): Promise<void> {
  const existing = inflight.get(entity)
  if (existing) return existing
  lastAttempt.set(entity, Date.now())
  const p = syncEntity(getSettings(), entity).finally(() => {
    inflight.delete(entity)
  })
  inflight.set(entity, p)
  return p
}

function intervalsOf(s: Settings): Record<SyncEntity, number> {
  return {
    orders: (s.syncOrdersMin ?? SYNC_DEFAULTS.ordersMin) * 60_000,
    products: (s.syncProductsMin ?? SYNC_DEFAULTS.productsMin) * 60_000,
    customers: (s.syncCustomersMin ?? SYNC_DEFAULTS.customersMin) * 60_000,
  }
}

async function tick(): Promise<void> {
  if (ticking) return
  const s = getSettings()
  if (s.autoSyncEnabled === false || !configured(s)) return
  const intervals = intervalsOf(s)
  const now = Date.now()
  const due = ENTITIES.filter((entity) => {
    if (inflight.has(entity)) return false
    const last = getSyncRow(entity).lastSyncAt
    const at = last ? Date.parse(last) : 0
    return !Number.isFinite(at) || at <= 0 || now - at >= intervals[entity]
  })
  if (due.length === 0) return
  ticking = true
  try {
    await Promise.all(due.map(runEntity))
  } finally {
    ticking = false
  }
}

/** Start the background worker (checked every 30s against per-entity intervals). */
export function startWorker(): void {
  if (timer) return
  timer = setInterval(() => void tick(), 30_000)
  void tick()
}

export function stopWorker(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

/** Manual «همگام‌سازی الان»: run the given entities now and report their state. */
export async function syncNow(entity?: SyncEntity): Promise<SyncEntityState[]> {
  const s = getSettings()
  const targets = entity ? [entity] : ENTITIES
  if (configured(s)) {
    ticking = true
    try {
      await Promise.all(targets.map(runEntity))
    } finally {
      ticking = false
    }
  }
  return allStates()
}

/**
 * First-read kick: when an entity has never synced, START one pass in the
 * background (never awaited) and return immediately — reads answer with
 * whatever the store already holds, and the UI streams the rest in live via
 * the data:synced events. Throttled after failures so a downed site doesn't
 * turn every read into a retry storm.
 */
export async function ensureSynced(entity: SyncEntity): Promise<void> {
  if (getSyncRow(entity).lastSyncAt) return
  const s = getSettings()
  if (!configured(s)) return
  if (Date.now() - (lastAttempt.get(entity) ?? 0) < FAILED_RETRY_MS) return
  void runEntity(entity)
}

/* ------------------------------------------------------------------ */
/* State for the UI (نشان سینک + تنظیمات)                               */
/* ------------------------------------------------------------------ */

export function entityState(entity: SyncEntity): SyncEntityState {
  const row = getSyncRow(entity)
  return {
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    itemCount: row.itemCount,
    truncated: row.truncated,
    running: inflight.has(entity),
  }
}

export function allStates(): SyncEntityState[] {
  return ENTITIES.map(entityState)
}

export function statesMap(): Record<string, SyncEntityState> {
  return Object.fromEntries(ENTITIES.map((e) => [e, entityState(e)]))
}
