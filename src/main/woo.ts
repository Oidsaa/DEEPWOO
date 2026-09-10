import crypto from 'node:crypto'
import type {
  ChangeLogQuery,
  ChangeLogResult,
  ChangeLogSection,
  Customer,
  CustomerPayload,
  CustomersResult,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  Order,
  OrderNote,
  OrderNotePayload,
  OrderPayload,
  OrdersListResult,
  OrdersResult,
  OrderStatusTotal,
  Product,
  ProductCatalog,
  ProductDetail,
  ProductOrdersResult,
  ProductPatch,
  ProductPayload,
  ProductsResult,
  ProductVariation,
  ReportsQuery,
  SalesReport,
  StoreStats,
  VariationPatch,
} from '../shared/types'
import { phonesMatch } from '../shared/phone'
import { persianMonthKey } from '../shared/persianMonth'
import { aggregateSalesReport, resolveReportWindow } from '../shared/reports'
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

/**
 * WooCommerce API versions are individually addressable; wc/v3 is the default.
 * 'wp' addresses the CORE WordPress REST API (/wp-json/wp/v2/…) — used to
 * identify the WordPress user who owns the API key (wp/v2/users/me), because
 * WooCommerce's OAuth filter authenticates every wp-json request.
 */
type ApiVersion = 'v2' | 'v3' | 'wp'

