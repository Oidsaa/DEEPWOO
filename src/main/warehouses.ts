/**
 * انبارها — multi-warehouse stock engine (main process).
 *
 * WooCommerce has no native multi-warehouse support, so every warehouse's
 * stock lives in a protected product/variation meta `_stock_{warehouseId}`
 * (see shared/warehouses.ts). The site's own stock_quantity is ALWAYS the
 * source of truth (ملاک):
 *  - انبارداری (saveWarehouseStock) is the ONLY write that touches
 *    stock_quantity — and only when the keeper explicitly confirms the sync;
 *  - تخصیص (allocateOrder) never touches stock_quantity — it moves counts
 *    between the per-warehouse metas only. When the warehouse sums drift
 *    from the site stock, the انبارها view flags the mismatch and the
 *    keepers settle it.
 *
 * Allocation is idempotent through the order meta `_warehouse_alloc`, which
 * records which warehouse each line's quantity was deducted from, so a
 * re-run never double-deducts. Lines whose node has NO registered count for
 * the target warehouse are skipped — that protects historical orders and
 * products the keepers have not registered yet.
 */

import type {
  Order,
  Product,
  ProductDetail,
  ProductVariation,
  Settings,
  WarehousesOverview,
  WarehouseDef,
  WarehouseItemState,
  WarehouseSaveRowResult,
  WarehouseStockSavePayload,
  WarehouseStockSaveResult,
} from '../shared/types'
import { ALLOC_MARKER, DEFAULT_WAREHOUSES, readWarehouseStock, stockMetaKey } from '../shared/warehouses'
import { createOrderNote, getProductCatalog, mapLimit, wooRequest } from './woo'
import type { WooConfig } from './woo'

/** Page cap while walking one variable product's combinations. */
const MAX_VARIATION_PAGES = 20
/** Concurrency of the per-product variation walks in the overview. */
const OVERVIEW_CONCURRENCY = 6
/** Auto-allocation only examines orders created in the last 30 days — older ones need a keeper's explicit action. */
const RECONCILE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Max orders examined per reconcile pass. */
const RECONCILE_MAX_ORDERS = 120
/** Minimum gap between two reconcile passes. */
const RECONCILE_GAP_MS = 60_000

type MetaNode = Product | ProductVariation

/** Warehouses in effect (the user's definitions, or the sensible defaults). */
export function activeWarehouses(settings: Settings): WarehouseDef[] {
  return settings.warehouses?.length ? settings.warehouses : DEFAULT_WAREHOUSES
}

function whName(warehouses: WarehouseDef[], id: string): string {
  return warehouses.find((w) => w.id === id)?.name ?? id
}

function nodePath(productId: number, variationId: number | null): string {
  return variationId == null ? '/products/' + productId : `/products/${productId}/variations/${variationId}`
}

/** Node key used in the allocation marker (`{productId}:{variationId|0}`). */
function nodeKey(productId: number, variationId: number | null): string {
  return String(productId) + ':' + String(variationId ?? 0)
}

/* ------------------------------------------------------------------ */
/* Overview (نمای انبارها + نشان کنارهمگذاری سایدبار)                    */
/* ------------------------------------------------------------------ */

function itemState(
  warehouses: WarehouseDef[],
  productId: number,
  variationId: number | null,
  name: string,
  productName: string | undefined,
  node: Pick<MetaNode, 'manage_stock' | 'stock_quantity' | 'meta_data'> & { sku?: string | null },
  type: string,
  status: string,
  imageUrl: string | undefined,
): WarehouseItemState {
  const ids = warehouses.map((w) => w.id)
  const manageStock = node.manage_stock === true
  const siteStock = typeof node.stock_quantity === 'number' ? Math.round(node.stock_quantity) : null
  const registered = readWarehouseStock(node.meta_data, ids)
  const warehouseStock: Record<string, number | null> = {}
  for (const id of ids) warehouseStock[id] = typeof registered[id] === 'number' ? registered[id] : null
  const vals = Object.values(warehouseStock).filter((v): v is number => typeof v === 'number')
  const sum = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
  return {
    productId,
    variationId,
    name,
    productName,
    sku: node.sku || undefined,
    imageUrl,
    type,
    status,
    manageStock,
    siteStock,
    warehouseStock,
    sum,
    delta: sum !== null && siteStock !== null ? sum - siteStock : null,
  }
}

