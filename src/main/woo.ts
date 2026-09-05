import crypto from 'node:crypto'
import type {
  Customer,
  CustomerPayload,
  CustomersResult,
  ListOrdersQuery,
  ListProductsQuery,
  Order,
  OrderNote,
  OrderNotePayload,
  OrdersListResult,
  OrdersResult,
  Product,
  ProductDetail,
  ProductOrdersResult,
  ProductPatch,
  ProductPayload,
  ProductsResult,
  ProductVariation,
  StoreStats,
  VariationPatch,
} from '../shared/types'
import { persianMonthKey } from '../shared/persianMonth'
import { normalizeSiteUrl } from './settings'

export interface WooConfig {
  siteUrl: string
  consumerKey: string
  consumerSecret: string
}

/** RFC 3986 percent-encoding (encodeURIComponent leaves ! ' ( ) * untouched). */
function enc(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** WooCommerce API versions are individually addressable; wc/v3 is the default. */
type ApiVersion = 'v2' | 'v3'

function restBase(siteUrl: string, version: ApiVersion = 'v3'): string {
  return normalizeSiteUrl(siteUrl) + '/wp-json/wc/' + version
}

function signAndBuildUrl(
  cfg: WooConfig,
  method: string,
  path: string,
  params: Record<string, string | number>,
  version: ApiVersion = 'v3',
): URL {
  const url = new URL(restBase(cfg.siteUrl, version) + path)

  const oauth: Record<string, string> = {
    oauth_consumer_key: cfg.consumerKey,
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_version: '1.0',
  }

  const all: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...oauth, ...params })) {
    if (v !== undefined && v !== null && String(v) !== '') all[k] = String(v)
  }

  const paramString = Object.keys(all)
    .sort()
    .map((k) => enc(k) + '=' + enc(all[k]))
    .join('&')

  // OAuth 1.0a signature base string:
  //   HTTP_METHOD & percentEncode(URL) & percentEncode(sorted & encoded params)
  const baseString = [method, enc(url.origin + url.pathname), enc(paramString)].join('&')
  const signingKey = enc(cfg.consumerSecret) + '&'
  const signature = crypto.createHmac('sha1', signingKey).update(baseString, 'utf8').digest('base64')

  all.oauth_signature = signature
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v)
  return url
}

function friendlyError(status: number | null, body: any, raw: unknown): Error {
  // Persian-friendly messages for the most common failure modes.
  if (raw instanceof TypeError || (raw as any)?.cause?.code === 'ECONNREFUSED' || status === null) {
    return new Error('ارتباط با فروشگاه برقرار نشد. آدرس سایت و اتصال اینترنت را بررسی کنید.')
  }
  if (status === 401) {
    return new Error('احراز هویت ناموفق بود — کلید مصرف‌کننده یا رمز مصرف‌کننده اشتباه است.')
  }
  if (status === 403) {
    return new Error('دسترسی کافی نیست — کلید API باید دسترسی «خواندن/نوشتن» (Read/Write) داشته باشد.')
  }
  if (status === 401 && body?.code === 'woocommerce_rest_cannot_create') {
    return new Error('کلید API دسترسی نوشتن ندارد — برای افزودن مشتری، دسترسی Read/Write را در ووکامرس تنظیم کنید.')
  }
  if (status === 404) {
    return new Error('آدرس REST پیدا نشد — از نصب بودن ووکامرس روی سایت و درستی آدرس مطمئن شوید.')
  }
  if (body?.message && typeof body.message === 'string') {
    return new Error(body.message)
  }
  return new Error('خطای نامشخص هنگام ارتباط با فروشگاه (HTTP ' + (status ?? '?') + ')')
}

async function wooRequest<T>(
  cfg: WooConfig,
  method: string,
  path: string,
  params: Record<string, string | number> = {},
  payload?: unknown,
  version: ApiVersion = 'v3',
): Promise<{ data: T; headers: Headers }> {
  let res: Response
  try {
    const url = signAndBuildUrl(cfg, method, path, params, version)
    res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(20000),
      redirect: 'follow',
    })
  } catch (err) {
    throw friendlyError(null, null, err)
  }

  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) throw friendlyError(res.status, body, null)
  return { data: body as T, headers: res.headers }
}

