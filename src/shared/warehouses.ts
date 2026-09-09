import type { WarehouseDef } from './types'

/** Prefix of the product/variation meta that keeps one warehouse's stock. */
export const WAREHOUSE_META_PREFIX = '_stock_'

/** Order meta that marks which warehouse an order's stock was allocated from. */
export const ALLOC_MARKER = '_warehouse_alloc'

/** Site meta key of one warehouse's stock (`_stock_{id}`). */
export function stockMetaKey(warehouseId: string): string {
  return WAREHOUSE_META_PREFIX + warehouseId
}

/**
 * Warehouses used when the user has not defined any yet — matching the custom
 * order statuses (تایید کارگاه / تایید فروشگاه) this store already has. The
 * ids name the site meta keys and must never change once stock is registered.
 */
export const DEFAULT_WAREHOUSES: WarehouseDef[] = [
  { id: 'kargah', name: 'کارگاه', orderStatus: 'kargah' },
  { id: 'forooshgah', name: 'فروشگاه', orderStatus: 'forooshgah', quickOrder: true },
]

/** Latin slug for a warehouse id (the site meta key suffix). */
export function slugifyWarehouseId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Read the per-warehouse stock of one product/variation from its raw meta.
 * Only registered values are returned — an absent key means ثبت‌نشده.
 */
export function readWarehouseStock(
  meta: Array<{ key: string; value: unknown }> | undefined,
  warehouseIds: string[],
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!meta || meta.length === 0) return out
  const map = new Map(meta.map((m) => [String(m?.key), m?.value]))
  for (const id of warehouseIds) {
    const v = map.get(stockMetaKey(id))
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
    if (Number.isFinite(n)) out[id] = Math.round(n)
  }
  return out
}

/**
 * Validate + normalize the warehouses array coming from settings. Guarantees
 * at least one warehouse, unique latin ids and at most one quick-order flag.
 * Returns undefined when nothing valid is configured (defaults apply).
 */
export function sanitizeWarehouses(input: unknown): WarehouseDef[] | undefined {
  if (!Array.isArray(input) || input.length === 0) return undefined
  const used = new Set<string>()
  const out: WarehouseDef[] = []
  for (const raw of input.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Partial<WarehouseDef>
    const id = slugifyWarehouseId(String(r.id ?? ''))
    if (!id || used.has(id)) continue
    used.add(id)
    const name = String(r.name ?? '').trim() || 'انبار'
    const orderStatus = String(r.orderStatus ?? '').trim() || undefined
    const w: WarehouseDef = { id, name }
    if (orderStatus) w.orderStatus = orderStatus
    if (r.quickOrder === true) w.quickOrder = true
    out.push(w)
  }
  if (out.length === 0) return undefined
  // At most ONE quick-order warehouse — the first flagged one wins.
  let quickSeen = false
  for (const w of out) {
    if (w.quickOrder) {
      if (quickSeen) delete w.quickOrder
      else quickSeen = true
    }
  }
  return out
}
