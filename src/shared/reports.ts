import type {
  AttrHit,
  CouponUse,
  CustomerBucket,
  CustomerInsights,
  DailySale,
  FunnelInsights,
  GrossProfitSummary,
  NamedAmount,
  OpsGroup,
  OpsOrderRow,
  Order,
  PreviousPeriodTotals,
  Product,
  ProductProfitRow,
  ReportCustomer,
  ReportsQuery,
  SalesReport,
  TopSeller,
  WeeklyTop,
} from './types'
import { normalizePhone } from './phone'

/**
 * Pure aggregator for the sales report — shared by the real client
 * (src/main/woo.ts) and the browser mock (src/renderer/lib/mock.ts) so the
 * two always produce identical numbers from the same orders.
 *
 * Money follows the app rule everywhere: failed / cancelled / refunded orders
 * are excluded from revenue, order counts and item counts. The customer /
 * funnel / ops panels are «تقریبی» views over the same window (see the UI
 * notes) — the WooCommerce REST API has no session or visit data, so the
 * funnel is derived from order statuses only.
 */

const PURCHASE_EXCLUDED = new Set(['failed', 'cancelled', 'refunded'])
/** Saved-cart drafts are never purchases — they stay out of revenue/counts. */
const DRAFT_UNCOUNTED = new Set(['checkout-draft', 'auto-draft', 'draft'])
const LOST = new Set(['failed', 'cancelled', 'refunded', 'trash'])
const WAITING = new Set(['pending', 'pending-payment', 'on-hold', 'checkout-draft', 'auto-draft', 'draft'])

const round2 = (n: number): number => Math.round(n * 100) / 100

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local (not UTC) date key — the day axis of the report chart. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const TOP_PRODUCTS = 10
const TOP_GROUPS = 8
const GROSS_ROWS = 25
const TOP_CUSTOMERS = 10
const TOP_COUPONS = 10
const TOP_FEATURES = 10
const OPS_ROWS = 12

/** True when the order should count toward the report totals (app rule). */
export function reportCountsToward(status: string | undefined | null): boolean {
  return !!status && !PURCHASE_EXCLUDED.has(status)
}

/** App rule AND not a saved-cart draft (درفت/سبد رهاشده هرگز فروش نیست). */
function isCounted(status: string | undefined | null): boolean {
  return reportCountsToward(status) && !DRAFT_UNCOUNTED.has(status ?? '')
}

/** Counted totals of an order list (same app rule as the report window). */
export function countTotalsOf(orders: Order[]): { revenue: number; orders: number; items: number } {
  let revenue = 0
  let ordersN = 0
  let items = 0
  for (const o of orders) {
    if (!isCounted(o.status)) continue
    revenue = round2(revenue + (Number(o.total) || 0))
    ordersN += 1
    items += o.line_items.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
  }
  return { revenue: round2(revenue), orders: ordersN, items }
}

/** Identity of an order's buyer: account id, else guest keyed by phone/name. */
function buyerOf(o: Order): { key: string; id: number; name: string; city?: string; phone: string } {
  const id = o.customer_id || 0
  const billName = [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ').trim()
  const name = (o.customer_name || '').trim() || billName
  const phone = normalizePhone(o.billing?.phone)
  const city = (o.billing?.city || '').trim() || undefined
  if (id > 0) return { key: 'u' + id, id, name: name || 'مشتری #' + id, city, phone }
  const shown = name || (phone ? phone : 'مهمان')
  return { key: 'p' + (phone || name || 'guest'), id: 0, name: shown, city, phone }
}

/** Attribute meta of one order line (variation attributes from the order). */
function lineMetaOf(l: Order['line_items'][number]): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  for (const m of l.meta_data ?? []) {
    const key = (m.display_key || m.key || '').trim()
    const rawVal = (m.display_value ?? m.value) ?? ''
    const value = String(rawVal).trim()
    if (!key || !value || key.startsWith('_')) continue
    // WooCommerce global attributes land as `pa_…` / `attribute_pa_…`.
    out.push({ label: key.replace(/^attribute_pa_/, '').replace(/^pa_/, '').replace(/^attribute_/, ''), value })
  }
  return out
}