/** Lightweight connection check: fetch one customer. Returns the total customer count. */
export async function testConnection(cfg: WooConfig): Promise<{ ok: true; totalCustomers: number }> {
  const { headers } = await wooRequest<unknown>(cfg, 'GET', '/customers', { per_page: 1 })
  return { ok: true, totalCustomers: Number(headers.get('x-wp-total') ?? 0) }
}

/**
 * Customers are listed via wc/v2 (NOT v3): the v3 endpoint intentionally omits
 * `orders_count` and `total_spent` for performance, while the table and the
 * order-history summary depend on both. v2 returns every other field identically
 * (same records, same pagination/search/orderby support). Create/update stay on
 * v3 — see createCustomer() — and wc/v2 answers whenever wc/v3 does, because
 * both live behind WooCommerce's same legacy REST API module.
 */
export async function listCustomers(
  cfg: WooConfig,
  query: { search?: string; page?: number; perPage?: number },
): Promise<CustomersResult> {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(100, Math.max(1, query.perPage ?? 100))

  const params: Record<string, string | number> = {
    page,
    per_page: perPage,
    // Customers accept id | include | name | registered_date — NOT `registered`/`date`.
    orderby: 'registered_date',
    order: 'desc',
  }
  const search = query.search?.trim()
  if (search) params.search = search

  const { data, headers } = await wooRequest<Customer[]>(cfg, 'GET', '/customers', params, undefined, 'v2')

  // Replace each row's total_spent (store semantics: paid orders only) with the
  // app's rule-based total (every status except failed/cancelled/refunded). A
  // per-customer failure keeps the store value so a slow/flaky order never
  // breaks the whole list; computed values are cached per session.
  await mapLimit(
    data.filter((c) => (Number(c.orders_count) || 0) > 0),
    8,
    async (c) => {
      try {
        c.total_spent = String(await purchaseSumCached(cfg, c))
      } catch {
        /* keep the store-provided total_spent */
      }
    },
  )

  return {
    customers: data,
    total: Number(headers.get('x-wp-total') ?? data.length),
    totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)),
    page,
    perPage,
  }
}

/** Statuses shown by default (trash is never returned). */
const PRODUCT_STATUSES = ['publish', 'draft', 'private', 'pending']
/** Safety cap per status while merging the "all statuses" view. */
const MAX_PRODUCT_STATUS_PAGES = 10 // 10 × 100 = 1000 products per status

/**
 * Product list (GET /products), newest first.
 *
 * The REST API accepts ONE product status per call on every WooCommerce
 * version (multi-value lists such as `publish,draft` are rejected as an
 * invalid parameter on older/plugin-guarded stores), so the requested status
 * (or each default status when "همهٔ وضعیت‌ها" is chosen) is fetched in
 * parallel, page by page, and merged & sorted locally.
 *
 * Every matching page is fetched so the result carries exact aggregates —
 * inStock / outOfStock / totalSales — over ALL matching products, and the
 * requested page is sliced out locally (the widgets above the table are
 * therefore never limited to the current page).
 */
export async function listProducts(
  cfg: WooConfig,
  query: ListProductsQuery,
): Promise<ProductsResult> {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(100, Math.max(1, query.perPage ?? 100))
  const requested = (query.status ?? '').trim()
  const search = query.search?.trim()
  const stock = (query.stockStatus ?? '').trim()

  const statuses = requested ? [requested] : PRODUCT_STATUSES

  const fetchStatus = async (status: string, applyStock: boolean): Promise<Product[]> => {
    const all: Product[] = []
    let p = 1
    for (;;) {
      const params: Record<string, string | number> = {
        page: p,
        per_page: 100,
        status,
        orderby: 'date',
        order: 'desc',
      }
      if (search) params.search = search
      if (applyStock && stock) params.stock_status = stock
      const { data, headers } = await wooRequest<Product[]>(cfg, 'GET', '/products', params)
      all.push(...data)
      const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
      if (p >= totalPages || data.length === 0 || p >= MAX_PRODUCT_STATUS_PAGES) break
      p += 1
    }
    return all
  }

  // Row list and aggregates. The aggregates deliberately ignore the stock
  // segment so the stat widgets always describe the whole filtered store
  // (search + publication status), never just the currently shown segment.
  let rowsGroups: Product[][]
  let statsGroups: Product[][]
  if (stock) {
    ;[rowsGroups, statsGroups] = await Promise.all([
      Promise.all(statuses.map((s) => fetchStatus(s, true))),
      Promise.all(statuses.map((s) => fetchStatus(s, false))),
    ])
  } else {
    statsGroups = await Promise.all(statuses.map((s) => fetchStatus(s, false)))
    rowsGroups = statsGroups
  }

  const byDate = (a: Product, b: Product) => +new Date(b.date_created) - +new Date(a.date_created)
  const rows = rowsGroups.flat().sort(byDate)
  const stats = statsGroups.flat().sort(byDate)
  const total = rows.length
  const totalAll = stats.length
  const inStock = stats.filter((p) => p.stock_status === 'instock').length
  const outOfStock = stats.filter((p) => p.stock_status === 'outofstock').length
  const totalSales = round2(stats.reduce((acc, p) => acc + (Number(p.total_sales) || 0), 0))
  const totalPages = Math.max(1, Math.ceil(total / perPage))
  const start = (page - 1) * perPage
  return {
    products: rows.slice(start, start + perPage),
    total,
    totalPages,
    page,
    perPage,
    totalAll,
    inStock,
    outOfStock,
    totalSales,
  }
}

