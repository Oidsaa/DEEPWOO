import type {
  DailySale,
  GrossProfitSummary,
  NamedAmount,
  Order,
  PreviousPeriodTotals,
  ProductProfitRow,
  SalesReport,
  TopSeller,
} from './types'

/**
 * Pure aggregator for the sales report — shared by the real client
 * (src/main/woo.ts) and the browser mock (src/renderer/lib/mock.ts) so the
 * two always produce identical numbers from the same orders.
 *
 * Money follows the app rule everywhere: failed / cancelled / refunded orders
 * are excluded from revenue, order counts and item counts.
 */

const PURCHASE_EXCLUDED = new Set(['failed', 'cancelled', 'refunded'])

const round2 = (n: number): number => Math.round(n * 100) / 100

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local (not UTC) date key — the day axis of the report chart. */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const TOP_PRODUCTS = 10
const TOP_GROUPS = 8
const GROSS_ROWS = 25

/** True when the order should count toward the report totals (app rule). */
export function reportCountsToward(status: string | undefined | null): boolean {
  return !!status && !PURCHASE_EXCLUDED.has(status)
}

/** Counted totals of an order list (same app rule as the report window). */
export function countTotalsOf(orders: Order[]): { revenue: number; orders: number; items: number } {
  let revenue = 0
  let ordersN = 0
  let items = 0
  for (const o of orders) {
    if (!reportCountsToward(o.status)) continue
    revenue = round2(revenue + (Number(o.total) || 0))
    ordersN += 1
    items += o.line_items.reduce((a, l) => a + (Number(l.quantity) || 0), 0)
  }
  return { revenue: round2(revenue), orders: ordersN, items }
}

/**
 * Aggregate every counted order (already inside the window) into the report.
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

  for (const o of orders) {
    if (!reportCountsToward(o.status)) continue
    const t = Number(o.total) || 0
    const created = new Date(o.date_created)
    const valid = !Number.isNaN(created.getTime())
    const day = valid ? localDateKey(created) : localDateKey(new Date(fromMs))

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
    bump(statusMap, o.status || 'unknown', t)
    bump(cityMap, (o.billing?.city || '').trim() || 'نامشخص', t)

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
    truncated: false,
  }
}