function restBase(siteUrl: string, version: ApiVersion = 'v3'): string {
  if (version === 'wp') return normalizeSiteUrl(siteUrl) + '/wp-json'
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

export async function wooRequest<T>(
  cfg: WooConfig,
  method: string,
  path: string,
  params: Record<string, string | number> = {},
  payload?: unknown,
  version: ApiVersion = 'v3',
  timeoutMs = 20000,
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
      signal: AbortSignal.timeout(timeoutMs),
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
 * Display name + id of the WordPress user who owns the API key. Every
 * WooCommerce API key is bound to a WP user, so per-کارشناس keys resolve to
 * per-کارشناس names — the attribution basis of the «لاگ تغییرات».
 * Returns an empty name when the store refuses the core endpoint (very old
 * WooCommerce or a security plugin) — the caller falls back gracefully.
 */
export async function wpUsersMe(cfg: WooConfig): Promise<{ id: number; name: string }> {
  const { data } = await wooRequest<{ id?: number; name?: string }>(
    cfg,
    'GET',
    '/wp/v2/users/me',
    { context: 'edit' },
    undefined,
    'wp',
    15000,
  )
  return { id: Number(data.id ?? 0), name: String(data.name ?? '').trim() }
}

/**
 * Name of the API key's owner from the «WC App Change Log» plugin itself
 * (wcapp/v1/ping authenticates with the same OAuth signature the log push
 * uses). wp/v2/users/me only works where WooCommerce honors its key auth on
 * the wp/ namespace — the plugin route is the reliable source.
 */
export async function getAuthUser(cfg: WooConfig): Promise<string | null> {
  const { data } = await wooRequest<any>(cfg, 'GET', '/wcapp/v1/ping', {}, undefined, 'wp', 10000)
  const name = String(data?.user ?? '').trim()
  return name || null
}

/**
 * Store currency code (واحد پولی). Primary source is the public data endpoint
 * — no settings access needed. Custom codes from تومان plugins are missing
 * from that list, so fall back to the general settings option.
 */
export async function fetchCurrencyCode(cfg: WooConfig): Promise<string | null> {
  try {
    const { data } = await wooRequest<any>(cfg, 'GET', '/data/currencies/current', {}, undefined, 'v3', 8000)
    const code = String(data?.code ?? '').trim()
    if (code) return code
  } catch {
    /* unknown/custom code or endpoint blocked — try settings */
  }
  try {
    const { data } = await wooRequest<any>(
      cfg,
      'GET',
      '/settings/general/woocommerce_currency',
      {},
      undefined,
      'v3',
      8000,
    )
    const value = String(data?.value ?? '').trim()
    if (value) return value
  } catch {
    /* read-only key or security plugin */
  }
  return null
}

/**
 * Push one change-log entry to the WP-side «WC App Change Log» plugin
 * (/wp-json/wcapp/v1/log). The plugin verifies the same OAuth signature the
 * app already sends and attributes the entry to the API key's owner.
 */
export async function postChangeLog(
  cfg: WooConfig,
  entry: {
    section: ChangeLogSection
    action: string
    title: string
    details?: string
    target?: string
    device?: string
    amount?: number
  },
): Promise<void> {
  await wooRequest(cfg, 'POST', '/wcapp/v1/log', {}, entry, 'wp', 10000)
}

/** Read the shared change log from the plugin — same shape as the local log result. */
export async function getServerChangeLog(cfg: WooConfig, q: ChangeLogQuery): Promise<ChangeLogResult> {
  const params: Record<string, string | number> = {
    page: Math.max(1, q.page ?? 1),
    per_page: Math.min(200, Math.max(10, q.perPage ?? 50)),
  }
  if (q.search) params.search = q.search
  if (q.user) params.user = q.user
  if (q.section) params.section = q.section
  if (q.action) params.action = q.action

  const { data } = await wooRequest<any>(cfg, 'GET', '/wcapp/v1/log', params, undefined, 'wp', 10000)
  return {
    entries: Array.isArray(data?.entries) ? data.entries : [],
    total: Number(data?.total) || 0,
    page: Number(data?.page) || 1,
    perPage: Number(data?.perPage) || Math.min(200, Math.max(10, q.perPage ?? 50)),
    users: Array.isArray(data?.users) ? data.users.map(String) : [],
  }
}

/**
 * Customers are listed via wc/v2 (NOT v3): the v3 endpoint intentionally omits
 * `orders_count` and `total_spent` for performance, while the table and the
 * order-history summary depend on both. v2 returns every other field identically
 * (same records, same pagination/search/orderby support). Create/update stay on
 * v3 — see createCustomer() — and wc/v2 answers whenever wc/v3 does, because
 * both live behind WooCommerce's same legacy REST API module.
 */
export async function listCustomers(cfg: WooConfig, query: ListCustomersQuery): Promise<CustomersResult> {
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

  // Quick-order mobile lookup: the customers endpoint has no phone filter, so
  // probe page 1 (newest customers) and — only when it has no match — sweep the
  // remaining pages concurrently (bounded), matching billing phone with lenient
  // normalization (۰۹۱۲… / +98912… / 912… are all the same number).
  if (query.phone) {
    const probe = await wooRequest<Customer[]>(
      cfg,
      'GET',
      '/customers',
      { page: 1, per_page: 100, orderby: 'registered_date', order: 'desc' },
      undefined,
      'v2',
    )
    const matches: Customer[] = probe.data.filter((c) => phonesMatch(c.billing?.phone, query.phone))
    if (matches.length === 0) {
      const total = Number(probe.headers.get('x-wp-total') ?? probe.data.length)
      const pages = Math.min(MAX_PHONE_SCAN_PAGES, Math.max(1, Math.ceil(total / 100)))
      if (pages > 1) {
        const sweeps = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) =>
            wooRequest<Customer[]>(
              cfg,
              'GET',
              '/customers',
              { page: i + 2, per_page: 100, orderby: 'registered_date', order: 'desc' },
              undefined,
              'v2',
            ),
          ),
        )
        for (const sweep of sweeps) {
          for (const c of sweep.data) if (phonesMatch(c.billing?.phone, query.phone)) matches.push(c)
        }
      }
    }
    return { customers: matches, total: matches.length, totalPages: 1, page: 1, perPage: matches.length }
  }

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

/** Cap on pages walked when snapshotting the customers (100 per page). */
const MAX_CUSTOMER_SNAPSHOT_PAGES = 100 // 100 × 100 = up to 10,000 customers

/** Compact field set kept in the local customers snapshot (phone matching). */
const CUSTOMER_LITE_FIELDS = 'id,username,first_name,last_name,email,billing'

/**
 * Full (bounded) customers snapshot, newest registrations first. Only the
 * compact field set is requested (`_fields`) so the snapshot stays small.
 * Powers the INSTANT quick-order mobile lookup from the local cache instead of
 * a per-keystroke sweep of the store's customer pages.
 */
export async function fetchAllCustomersLite(cfg: WooConfig): Promise<Customer[]> {
  const out: Customer[] = []
  let page = 0
  let totalPages = 1
  for (;;) {
    page += 1
    const { data, headers } = await wooRequest<Customer[]>(
      cfg,
      'GET',
      '/customers',
      { page, per_page: 100, orderby: 'registered_date', order: 'desc', _fields: CUSTOMER_LITE_FIELDS },
      undefined,
      'v2',
    )
    if (page === 1) totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
    out.push(...data)
    if (data.length === 0 || page >= totalPages || page >= MAX_CUSTOMER_SNAPSHOT_PAGES) break
  }
  return out
}