/**
 * Full product record plus its variations (variable products only). Reads
 * every variation page up to a hard cap of 2000 variations.
 */
export async function getProductDetail(cfg: WooConfig, productId: number): Promise<ProductDetail> {
  const { data } = await wooRequest<Product>(cfg, 'GET', '/products/' + productId)
  const variations: ProductVariation[] = []
  if (data.type === 'variable') {
    let page = 1
    for (;;) {
      const { data: pageData, headers } = await wooRequest<ProductVariation[]>(
        cfg,
        'GET',
        `/products/${productId}/variations`,
        { per_page: 100, page, orderby: 'id', order: 'asc' },
      )
      variations.push(...pageData)
      const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
      if (page >= totalPages || pageData.length === 0 || page >= 20) break
      page += 1
    }
  }
  return { product: data, variations }
}

/** Update one variation's price/stock (PUT …/products/{id}/variations/{vid}). */
export async function updateProductVariation(
  cfg: WooConfig,
  productId: number,
  variationId: number,
  patch: VariationPatch,
): Promise<ProductVariation> {
  const { data } = await wooRequest<ProductVariation>(
    cfg,
    'PUT',
    `/products/${productId}/variations/${variationId}`,
    {},
    patch,
  )
  return data
}

/** Update a (simple) product's status/price/stock (PUT …/products/{id}). */
export async function updateProduct(cfg: WooConfig, productId: number, patch: ProductPatch): Promise<Product> {
  const { data } = await wooRequest<Product>(cfg, 'PUT', '/products/' + productId, {}, patch)
  return data
}

/** Create a product (POST /products). Requires a Read/Write API key. */
export async function createProduct(cfg: WooConfig, payload: ProductPayload): Promise<Product> {
  const { data } = await wooRequest<Product>(cfg, 'POST', '/products', {}, payload)
  return data
}

const MAX_PRODUCT_ORDER_PAGES = 20 // 20 × 100 = 2000 orders scanned max per product

/**
 * Orders that contain a given product (incl. its variations — the `product`
 * filter matches the parent product id on line items), newest first. Only
 * orders whose status counts toward sales are returned and counted (the same
 * rule as customer totals: failed / cancelled / refunded orders are excluded
 * from the list, the order count, the units and the revenue sum).
 */
export async function listProductOrders(cfg: WooConfig, productId: number): Promise<ProductOrdersResult> {
  // No explicit `status` parameter: it is rejected as invalid on some stores,
  // and "all statuses" is the orders endpoint's own default anyway.
  const pageParams = (page: number) =>
    ({
      product: productId,
      per_page: 100,
      page,
      orderby: 'date',
      order: 'desc',
    }) as Record<string, string | number>

  // Scan every page (bounded) so the filtered count is exact.
  const all: Order[] = []
  let totalPages = 1
  let page = 0
  for (;;) {
    page += 1
    const res = await wooRequest<Order[]>(cfg, 'GET', '/orders', pageParams(page))
    if (page === 1) totalPages = Math.max(1, Number(res.headers.get('x-wp-totalpages') ?? 1))
    all.push(...res.data)
    if (res.data.length === 0 || page >= totalPages || page >= MAX_PRODUCT_ORDER_PAGES) break
  }
  const truncated = page >= MAX_PRODUCT_ORDER_PAGES && page < totalPages

  const productLines = (o: Order) => o.line_items.filter((l) => (l.product_id ?? productId) === productId)
  const valid = all.filter((o) => countsTowardPurchase(o.status))
  const unitsSold = valid.reduce((acc, o) => acc + productLines(o).reduce((s, l) => s + (Number(l.quantity) || 0), 0), 0)
  const revenueSum = round2(valid.reduce((acc, o) => acc + (Number(o.total) || 0), 0))

  return {
    orders: valid,
    total: valid.length,
    unitsSold,
    revenueSum,
    excluded: all.length - valid.length,
    revenueTruncated: truncated,
    truncated,
  }
}