/**
 * Full انبارها snapshot: every simple product and every combination of every
 * variable product, with the site stock and each warehouse's registered
 * count. The variation walks dominate the cost, so the caller caches the
 * result under ONE key ('warehouses-overview') — the sidebar badge and the
 * view then share the same computation.
 */
export async function warehousesOverview(cfg: WooConfig, settings: Settings): Promise<WarehousesOverview> {
  const warehouses = activeWarehouses(settings)
  const catalog = await getProductCatalog(cfg)

  const variationsByProduct = new Map<number, ProductVariation[]>()
  const variable = catalog.products.filter((p) => p.type === 'variable')
  await mapLimit(variable, OVERVIEW_CONCURRENCY, async (p) => {
    try {
      const all: ProductVariation[] = []
      let page = 1
      for (;;) {
        const { data, headers } = await wooRequest<ProductVariation[]>(
          cfg,
          'GET',
          `/products/${p.id}/variations`,
          { per_page: 100, page, orderby: 'id', order: 'asc' },
        )
        all.push(...data)
        const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
        if (data.length === 0 || page >= totalPages || page >= MAX_VARIATION_PAGES) break
        page += 1
      }
      variationsByProduct.set(p.id, all)
    } catch {
      // One flaky product must not kill the whole snapshot; its rows are
      // simply missing until the next refresh.
    }
  })

  const items: WarehouseItemState[] = []
  for (const p of catalog.products) {
    if (p.type === 'variable') {
      for (const v of variationsByProduct.get(p.id) ?? []) {
        const label = (v.attributes ?? []).map((a) => a.option).filter(Boolean).join(' / ')
        items.push(
          itemState(
            warehouses,
            p.id,
            v.id,
            label || v.sku || String(v.id),
            p.name,
            v,
            'variation',
            p.status,
            v.image?.src ?? p.images?.[0]?.src,
          ),
        )
      }
    } else {
      items.push(itemState(warehouses, p.id, null, p.name, undefined, p, p.type, p.status, p.images?.[0]?.src))
    }
  }

  return { warehouses, items, computedAt: new Date().toISOString() }
}

/* ------------------------------------------------------------------ */
/* انبارداری — registering per-warehouse counts (the only site-sync)     */
/* ------------------------------------------------------------------ */

/**
 * Save one product's per-warehouse counts — one PUT per row (simple product
 * or combination). All warehouses are written together atomically per row;
 * when `syncSite` is confirmed the site stock_quantity becomes the sum and
 * stock management is switched on. The write response is verified: if the
 * store stripped the `_stock_` metas the keeper gets a clear Persian error
 * instead of silently losing the registration.
 */
export async function saveWarehouseStock(
  cfg: WooConfig,
  settings: Settings,
  payload: WarehouseStockSavePayload,
): Promise<WarehouseStockSaveResult> {
  const warehouses = activeWarehouses(settings)
  const ids = warehouses.map((w) => w.id)
  const productId = Number(payload?.productId)
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  if (!Number.isInteger(productId) || productId <= 0 || rows.length === 0) {
    throw new Error('دادهٔ انبارداری ناقص است.')
  }

  const out: WarehouseSaveRowResult[] = []
  for (const row of rows) {
    const values: Record<string, number> = {}
    for (const id of ids) {
      const raw: unknown = row?.values?.[id]
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('موجودی هر انبار باید یک عدد نامنفی باشد.')
      }
      values[id] = Math.round(n)
    }
    const sum = ids.reduce((acc, id) => acc + values[id], 0)
    const patch: Record<string, unknown> = {
      meta_data: ids.map((id) => ({ key: stockMetaKey(id), value: values[id] })),
    }
    if (row.syncSite) {
      patch.stock_quantity = sum
      patch.manage_stock = true
    }

    const node = await wooRequest<MetaNode>(cfg, 'PUT', nodePath(productId, row.variationId ?? null), {}, patch)
    const saved = readWarehouseStock(node.data.meta_data, ids)
    for (const id of ids) {
      if (typeof saved[id] !== 'number') {
        throw new Error(
          'فروشگاه مقدار انبار را ذخیره نکرد (متای «' + stockMetaKey(id) + '» در پاسخ نبود). ' +
            'افزونه‌های متا را بررسی کنید.',
        )
      }
    }
    out.push({
      variationId: row.variationId ?? null,
      siteStock: typeof node.data.stock_quantity === 'number' ? Math.round(node.data.stock_quantity) : null,
      warehouseStock: saved,
      siteSynced: row.syncSite === true,
    })
  }
  return { productId, rows: out }
}