/**
 * Incremental refresh of the customers snapshot: with a previous copy only the
 * newest pages are probed for NEW registrations (registered_date desc) and
 * folded in by id — the full walk runs only on the first build or after a
 * manual refresh. (Customer edits/deletions are rare; the next full walk
 * repairs them.)
 */
export async function syncCustomersSnapshot(cfg: WooConfig, prev: Customer[] | undefined): Promise<Customer[]> {
  if (!prev) return fetchAllCustomersLite(cfg)
  const byId = new Map(prev.map((c) => [c.id, c]))
  let page = 0
  let totalPages = 1
  for (;;) {
    page += 1
    const { data, headers } = await wooRequest<Customer[]>(
      cfg,
      'GET',
      '/customers',
      { page, per_page: 100, orderby: 'registered_date', order: 'desc', _fields: CUSTOMER_LITE_FIELDS },
      undefined,
      'v2',
    )
    if (page === 1) totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
    let fresh = 0
    for (const c of data) {
      if (!byId.has(c.id)) fresh += 1
      byId.set(c.id, c)
    }
    if (data.length === 0 || page >= totalPages || page >= 5) break
    if (fresh === 0) break
  }
  return [...byId.values()]
}

/** Statuses shown by default (trash is never returned). */
const PRODUCT_STATUSES = ['publish', 'draft', 'private', 'pending']
/** Safety cap per status while merging the "all statuses" view. */
const MAX_PRODUCT_STATUS_PAGES = 10 // 10 × 100 = 1000 products per status
/** Safety cap while scanning customers by phone (100 per page). */
const MAX_PHONE_SCAN_PAGES = 25 // 25 × 100 = up to 2,500 customers scanned

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
 * Full (bounded) product catalog — every non-trash status, newest first.
 * Powers the محصولات/موجودی report tabs (top-rated + low-stock alerts),
 * which need every page of the catalog at once (listProducts only returns
 * the requested page slice).
 */