/** Create a customer (POST /customers). Requires a Read/Write API key. */
export async function createCustomer(cfg: WooConfig, payload: CustomerPayload): Promise<Customer> {
  const { data } = await wooRequest<Customer>(cfg, 'POST', '/customers', {}, payload)
  return data
}

/* ------------------------------------------------------------------ */
/* Store-wide orders list (سفارش‌ها)                                    */
/* ------------------------------------------------------------------ */

/** Session cache of customer display names for orders whose billing name is empty. */
const customerNameCache = new Map<string, string>()

/** Display name of an order's customer: billing name first, then the account. */
async function customerNameOf(cfg: WooConfig, order: Order): Promise<string> {
  const billingName = [order.billing?.first_name, order.billing?.last_name].filter(Boolean).join(' ').trim()
  if (billingName) return billingName
  const id = order.customer_id
  if (!id) return 'مشتری مهمان'
  const key = cfg.siteUrl + '|' + id
  const hit = customerNameCache.get(key)
  if (hit) return hit
  try {
    const { data } = await wooRequest<Customer>(cfg, 'GET', '/customers/' + id)
    const name = [data.first_name, data.last_name].filter(Boolean).join(' ').trim()
    if (name) {
      customerNameCache.set(key, name)
      return name
    }
  } catch {
    // Account may be deleted — fall through to the id-based label.
  }
  const label = 'مشتری #' + id
  customerNameCache.set(key, label)
  return label
}

/**
 * One page of the store's orders, newest first. Shows every status (failed,
 * cancelled, … included) so the store manager can act on all of them; the
 * status-based exclusion rule only applies to sales totals elsewhere.
 */
export async function listOrders(cfg: WooConfig, query: ListOrdersQuery): Promise<OrdersListResult> {
  // Bulk print fetch: `include` pins the exact ids (≤100 per request, so chunk).
  if (query.include && query.include.length > 0) {
    const CHUNK = 100
    const chunks: number[][] = []
    for (let i = 0; i < query.include.length; i += CHUNK) chunks.push(query.include.slice(i, i + CHUNK))
    const results = await Promise.all(
      chunks.map(async (ids) => {
        const { data } = await wooRequest<Order[]>(cfg, 'GET', '/orders', {
          include: ids.join(','),
          per_page: Math.min(100, ids.length),
        })
        return data
      }),
    )
    const byId = new Map(results.flat().map((o) => [o.id, o]))
    const ordered = query.include.map((id) => byId.get(id)).filter((o): o is Order => !!o)
    const orders = await Promise.all(ordered.map(async (o) => ({ ...o, customer_name: await customerNameOf(cfg, o) })))
    return { orders, total: orders.length, totalPages: 1, page: 1, perPage: orders.length }
  }

  const perPage = Math.min(100, Math.max(1, query.perPage ?? 50))
  const page = Math.max(1, query.page ?? 1)
  const params: Record<string, string | number> = {
    per_page: perPage,
    page,
    orderby: 'date',
    order: 'desc',
  }
  const search = (query.search ?? '').trim()
  if (search) params.search = search

  const { data, headers } = await wooRequest<Order[]>(cfg, 'GET', '/orders', params)
  const orders = await Promise.all(data.map(async (o) => ({ ...o, customer_name: await customerNameOf(cfg, o) })))
  return {
    orders,
    total: Number(headers.get('x-wp-total') ?? data.length),
    totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)),
    page,
    perPage,
  }
}

/* ------------------------------------------------------------------ */
/* Order notes (یادداشت‌های سفارش)                                       */
/* ------------------------------------------------------------------ */