/* ------------------------------------------------------------------ */
/* تخصیص — moving order quantities between warehouse metas               */
/* ------------------------------------------------------------------ */

interface LineAlloc {
  wh: string
  qty: number
}

type AllocMarker = Record<string, LineAlloc>

function readMarker(order: Pick<Order, 'meta_data'>): AllocMarker {
  const raw = order.meta_data?.find((m) => m?.key === ALLOC_MARKER)?.value
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: AllocMarker = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const o = v as { wh?: unknown; qty?: unknown }
    const wh = typeof o.wh === 'string' ? o.wh : ''
    const qty = Math.round(Number(o.qty))
    if (wh && Number.isFinite(qty) && qty > 0) out[k] = { wh, qty }
  }
  return out
}

/**
 * Allocate (or revert) one order's quantities against the warehouse metas.
 *
 * `target = warehouse id` deducts every line from that warehouse (an existing
 * allocation is first given back — re-allocation is a move). `target = null`
 * reverts any previous allocation. Returns the updated order, or null when
 * nothing changed (including the idempotent no-op when the marker already
 * matches, and orders whose nodes are entirely ثبت‌نشده).
 */
export async function allocateOrder(
  cfg: WooConfig,
  settings: Settings,
  order: Order,
  target: string | null,
): Promise<Order | null> {
  const warehouses = activeWarehouses(settings)
  const whIds = warehouses.map((w) => w.id)
  const known = new Set(whIds)
  const marker = readMarker(order)
  const lines = (order.line_items ?? []).filter((l) => (Number(l.quantity) || 0) > 0 && Number(l.product_id) > 0)
  if (lines.length === 0) return null

  // Current per-warehouse counts of each involved node, fetched once.
  const nodes = new Map<
    string,
    { productId: number; variationId: number | null; wh: Record<string, number> }
  >()
  const getNode = async (productId: number, variationId: number | null) => {
    const key = nodeKey(productId, variationId)
    let e = nodes.get(key)
    if (!e) {
      const { data } = await wooRequest<MetaNode>(cfg, 'GET', nodePath(productId, variationId))
      e = { productId, variationId, wh: readWarehouseStock(data.meta_data, whIds) }
      nodes.set(key, e)
    }
    return e
  }

  const nextMarker: AllocMarker = { ...marker }
  const deltas = new Map<string, Record<string, number>>()
  const noteLines: string[] = []
  let anyChange = false

  for (const line of lines) {
    const productId = Number(line.product_id)
    const v = Number(line.variation_id)
    const variationId = Number.isInteger(v) && v > 0 ? v : null
    const qty = Math.round(Number(line.quantity) || 0)
    const key = nodeKey(productId, variationId)
    const node = await getNode(productId, variationId)
    const prev = marker[key]

    if (target == null) {
      if (!prev) continue
      if (known.has(prev.wh) && typeof node.wh[prev.wh] === 'number') {
        const d = deltas.get(key) ?? {}
        d[prev.wh] = (d[prev.wh] ?? 0) + prev.qty
        deltas.set(key, d)
        noteLines.push(
          `«${line.name}» — ${prev.qty} عدد به انبار «${whName(warehouses, prev.wh)}» برگشت داده شد.`,
        )
      }
      delete nextMarker[key]
      anyChange = true
    } else {
      if (prev && prev.wh === target && prev.qty === qty) continue
      if (typeof node.wh[target] !== 'number') {
        // ثبت‌نشده — the keeper has not registered this node's counts yet;
        // allocating would operate on unknown numbers, so skip the line.
        continue
      }
      const d = deltas.get(key) ?? {}
      if (prev && known.has(prev.wh) && typeof node.wh[prev.wh] === 'number') {
        d[prev.wh] = (d[prev.wh] ?? 0) + prev.qty
        noteLines.push(
          `«${line.name}» — ${prev.qty} عدد به انبار «${whName(warehouses, prev.wh)}» برگشت داده شد.`,
        )
      }
      d[target] = (d[target] ?? 0) - qty
      deltas.set(key, d)
      nextMarker[key] = { wh: target, qty }
      noteLines.push(`«${line.name}» — ${qty} عدد از انبار «${whName(warehouses, target)}» کسر شد.`)
      anyChange = true
    }
  }

  if (!anyChange) return null

  // 1) Move the warehouse counts (one PUT per changed node).
  for (const [key, d] of deltas) {
    const e = nodes.get(key)
    if (!e) continue
    const meta = Object.entries(d)
      .filter(([, v]) => v !== 0)
      .map(([id, v]) => ({ key: stockMetaKey(id), value: (e.wh[id] ?? 0) + v }))
    if (meta.length === 0) continue
    await wooRequest(cfg, 'PUT', nodePath(e.productId, e.variationId), {}, { meta_data: meta })
  }

  // 2) Claim the order with the marker — idempotency depends on it.
  const { data: savedOrder } = await wooRequest<Order>(cfg, 'PUT', '/orders/' + order.id, {}, {
    meta_data: [{ key: ALLOC_MARKER, value: Object.keys(nextMarker).length > 0 ? nextMarker : '' }],
  })

  // 3) Leave a private audit note (best-effort — a note failure must not
  //    make the caller retry the whole allocation).
  try {
    const title = target == null ? 'برگشت تخصیص انبار (خودکار):' : 'تخصیص انبار (خودکار):'
    await createOrderNote(cfg, order.id, {
      note: title + '\n' + noteLines.join('\n'),
      customer_note: false,
    })
  } catch {
    /* یادداشت حیاتی نیست */
  }

  return { ...savedOrder, allocatedWarehouse: target ?? undefined }
}