export async function getProductCatalog(cfg: WooConfig): Promise<ProductCatalog> {
  const out: Product[] = []
  let truncated = false
  for (const status of PRODUCT_STATUSES) {
    let p = 0
    for (;;) {
      p += 1
      const { data, headers } = await wooRequest<Product[]>(
        cfg,
        'GET',
        '/products',
        { page: p, per_page: 100, status, orderby: 'date', order: 'desc' },
      )
      out.push(...data)
      const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
      if (data.length === 0 || p >= totalPages) break
      if (p >= MAX_PRODUCT_STATUS_PAGES) {
        truncated = true
        break
      }
    }
  }
  const products = out.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  return { products, total: products.length, truncated }
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

/** Create an order (POST /orders). Requires a Read/Write API key. */
export async function createOrder(cfg: WooConfig, payload: OrderPayload): Promise<Order> {
  const { data } = await wooRequest<Order>(cfg, 'POST', '/orders', {}, payload)
  return data
}

/* ------------------------------------------------------------------ */
/* Sales report (گزارش‌های فروش)                                        */
/* ------------------------------------------------------------------ */

/** Safety cap while scanning the report window (100 orders per page). */
const MAX_REPORT_PAGES = 200 // 200 × 100 = up to 20,000 orders scanned

/**
 * Sales report for the last N days (including today): walks every page of
 * orders in the window and aggregates revenue / counts / top products via the
 * shared pure aggregator (same app rule as everywhere else in the app).
 */
export async function getSalesReports(
  cfg: WooConfig,
  query: ReportsQuery,
  costs?: Record<string, number>,
): Promise<SalesReport> {
  const { fromMs, toMs, days } = resolveReportWindow(query)
  const from = new Date(fromMs)
  const to = new Date(toMs + 1) // exclusive end → includes the whole last day
  // The equal-length window right before the report window (the «دورهٔ قبل»).
  const prevFrom = new Date(from)
  prevFrom.setDate(prevFrom.getDate() - days)

  // Scan each window in its own capped loop so the previous period can never
  // crowd the report's own (more recent) orders out of the page cap.
  const scan = async (after: Date, before: Date): Promise<{ orders: Order[]; truncated: boolean }> => {
    const out: Order[] = []
    let page = 0
    let totalPages = 1
    for (;;) {
      page += 1
      const res = await wooRequest<Order[]>(
        cfg,
        'GET',
        '/orders',
        {
          per_page: 100,
          page,
          orderby: 'date',
          order: 'asc',
          after: after.toISOString(),
          before: before.toISOString(),
        },
      )
      if (page === 1) totalPages = Math.max(1, Number(res.headers.get('x-wp-totalpages') ?? 1))
      out.push(...res.data)
      if (res.data.length < 100 || page >= totalPages || page >= MAX_REPORT_PAGES) break
    }
    return { orders: out, truncated: page >= MAX_REPORT_PAGES && page < totalPages }
  }

  const [cur, prev] = await Promise.all([scan(from, to), scan(prevFrom, from)])
  return {
    ...aggregateSalesReport(cur.orders, days, fromMs, toMs, costs, prev.orders),
    truncated: cur.truncated || prev.truncated,
  }
}

/* ------------------------------------------------------------------ */
/* Store-wide orders list (سفارش‌ها)                                    */
/* ------------------------------------------------------------------ */

/** Hard cap on pages walked when snapshotting the whole orders list. */
const MAX_ORDER_PAGES = 200 // 200 × 100 = up to 20,000 orders

/** Retries per orders page — shared hosting drops connections occasionally. */
const PAGE_RETRIES = 3

/**
 * One page of GET /orders with a few retries and a small backoff. A transient
 * drop on ONE page must not throw away the whole snapshot walk. The generous
 * 60s timeout matches slow shared hosting: real stores routinely take 20s+
 * per orders page, which a 20s timeout turns into an endless retry loop.
 */
async function ordersPageWithRetry(
  cfg: WooConfig,
  page: number,
  extra: Record<string, string | number> = {},
): Promise<{ data: Order[]; headers: Headers }> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < PAGE_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700 * attempt))
    try {
      return await wooRequest<Order[]>(
        cfg,
        'GET',
        '/orders',
        {
          per_page: 100,
          page,
          orderby: 'date',
          order: 'desc',
          ...extra,
        },
        undefined,
        'v3',
        60000,
      )
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

/**
 * Snapshot of ALL the store's orders, newest first (every status included).
 *
 * The desktop cache keeps this under a single key ('orders-all'), so the
 * orders page can serve status-filter, search and pagination changes LOCALLY:
 * clicking the status chips or typing in the search box reuses the last
 * snapshot instead of re-downloading the store. The snapshot is invalidated
 * like any other read — by writes (bumpCacheVersion), the list TTL, or a
 * manual «بارگذاری مجدد» (clearCaches).
 */
export async function fetchAllOrders(cfg: WooConfig): Promise<Order[]> {
  const firstRes = await ordersPageWithRetry(cfg, 1)
  const first = firstRes.data
  // One page of 100 comes back short → the store has no more orders.
  if (first.length < 100) {
    return Promise.all(first.map(async (o) => ({ ...o, customer_name: await customerNameOf(cfg, o) })))
  }
  const totalPages = Math.min(
    MAX_ORDER_PAGES,
    Math.max(1, Number(firstRes.headers.get('x-wp-totalpages') ?? 1)),
  )
  const pages = Array.from({ length: totalPages - 1 }, (_, i) => i + 2)

  // Remaining pages concurrently (bounded): each worker takes the next page.
  const rest: Order[][] = new Array(pages.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(6, pages.length) }, async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= pages.length) return
        rest[idx] = (await ordersPageWithRetry(cfg, pages[idx])).data
      }
    }),
  )
  const orders = [...first, ...rest.flat()]
  return Promise.all(orders.map(async (o) => ({ ...o, customer_name: await customerNameOf(cfg, o) })))
}

/* ------------------------------------------------------------------ */
/* Incremental snapshot sync (همگام‌سازی افزایشی)                        */
/* ------------------------------------------------------------------ */

/**
 * Every sync cursor is rewound by this margin so orders/products written on
 * the server DURING a sync (or host/desktop clock skew) are never skipped by
 * the next delta. Cursors are ms epochs sent as GMT ISO (modified_after works
 * against date_modified_gmt) — no store-timezone ambiguity at all.
 */