/**
 * Notes of one order (GET /orders/{id}/notes), newest first. Private and
 * system notes are included for authenticated (read/write) API consumers.
 */
export async function listOrderNotes(cfg: WooConfig, orderId: number): Promise<OrderNote[]> {
  const { data } = await wooRequest<OrderNote[]>(cfg, 'GET', `/orders/${orderId}/notes`, {
    per_page: 100,
    orderby: 'date',
    order: 'desc',
  })
  return data
}

/** Add a note to an order (POST /orders/{id}/notes). Requires a Read/Write key. */
export async function createOrderNote(
  cfg: WooConfig,
  orderId: number,
  payload: OrderNotePayload,
): Promise<OrderNote> {
  const { data } = await wooRequest<OrderNote>(cfg, 'POST', `/orders/${orderId}/notes`, {}, payload)
  return data
}

/** Change an order's status (PUT /orders/{id} with { status }). */
export async function updateOrderStatus(cfg: WooConfig, orderId: number, status: string): Promise<Order> {
  const { data } = await wooRequest<Order>(cfg, 'PUT', '/orders/' + orderId, {}, { status })
  return data
}

/* ------------------------------------------------------------------ */
/* Purchase totals (مجموع خرید) — app rule, not WooCommerce's own       */
/* ------------------------------------------------------------------ */

/**
 * Which statuses count toward a customer's purchase total.
 * WooCommerce's own total_spent only counts paid orders (processing/completed);
 * this app counts every order except failed, cancelled and refunded ones.
 */
const PURCHASE_EXCLUDED_STATUSES = new Set(['failed', 'cancelled', 'refunded'])