/* ------------------------------------------------------------------ */
/* Reconcile — mirroring status changes made outside this device          */
/* ------------------------------------------------------------------ */

/** Statuses whose orders must NOT keep an allocation (the app's purchase rule). */
const REVERT_STATUSES = new Set(['cancelled', 'refunded', 'failed'])

/**
 * What an order status implies for allocation: the matching warehouse's id
 * (allocate), null (revert), or undefined (leave any marker untouched).
 */
export function allocationForStatus(settings: Settings, status: string): string | null | undefined {
  if (REVERT_STATUSES.has(status)) return null
  for (const w of activeWarehouses(settings)) {
    if (w.orderStatus === status) return w.id
  }
  return undefined
}

/**
 * Walk a (newest-first) orders snapshot and mirror warehouse allocation for
 * orders whose status was changed OUTSIDE this device (the keepers'
 * machines): a keeper status (تایید فروشگاه/کارگاه) with no marker allocates
 * (after a fresh GET confirms the status), a cancelled/refunded/failed order
 * with a marker reverts. Bounded per pass and debounced by the caller.
 */
export async function reconcileAllocations(cfg: WooConfig, settings: Settings, orders: Order[]): Promise<void> {
  const byStatus = new Map<string, string>()
  for (const w of activeWarehouses(settings)) {
    if (w.orderStatus) byStatus.set(w.orderStatus, w.id)
  }
  const cutoff = Date.now() - RECONCILE_MAX_AGE_MS
  let budget = RECONCILE_MAX_ORDERS

  for (const order of orders) {
    if (budget <= 0) break
    const created = +new Date(order.date_created)
    if (!Number.isFinite(created)) continue
    if (created < cutoff) break // newest first — everything after is older

    const hasMarker = Object.keys(readMarker(order)).length > 0

    if (REVERT_STATUSES.has(order.status)) {
      if (!hasMarker) continue
      budget -= 1
      try {
        await allocateOrder(cfg, settings, order, null)
      } catch {
        /* next pass retries */
      }
      continue
    }

    const whId = byStatus.get(order.status)
    if (!whId || hasMarker) continue
    budget -= 1
    try {
      // The snapshot can be stale — confirm the status on a fresh GET so a
      // ghost transition never deducts stock.
      const { data } = await wooRequest<Order>(cfg, 'GET', '/orders/' + order.id)
      if (data.status !== order.status) continue
      if (Object.keys(readMarker(data)).length > 0) continue
      await allocateOrder(cfg, settings, data, whId)
    } catch {
      /* next pass retries */
    }
  }
}