const SYNC_OVERLAP_MS = 5 * 60 * 1000
/** Minimum gap between two delete-scans (cheap id-only walks) per store. */
const DELETE_SCAN_GAP_MS = 10 * 60 * 1000
/** Per-store stamps of the last delete-scan (orders and products separately). */
const lastDeleteScan = new Map<string, number>()

export interface SnapshotSync<T> {
  value: T
  /** New sync cursor (ms epoch) — persist it with cache setSyncMark(). */
  since: number
}

/**
 * All order ids of the store (same scope as fetchAllOrders: every status,
 * trash excluded) via cheap `_fields=id` pages. Returns null when the walk
 * could not complete — the caller must then SKIP deletions, because deleting
 * against a partial id list would wrongly drop everything beyond the scanned
 * pages.
 */
async function scanOrderIds(cfg: WooConfig): Promise<Set<number> | null> {
  const ids = new Set<number>()
  let page = 0
  let totalPages = 1
  for (;;) {
    page += 1
    try {
      const res = await ordersPageWithRetry(cfg, page, { _fields: 'id' })
      if (page === 1) totalPages = Math.max(1, Number(res.headers.get('x-wp-totalpages') ?? 1))
      for (const o of res.data) ids.add(o.id)
      if (res.data.length === 0 || page >= totalPages) break
      if (page >= MAX_ORDER_PAGES) return null
    } catch {
      return null
    }
  }
  return ids
}

/**
 * Incremental version of fetchAllOrders(). With a previous snapshot and its
 * sync cursor only orders modified after the cursor are downloaded
 * (modified_after) and folded in by id; orders deleted on the store (trashed)
 * are dropped by a throttled id-only diff scan. Stores too old to know
 * `modified_after` ignore the parameter and return everything — the merge is
 * idempotent, so the sync stays CORRECT (just not incremental). A missing or
 * empty previous snapshot re-baselines with a full walk.
 */
export async function syncOrdersSnapshot(
  cfg: WooConfig,
  prev: Order[] | undefined,
  sinceMs?: number,
): Promise<SnapshotSync<Order[]>> {
  if (!prev || prev.length === 0 || !sinceMs) {
    const orders = await fetchAllOrders(cfg)
    return { value: orders, since: Date.now() - SYNC_OVERLAP_MS }
  }

  const modifiedAfter = new Date(sinceMs).toISOString()
  const changed: Order[] = []
  let page = 0
  let totalPages = 1
  for (;;) {
    page += 1
    const res = await ordersPageWithRetry(cfg, page, { modified_after: modifiedAfter })
    if (page === 1) totalPages = Math.max(1, Number(res.headers.get('x-wp-totalpages') ?? 1))
    changed.push(...res.data)
    if (res.data.length === 0 || page >= totalPages || page >= MAX_ORDER_PAGES) break
  }

  // Enrich changed rows with the same display-name rule as a full walk
  // (billing name → account lookup, cached), then fold them in by id.
  const enriched = await Promise.all(changed.map(async (o) => ({ ...o, customer_name: await customerNameOf(cfg, o) })))
  const byId = new Map(prev.map((o) => [o.id, o]))
  for (const o of enriched) byId.set(o.id, o)
  let orders = [...byId.values()]

  const now = Date.now()
  if (now - (lastDeleteScan.get(cfg.siteUrl + '|orders') ?? 0) >= DELETE_SCAN_GAP_MS) {
    lastDeleteScan.set(cfg.siteUrl + '|orders', now)
    const ids = await scanOrderIds(cfg)
    if (ids) orders = orders.filter((o) => ids.has(o.id))
  }

  orders.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  return { value: orders, since: now - SYNC_OVERLAP_MS }
}

/**
 * All product ids across the catalog's statuses (cheap `_fields=id` pages).
 * Returns null when the walk could not complete (see scanOrderIds).
 */
async function scanProductIds(cfg: WooConfig): Promise<Set<number> | null> {
  const ids = new Set<number>()
  for (const status of PRODUCT_STATUSES) {
    let page = 0
    for (;;) {
      page += 1
      try {
        const { data, headers } = await wooRequest<Product[]>(cfg, 'GET', '/products', {
          page,
          per_page: 100,
          status,
          orderby: 'date',
          order: 'desc',
          _fields: 'id',
        })
        for (const p of data) ids.add(p.id)
        const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
        if (data.length === 0 || page >= totalPages) break
        if (page >= MAX_PRODUCT_STATUS_PAGES) return null
      } catch {
        return null
      }
    }
  }
  return ids
}