/**
 * Resolve a report request (preset days or a custom from/to range) into the
 * local-midnight window bounds every caller scans. `to` is inclusive (end of
 * its local day). A custom range wider than 366 days is trimmed to 366.
 */
export function resolveReportWindow(query: ReportsQuery | undefined): { fromMs: number; toMs: number; days: number } {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const q = query ?? {}
  const parseKey = (k: string | undefined): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k ?? '')
    if (!m) return null
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  }
  const from = parseKey(q.from)
  const to = parseKey(q.to)
  if (from !== null && to !== null && to >= from) {
    let toMs = new Date(new Date(to)).setHours(23, 59, 59, 999)
    let fromMs = new Date(new Date(from)).setHours(0, 0, 0, 0)
    const MAX = 366
    if (toMs - fromMs >= MAX * 86400000) {
      const d = new Date(fromMs)
      d.setDate(d.getDate() + MAX - 1)
      d.setHours(23, 59, 59, 999)
      toMs = d.getTime()
    }
    if (toMs > now.getTime() + 86400000 - 1) toMs = new Date(now).setHours(23, 59, 59, 999)
    const days = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1)
    return { fromMs, toMs, days: Math.min(MAX, days) }
  }
  const days = Math.min(366, Math.max(1, Math.round(q.days ?? 30) || 30))
  const fromD = new Date(now)
  fromD.setDate(fromD.getDate() - (days - 1))
  const fromMs = fromD.getTime()
  const toMs = now.getTime() + 86399999
  return { fromMs, toMs, days }
}

/**
 * Aggregate every order (already inside the window — any status) into the
 * sales report. `prevOrders` (equal-length window right before) drives the
 * growth percentages and the «جدید / بازگشتی» customer split.
 *
 * @param costs قیمت تمام‌شدهٔ هر کالا از تنظیمات (key = product id) — وقتی داده
 * نشود همهٔ ردیف‌ها «بدون قیمت تمام‌شده» علامت می‌خورند (سود صفر/نامحسوب).
 */