const reconcileState = { last: 0, running: false }

/**
 * Fire-and-forget reconcile pass after the orders snapshot refreshes.
 * At most one pass per minute; never throws.
 */
export function scheduleReconcile(cfg: WooConfig, settings: Settings, orders: Order[]): void {
  const now = Date.now()
  if (reconcileState.running || now - reconcileState.last < RECONCILE_GAP_MS) return
  reconcileState.running = true
  reconcileState.last = now
  void reconcileAllocations(cfg, settings, orders)
    .catch(() => {
      /* غیرحیاتی */
    })
    .finally(() => {
      reconcileState.running = false
    })
}

/* ------------------------------------------------------------------ */
/* Pure cache patches — keep the overview/detail caches fresh after save   */
/* ------------------------------------------------------------------ */

function metaWith(
  meta: Array<{ id?: number; key: string; value: unknown }> | undefined,
  key: string,
  value: unknown,
): Array<{ id?: number; key: string; value: unknown }> {
  const out = (meta ?? []).map((m) => ({ ...m }))
  const i = out.findIndex((m) => m.key === key)
  if (i >= 0) out[i] = { ...out[i], value }
  else out.push({ key, value })
  return out
}

/** Fold a successful انبارداری save into a cached overview (keeps it fresh). */
export function applySaveToOverview(
  overview: WarehousesOverview,
  result: WarehouseStockSaveResult,
): WarehousesOverview {
  const rows = new Map(result.rows.map((r) => [r.variationId ?? 0, r]))
  const items = overview.items.map((it) => {
    if (it.productId !== result.productId) return it
    const row = rows.get(it.variationId ?? 0)
    if (!row) return it
    const warehouseStock = { ...it.warehouseStock }
    for (const [id, v] of Object.entries(row.warehouseStock)) {
      if (id in warehouseStock) warehouseStock[id] = v
    }
    const vals = Object.values(warehouseStock).filter((v): v is number => typeof v === 'number')
    const sum = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) : null
    const siteStock = typeof row.siteStock === 'number' ? row.siteStock : it.siteStock
    return {
      ...it,
      warehouseStock,
      sum,
      siteStock,
      delta: sum !== null && siteStock !== null ? sum - siteStock : null,
    }
  })
  return { ...overview, items, computedAt: new Date().toISOString() }
}

/** Fold a successful انبارداری save into the cached product detail. */
export function applySaveToProductDetail(
  detail: ProductDetail,
  result: WarehouseStockSaveResult,
): ProductDetail {
  const rows = new Map(result.rows.map((r) => [r.variationId ?? 0, r]))
  const patchNode = <T extends MetaNode>(
    node: T,
    row: WarehouseSaveRowResult,
  ): T => ({
    ...node,
    stock_quantity: typeof row.siteStock === 'number' ? row.siteStock : node.stock_quantity,
    meta_data: Object.entries(row.warehouseStock).reduce(
      (m, [id, v]) => metaWith(m, stockMetaKey(id), v),
      node.meta_data ?? [],
    ),
    warehouseStock: { ...node.warehouseStock, ...row.warehouseStock },
  })
  const productRow = rows.get(0)
  return {
    product: productRow ? patchNode(detail.product, productRow) : detail.product,
    variations: detail.variations.map((v) => {
      const row = rows.get(v.id)
      return row ? patchNode(v, row) : v
    }),
  }
}