/**
 * Incremental version of getProductCatalog(): modified_after delta per catalog
 * status, idempotent fold-in by id, throttled complete-scan deletion diff —
 * the same rules as syncOrdersSnapshot(). The truncated flag survives from the
 * previous snapshot (a delta cannot repair a truncated baseline) and is
 * re-armed when a delta walk hits the per-status page cap.
 */
export async function syncProductCatalog(
  cfg: WooConfig,
  prev: ProductCatalog | undefined,
  sinceMs?: number,
): Promise<SnapshotSync<ProductCatalog>> {
  if (!prev || prev.products.length === 0 || !sinceMs) {
    const catalog = await getProductCatalog(cfg)
    return { value: catalog, since: Date.now() - SYNC_OVERLAP_MS }
  }

  const modifiedAfter = new Date(sinceMs).toISOString()
  const changed: Product[] = []
  let truncated = prev.truncated
  for (const status of PRODUCT_STATUSES) {
    let page = 0
    for (;;) {
      page += 1
      const { data, headers } = await wooRequest<Product[]>(cfg, 'GET', '/products', {
        page,
        per_page: 100,
        status,
        orderby: 'date',
        order: 'desc',
        modified_after: modifiedAfter,
      })
      changed.push(...data)
      const totalPages = Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1))
      if (data.length === 0 || page >= totalPages) break
      if (page >= MAX_PRODUCT_STATUS_PAGES) {
        truncated = true
        break
      }
    }
  }

  const byId = new Map(prev.products.map((p) => [p.id, p]))
  for (const p of changed) byId.set(p.id, p)
  let products = [...byId.values()]

  const now = Date.now()
  if (now - (lastDeleteScan.get(cfg.siteUrl + '|products') ?? 0) >= DELETE_SCAN_GAP_MS) {
    lastDeleteScan.set(cfg.siteUrl + '|products', now)
    const ids = await scanProductIds(cfg)
    if (ids) products = products.filter((p) => ids.has(p.id))
  }

  products.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  return { value: { products, total: products.length, truncated }, since: now - SYNC_OVERLAP_MS }
}

/**
 * Local filtering/pagination over a full orders snapshot (mirrors the demo
 * mock): search across order number, customer name, phone and email; optional
 * status filter; newest-first page slice.
 */
export function filterAndPaginateOrders(all: Order[], query: ListOrdersQuery): OrdersListResult {
  const search = (query.search ?? '').trim().toLowerCase()
  let list = all
  if (search) {
    list = list.filter(
      (o) =>
        String(o.number ?? o.id).toLowerCase().includes(search) ||
        (o.customer_name ?? '').toLowerCase().includes(search) ||
        (o.billing?.phone ?? '').toLowerCase().includes(search) ||
        (o.billing?.email ?? '').toLowerCase().includes(search),
    )
  }
  const status = (query.status ?? '').trim()
  if (status) list = list.filter((o) => o.status === status)

  const perPage = Math.min(100, Math.max(1, query.perPage ?? 50))
  const page = Math.max(1, query.page ?? 1)
  const start = (page - 1) * perPage
  return {
    orders: list.slice(start, start + perPage),
    total: list.length,
    totalPages: Math.max(1, Math.ceil(list.length / perPage)),
    page,
    perPage,
  }
}

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

  const all = await fetchAllOrders(cfg)
  return filterAndPaginateOrders(all, query)
}

/* ------------------------------------------------------------------ */
/* Order status totals (تعداد سفارش‌های هر وضعیت)                        */
/* ------------------------------------------------------------------ */

/**
 * Order counts per status (GET /reports/orders/totals). Used for the
 * sidebar's in-progress badge and the orders-page filter chips. The trash
 * status is dropped because the orders list never shows it.
 */
export async function listOrderStatusTotals(cfg: WooConfig): Promise<OrderStatusTotal[]> {
  const { data } = await wooRequest<Array<{ slug?: string; name?: string; total?: string | number }>>(
    cfg,
    'GET',
    '/reports/orders/totals',
    {},
  )
  return (data ?? [])
    .filter((s) => !!s.slug && s.slug !== 'trash')
    .map((s) => ({ slug: s.slug as string, name: s.name ?? (s.slug as string), total: Number(s.total) || 0 }))
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