function countsTowardPurchase(status: string | undefined | null): boolean {
  return !!status && !PURCHASE_EXCLUDED_STATUSES.has(status)
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Safety cap: a single customer with more orders than this is treated as truncated. */
const MAX_PURCHASE_PAGES = 20 // 20 × 100 = 2000 orders max per customer

async function fetchOrdersPage(
  cfg: WooConfig,
  customerId: number,
  page: number,
): Promise<{ orders: Order[]; total: number }> {
  const { data, headers } = await wooRequest<Order[]>(cfg, 'GET', '/orders', {
    customer: customerId,
    per_page: 100,
    page,
    orderby: 'date',
    order: 'desc',
  })
  return { orders: data, total: Number(headers.get('x-wp-total') ?? data.length) }
}

/**
 * Order history of one customer (newest first, up to 100 cards) plus the exact
 * rule-based purchase sum, computed across ALL of the customer's orders (pages
 * beyond the first are fetched only to total them up).
 */
export async function listCustomerOrders(cfg: WooConfig, customerId: number): Promise<OrdersResult> {
  const first = await fetchOrdersPage(cfg, customerId, 1)
  const orders = first.orders
  const total = first.total

  let purchaseSum = orders.reduce((a, o) => a + (countsTowardPurchase(o.status) ? Number(o.total) || 0 : 0), 0)
  let page = 1
  let lastPageWasFull = orders.length === 100

  // The first page may hold exactly 100 orders with more behind it — keep
  // walking pages until one comes back short (all orders fetched) or the cap.
  while (lastPageWasFull && page < MAX_PURCHASE_PAGES) {
    page += 1
    const next = await fetchOrdersPage(cfg, customerId, page)
    purchaseSum += next.orders.reduce(
      (a, o) => a + (countsTowardPurchase(o.status) ? Number(o.total) || 0 : 0),
      0,
    )
    lastPageWasFull = next.orders.length === 100
  }
  // Stopped only because the cap was reached while pages were still full → the
  // sum is a lower bound (truncated).
  const truncated = lastPageWasFull && page === MAX_PURCHASE_PAGES

  return {
    orders,
    total,
    page: 1,
    perPage: 100,
    purchaseSum: round2(purchaseSum),
    purchaseSumTruncated: truncated,
  }
}

/* Session cache + bounded concurrency for enriching the customers list and for
 * the store-wide KPIs. One per-customer order read feeds both the row's
 * مجموع خرید and the store totals, so nothing is fetched twice per session. */
const CUST_STATS_MAX = 3000

interface CustStats {
  sum: number
  /** Customer has at least one counted order in the current Persian month. */
  thisMonth: boolean
}

const custStatsCache = new Map<string, CustStats>()

/** Rule-based purchase sum + "bought in the current Persian month" for one customer. */
async function customerStatsCached(cfg: WooConfig, customer: Customer): Promise<CustStats> {
  const ordersCount = Number(customer.orders_count) || 0
  if (ordersCount <= 0) return { sum: 0, thisMonth: false }
  const key = cfg.siteUrl + '|' + customer.id
  const hit = custStatsCache.get(key)
  if (hit) return hit

  const curMonth = persianMonthKey(new Date())
  let sum = 0
  let thisMonth = false
  const visit = (orders: Order[]): void => {
    for (const o of orders) {
      if (!countsTowardPurchase(o.status)) continue
      sum += Number(o.total) || 0
      if (!thisMonth && persianMonthKey(new Date(o.date_created)) === curMonth) thisMonth = true
    }
  }
  const first = await fetchOrdersPage(cfg, customer.id, 1)
  visit(first.orders)
  let page = 1
  let full = first.orders.length === 100
  while (full && page < MAX_PURCHASE_PAGES) {
    page += 1
    const next = await fetchOrdersPage(cfg, customer.id, page)
    visit(next.orders)
    full = next.orders.length === 100
  }

  const out: CustStats = { sum: round2(sum), thisMonth }
  if (custStatsCache.size >= CUST_STATS_MAX) custStatsCache.delete(custStatsCache.keys().next().value as string)
  custStatsCache.set(key, out)
  return out
}

/** Rule-based مجموع خرید of one customer (row enrichment — shares the cache above). */
async function purchaseSumCached(cfg: WooConfig, customer: Customer): Promise<number> {
  return (await customerStatsCached(cfg, customer)).sum
}

/** Run tasks with at most `limit` in flight. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
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

/* ------------------------------------------------------------------ */
/* Store-wide customer KPIs (مجموع خرید همهٔ مشتریان + خریداران ماه جاری) */
/* ------------------------------------------------------------------ */

const MAX_CUSTOMER_STAT_PAGES = 100 // 100 × 100 = up to 10,000 customers scanned
const storeStatsBySite = new Map<string, { promise: Promise<StoreStats> | null; result: StoreStats | null }>()

/**
 * Walks every page of customers (newest first) and, for customers that have
 * orders, reads their order history once to derive the rule-based مجموع خرید
 * and whether they bought in the current Persian month. Per-customer failures
 * are skipped (marked `partial`) so one flaky customer never kills the KPI.
 */
async function computeStoreStats(cfg: WooConfig): Promise<StoreStats> {
  let totalCustomers = 0
  let sum = 0
  let monthCustomers = 0
  let partial = false
  let page = 0
  let totalPages = 1
  for (;;) {
    page += 1
    const { data, headers } = await wooRequest<Customer[]>(
      cfg,
      'GET',
      '/customers',
      { page, per_page: 100, orderby: 'registered_date', order: 'desc' },
      undefined,
      'v2',
    )
    if (page === 1) totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
    await mapLimit(
      data.filter((c) => (Number(c.orders_count) || 0) > 0),
      12,
      async (c) => {
        try {
          const st = await customerStatsCached(cfg, c)
          sum = round2(sum + st.sum)
          if (st.thisMonth) monthCustomers += 1
        } catch {
          partial = true
        }
      },
    )
    totalCustomers += data.length
    if (data.length === 0 || page >= totalPages || page >= MAX_CUSTOMER_STAT_PAGES) break
  }
  return {
    totalCustomers,
    sum: round2(sum),
    monthCustomers,
    partial,
    truncated: page >= MAX_CUSTOMER_STAT_PAGES && page < totalPages,
    computedAt: new Date().toISOString(),
  }
}

/**
 * Store-wide customer KPIs. Computed once per session & store (then cached
 * in-memory); concurrent callers share the single running computation.
 */
export async function getStoreStats(cfg: WooConfig): Promise<StoreStats> {
  let entry = storeStatsBySite.get(cfg.siteUrl)
  if (!entry) {
    entry = { promise: null, result: null }
    storeStatsBySite.set(cfg.siteUrl, entry)
  }
  if (entry.result) return entry.result
  if (!entry.promise) {
    entry.promise = computeStoreStats(cfg)
      .then((r) => {
        entry.result = r
        return r
      })
      .finally(() => {
        entry.promise = null
      })
  }
  return entry.promise
}