export function aggregateSalesReport(
  orders: Order[],
  days: number,
  fromMs: number,
  toMs: number,
  costs?: Record<string, number>,
  prevOrders: Order[] = [],
): SalesReport {
  const revenueMap = new Map<string, { total: number; orders: number }>() // date key
  const payMap = new Map<string, NamedAmount>()
  const statusMap = new Map<string, NamedAmount>()
  const cityMap = new Map<string, NamedAmount>()
  interface ProdAcc {
    key: string
    id: number
    name: string
    sku: string
    units: number
    revenue: number
  }
  const prodMap = new Map<string, ProdAcc>() // key = product_id | name fallback
  const prodOrderIds = new Map<string, Set<number>>()
  // Cost lookup by product id (line product_id is the catalog product id;
  // variations keep the same product id in this aggregator's grouping).
  const costOf = (id: number | undefined | null): number | null =>
    id === undefined || id === null ? null : (costs?.[String(id)] ?? null)

  let revenue = 0
  let orderCount = 0
  let items = 0

  const bump = (m: Map<string, NamedAmount>, key: string, total: number) => {
    const hit = m.get(key)
    if (hit) {
      hit.count += 1
      hit.total += total
    } else {
      m.set(key, { label: key, count: 1, total })
    }
  }

  // ---- customer / coupon / attribute accumulators (counted orders only) ----
  interface CustAcc {
    id: number
    name: string
    city?: string
    orders: number
    revenue: number
    firstMs: number
  }
  const custMap = new Map<string, CustAcc>()
  interface CouponAcc {
    orders: Set<number>
    discount: number
  }
  const couponMap = new Map<string, CouponAcc>()
  interface FeatAcc {
    label: string
    value: string
    units: number
    orders: Set<number>
  }
  const featMap = new Map<string, FeatAcc>()
  const weeklyOrders: Order[] = []

  // ---- operational slices (any status of the window) ----------------------
  const lastMidnight = (() => {
    const d = new Date(toMs)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })()
  const sliceFrom = Math.max(fromMs, lastMidnight - 6 * 86400000) // last 7 local days
  const cancelledList: Order[] = []
  const cancelled7List: Order[] = []
  const waitingList: Order[] = []
  const abandonedList: Order[] = []

  for (const o of orders) {
    const st = o.status || 'unknown'
    const t = Number(o.total) || 0
    const ms = new Date(o.date_created).getTime()
    if (st === 'cancelled' || st === 'refunded') {
      cancelledList.push(o)
      if (Number.isFinite(ms) && ms >= sliceFrom) cancelled7List.push(o)
    } else if (WAITING.has(st)) {
      if (st === 'checkout-draft' || st === 'auto-draft' || st === 'draft') abandonedList.push(o)
      else waitingList.push(o)
    }
    if (!isCounted(st)) continue
    const created = Number.isFinite(ms) ? new Date(ms) : new Date(fromMs)
    const day = localDateKey(created)

    revenue = round2(revenue + t)
    orderCount += 1
    items += o.line_items.reduce((a, l) => a + (Number(l.quantity) || 0), 0)

    const d = revenueMap.get(day)
    if (d) {
      d.total += t
      d.orders += 1
    } else {
      revenueMap.set(day, { total: t, orders: 1 })
    }

    bump(payMap, (o.payment_method_title || '').trim() || 'نامشخص', t)
    bump(statusMap, st, t)
    bump(cityMap, (o.billing?.city || '').trim() || 'نامشخص', t)

    const b = buyerOf(o)
    const cust = custMap.get(b.key)
    if (cust) {
      cust.orders += 1
      cust.revenue = round2(cust.revenue + t)
      if (ms < cust.firstMs) cust.firstMs = ms
    } else {
      custMap.set(b.key, {
        id: b.id,
        name: b.name,
        city: b.city,
        orders: 1,
        revenue: round2(t),
        firstMs: Number.isFinite(ms) ? ms : fromMs,
      })
    }

    for (const c of o.coupon_lines ?? []) {
      const code = (c.code || '').trim().toUpperCase()
      if (!code) continue
      const hit = couponMap.get(code)
      if (hit) {
        hit.orders.add(o.id)
        hit.discount = round2(hit.discount + (Number(c.discount) || 0))
      } else {
        couponMap.set(code, { orders: new Set([o.id]), discount: round2(Number(c.discount) || 0) })
      }
    }

    if (Number.isFinite(ms) && ms >= sliceFrom) weeklyOrders.push(o)

    for (const l of o.line_items) {
      const key = String(l.product_id ?? '') || l.name || 'محصول'
      const name = l.name || 'محصول'
      const unit = Number(l.quantity) || 0
      const lineTotal = Number(l.total) || 0
      let p = prodMap.get(key)
      if (!p) {
        p = { key, id: l.product_id ?? 0, name, sku: l.sku ?? '', units: 0, revenue: 0 }
        prodMap.set(key, p)
      } else if (name !== 'محصول') {
        p.name = name // prefer the first readable name
      }
      p.units += unit
      p.revenue = round2(p.revenue + lineTotal)
      if (!prodOrderIds.has(key)) prodOrderIds.set(key, new Set())
      prodOrderIds.get(key)!.add(o.id)
      for (const meta of lineMetaOf(l)) {
        const fk = meta.label + '|' + meta.value
        const feat = featMap.get(fk)
        if (feat) {
          feat.units += unit
          feat.orders.add(o.id)
        } else {
          featMap.set(fk, { label: meta.label, value: meta.value, units: unit, orders: new Set([o.id]) })
        }
      }
    }
  }

  // Continuous day axis: every day of the window, oldest → newest, zero-filled.
  const daily: DailySale[] = []
  const cur = new Date(fromMs)
  while (cur.getTime() <= toMs) {
    const key = localDateKey(cur)
    const hit = revenueMap.get(key)
    daily.push({ date: key, total: round2(hit?.total ?? 0), orders: hit?.orders ?? 0 })
    cur.setDate(cur.getDate() + 1)
  }

  const finish = (list: NamedAmount[]): NamedAmount[] =>
    list
      .sort((a, b) => b.total - a.total || b.count - a.count)
      .slice(0, TOP_GROUPS)
      .map((x) => ({ label: x.label, count: x.count, total: round2(x.total) }))

  const products: TopSeller[] = [...prodMap.values()]
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, units: p.units, orders: prodOrderIds.get(p.key)?.size ?? 0, revenue: p.revenue }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
    .slice(0, TOP_PRODUCTS)
    .map((p) => ({ ...p, revenue: round2(p.revenue) }))

  // ---- سود ناخالص (gross profit) from تنظیمات productCosts ----------------
  const profitRows: ProductProfitRow[] = [...prodMap.values()]
    .map((p) => {
      const unitCost = costOf(p.id)
      const covered = unitCost !== null
      const cogs = covered ? p.units * unitCost : 0
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        units: p.units,
        orders: prodOrderIds.get(p.key)?.size ?? 0,
        revenue: p.revenue,
        unitCost,
        cogs: round2(cogs),
        profit: covered ? round2(p.revenue - cogs) : 0,
        covered,
      }
    })
    .sort((a, b) => {
      // Covered first (by profit), then the uncovered (by revenue).
      if (a.covered !== b.covered) return a.covered ? -1 : 1
      return b.profit - a.profit || b.revenue - a.revenue
    })

  let coveredRevenue = 0
  let uncoveredRevenue = 0
  let cogs = 0
  let uncoveredProducts = 0
  for (const r of profitRows) {
    if (r.covered) {
      coveredRevenue += r.revenue
      cogs += r.cogs
    } else {
      uncoveredRevenue += r.revenue
      uncoveredProducts += 1
    }
  }
  coveredRevenue = round2(coveredRevenue)
  uncoveredRevenue = round2(uncoveredRevenue)
  cogs = round2(cogs)
  const grossProfit = round2(coveredRevenue - cogs)
  const profit: GrossProfitSummary = {
    coveredRevenue,
    uncoveredRevenue,
    cogs,
    grossProfit,
    marginPct: coveredRevenue > 0 ? round2((grossProfit / coveredRevenue) * 100) : null,
    uncoveredProducts,
    rows: profitRows.slice(0, GROSS_ROWS),
    rowsTruncated: profitRows.length > GROSS_ROWS,
  }

  // ---- مشتریان (top lists + new/returning + ratio) -------------------------
  const prevKeys = new Set<string>()
  for (const o of prevOrders) {
    if (!isCounted(o.status)) continue
    prevKeys.add(buyerOf(o).key)
  }
  const custEntries = [...custMap.values()]
    .map((c) => ({
      id: c.id,
      name: c.name,
      city: c.city,
      firstOrder: new Date(c.firstMs).toISOString(),
      orders: c.orders,
      revenue: c.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
  const active = custEntries.length
  const byKeyOf = new Map([...custMap.entries()].map(([k, v]) => [k, v]))
  let guests = 0
  let repeatBuyers = 0
  let returning = 0
  const buckets: CustomerBucket[] = [
    { label: '۱ سفارش', count: 0 },
    { label: '۲ سفارش', count: 0 },
    { label: '۳–۵ سفارش', count: 0 },
    { label: '۶+ سفارش', count: 0 },
  ]
  for (const [k, c] of byKeyOf) {
    if (c.id === 0) guests += 1
    if (prevKeys.has(k)) returning += 1
    if (c.orders >= 2) repeatBuyers += 1
    if (c.orders === 1) buckets[0].count += 1
    else if (c.orders === 2) buckets[1].count += 1
    else if (c.orders <= 5) buckets[2].count += 1
    else buckets[3].count += 1
  }
  const topByOrders: ReportCustomer[] = [...custEntries]
    .sort((a, b) => b.orders - a.orders || b.revenue - a.revenue)
    .slice(0, TOP_CUSTOMERS)
  const customers: CustomerInsights = {
    active,
    guests,
    newCustomers: Math.max(0, active - returning),
    returning,
    repeatBuyers,
    repeatRate: active > 0 ? round2((repeatBuyers / active) * 100) : null,
    avgRevenue: active > 0 ? round2(revenue / active) : null,
    orderRatio: active > 0 ? round2(orderCount / active) : null,
    buckets,
    topByAmount: custEntries.slice(0, TOP_CUSTOMERS),
    topByOrders,
  }

  const coupons: CouponUse[] = [...couponMap.entries()]
    .map(([code, a]) => ({ code, orders: a.orders.size, discount: a.discount }))
    .sort((a, b) => b.orders - a.orders || b.discount - a.discount)
    .slice(0, TOP_COUPONS)

  const features: AttrHit[] = [...featMap.values()]
    .map((f) => ({ label: f.label, value: f.value, units: f.units, orders: f.orders.size }))
    .sort((a, b) => b.units - a.units || b.orders - a.orders)
    .slice(0, TOP_FEATURES)

  // ---- قیف «تقریبی» بر اساس وضعیت سفارش‌های بازه ----------------------------
  let lostN = 0
  let awaitingN = 0
  let completedN = 0
  for (const o of orders) {
    const st = o.status || 'unknown'
    if (LOST.has(st)) lostN += 1
    else if (WAITING.has(st)) awaitingN += 1
    else if (st === 'completed') completedN += 1
  }
  const created = orders.length
  const paid = Math.max(0, created - lostN - awaitingN)
  const pct = (n: number): number | null => (created > 0 ? round2((n / created) * 100) : null)
  const funnel: FunnelInsights = {
    created,
    awaiting: awaitingN,
    paid,
    completed: completedN,
    lost: lostN,
    waitingPct: pct(awaitingN),
    paidPct: pct(paid),
    completionPct: pct(completedN),
    lostPct: pct(lostN),
  }

  // ---- گزارش‌های عملیاتی (سفارش‌های لغو/بازگشت، معوق، رها شده) --------------
  const toOps = (list: Order[], fromIso: string, toIso: string): OpsGroup => {
    const rows: OpsOrderRow[] = list
      .slice()
      .sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
      .slice(0, OPS_ROWS)
      .map((o) => {
        const b = buyerOf(o)
        return {
          id: o.id,
          number: o.number || String(o.id),
          status: o.status || 'unknown',
          date: o.date_created,
          total: round2(Number(o.total) || 0),
          customer: b.name,
          payment: o.payment_method_title || undefined,
          items: o.line_items.reduce((a, l) => a + (Number(l.quantity) || 0), 0),
        }
      })
    return {
      from: fromIso,
      to: toIso,
      count: list.length,
      total: round2(list.reduce((a, o) => a + (Number(o.total) || 0), 0)),
      rows,
      rowsTruncated: list.length > rows.length,
    }
  }
  const sliceIso = new Date(sliceFrom).toISOString()
  const toIso = new Date(toMs).toISOString()
  const cancelled = toOps(cancelledList, new Date(fromMs).toISOString(), toIso)
  const cancelled7 = toOps(cancelled7List, sliceIso, toIso)
  const waiting = toOps(waitingList, new Date(fromMs).toISOString(), toIso)
  const abandoned = toOps(abandonedList, new Date(fromMs).toISOString(), toIso)

  // ---- پرفروش‌ترین‌های هفتهٔ پایانی بازه (5 محصول/ترکیب) ---------------------
  interface WeekAcc {
    key: string
    id: number
    name: string
    sku: string
    units: number
    revenue: number
  }
  const weekMap = new Map<string, WeekAcc>()
  const weekOrderIds = new Map<string, Set<number>>()
  for (const o of weeklyOrders) {
    for (const l of o.line_items) {
      const key = String(l.product_id ?? '') || l.name || 'محصول'
      let w = weekMap.get(key)
      if (!w) {
        w = { key, id: l.product_id ?? 0, name: l.name || 'محصول', sku: l.sku ?? '', units: 0, revenue: 0 }
        weekMap.set(key, w)
      }
      w.units += Number(l.quantity) || 0
      w.revenue = round2(w.revenue + (Number(l.total) || 0))
      if (!weekOrderIds.has(key)) weekOrderIds.set(key, new Set())
      weekOrderIds.get(key)!.add(o.id)
    }
  }
  const weeklyTop: WeeklyTop = {
    from: sliceIso,
    to: toIso,
    top: [...weekMap.values()]
      .map((w) => ({
        id: w.id,
        name: w.name,
        sku: w.sku,
        units: w.units,
        orders: weekOrderIds.get(w.key)?.size ?? 0,
        revenue: w.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
      .slice(0, 5)
      .map((w) => ({ ...w, revenue: round2(w.revenue) })),
  }

  // Equal-length «دورهٔ قبل» window (ends just before fromMs) for growth %.
  const prevStart = new Date(fromMs)
  prevStart.setDate(prevStart.getDate() - days)
  const prevFromMs = prevStart.getTime()
  const prev = countTotalsOf(prevOrders)
  const previous: PreviousPeriodTotals = {
    from: new Date(prevFromMs).toISOString(),
    to: new Date(fromMs - 1).toISOString(),
    ...prev,
  }

  return {
    days,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    totals: { revenue: round2(revenue), orders: orderCount, items },
    previous,
    daily,
    payments: finish([...payMap.values()]),
    statuses: finish([...statusMap.values()]),
    cities: finish([...cityMap.values()]).map((c) => ({ city: c.label, count: c.count, total: c.total })),
    products,
    profit,
    customers,
    coupons,
    funnel,
    ops: { cancelled, cancelled7, waiting, abandoned },
    weekly: weeklyTop,
    features,
    truncated: false,
  }
}

/* ------------------------------------------------------------------ */
/* Catalog helpers (محصولات دارای بیشترین امتیاز + هشدار موجودی)       */
/* ------------------------------------------------------------------ */

/** Products with at least one review, sorted by rating (then review count). */
export function topRatedProducts(products: Product[], limit = 10): Product[] {
  return products
    .filter((p) => (Number(p.rating_count) || 0) > 0)
    .sort((a, b) => {
      const ra = Number(a.average_rating) || 0
      const rb = Number(b.average_rating) || 0
      return rb - ra || (Number(b.rating_count) || 0) - (Number(a.rating_count) || 0)
    })
    .slice(0, limit)
}

export interface StockAlert {
  product: Product
  /** low = زیر حد نصاب؛ out = ناموجود؛ back = سفارش عقب‌افتاده. */
  kind: 'low' | 'out' | 'back'
  qty: number | null
}

/** Stock alerts across the catalog against a reorder threshold. */
export function stockAlertsOf(products: Product[], threshold: number): StockAlert[] {
  const rows: StockAlert[] = []
  for (const p of products) {
    const qty = p.stock_quantity
    if (p.manage_stock && qty !== null) {
      if (qty <= threshold) rows.push({ product: p, kind: 'low', qty })
    } else if (p.stock_status === 'outofstock') {
      rows.push({ product: p, kind: 'out', qty: null })
    } else if (p.stock_status === 'onbackorder') {
      rows.push({ product: p, kind: 'back', qty: qty ?? null })
    }
  }
  const order = { low: 0, out: 1, back: 2 } as const
  return rows.sort((a, b) => {
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind]
    if (a.kind === 'low') return (a.qty ?? 0) - (b.qty ?? 0)
    return a.product.name.localeCompare(b.product.name)
  })
}
