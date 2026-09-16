import crypto from 'node:crypto'
import type {
  ChangeLogQuery,
  ChangeLogResult,
  ChangeLogSection,
  Coupon,
  Customer,
  CustomerPayload,
  Order,
  OrderNote,
  OrderNotePayload,
  OrderPayload,
  OrderStatusTotal,
  OrderUpdatePayload,
  Product,
  ProductDetail,
  ProductPatch,
  ProductPayload,
  ProductVariation,
  VariationPatch,
} from '../shared/types'
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
  // Fetch-level failure: timeout vs. unreachable host get distinct messages,
  // because a timed-out write may still have been committed by the store.
  if (raw instanceof TypeError || (raw as any)?.cause?.code === 'ECONNREFUSED' || status === null) {
    const name = (raw as { name?: string } | null)?.name
    if (name === 'TimeoutError' || name === 'AbortError' || (raw as { code?: string })?.code === 'ABORT_ERR') {
      return new Error(
        'فروشگاه دیر پاسخ داد و درخواست قطع شد (Timeout). ممکن است عملیات با تأخیر در سایت انجام شده باشد — ' +
          'پیش از تلاش مجدد، فهرست مربوطه را به‌روزرسانی کنید تا از تکراری‌نشدن مطمئن شوید.',
      )
    }
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
  timeoutMs = 0,
): Promise<{ data: T; headers: Headers }> {
  // Writes (stock + emails + webhooks on the store side) are not safely
  // retryable and regularly exceed 20s on slow hosts — give them 60s unless
  // the caller overrides. Reads stay at 20s (cached + safe to retry).
  const timeout = timeoutMs > 0 ? timeoutMs : method.toUpperCase() === 'GET' ? 20000 : 60000
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
      signal: AbortSignal.timeout(timeout),
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
 * Order statuses exactly as registered on the store — /reports/orders/totals
 * mirrors wc_get_order_statuses(), so custom plugin statuses appear with
 * their REAL Persian names. The app must never rename or invent statuses;
 * this list is the single authoritative source.
 */
export async function fetchOrderStatuses(cfg: WooConfig): Promise<OrderStatusTotal[]> {
  const { data } = await wooRequest<Array<{ slug?: string; name?: string; total?: string | number }>>(
    cfg,
    'GET',
    '/reports/orders/totals',
    {},
    undefined,
    'v3',
    12000,
  )
  if (!Array.isArray(data)) throw new Error('فهرست وضعیت‌های سفارش از فروشگاه خوانده نشد.')
  const list = data
    .map((s) => ({
      slug: String(s.slug ?? '').trim(),
      name: String(s.name ?? '').trim(),
      total: Number(s.total ?? 0) || 0,
    }))
    .filter((s) => s.slug && s.name)
  if (list.length === 0) throw new Error('فهرست وضعیت‌های سفارش از فروشگاه خالی بود.')
  return list
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
 * `orders_count` and `total_spent` for performance, while the sync needs the
 * full record. v2 returns every field identically (same records, same
 * pagination/search/orderby support). Create/update stay on v3 — see
 * createCustomer() — and wc/v2 answers whenever wc/v3 does, because both live
 * behind WooCommerce's same legacy REST API module.
 */

/** Cap on pages walked while syncing the customers (100 per page). */
export const MAX_CUSTOMER_SYNC_PAGES = 100 // 100 × 100 = up to 10,000 customers

/**
 * Generic REST list walker: pages a listing endpoint until a page comes back
 * short, the endpoint reports no more pages, or `maxPages` is reached. The
 * caller folds each page into the local store (or aggregates it); the result
 * reports whether the page cap truncated the walk (→ sync_state.truncated).
 */
export async function walkApiPages<T>(opts: {
  fetchPage: (page: number) => Promise<{ items: T[]; totalPages: number }>
  maxPages: number
  /** Return false to stop the walk early (early-stop is NOT truncation). */
  onPage: (items: T[]) => void | false
}): Promise<{ total: number; pages: number; truncated: boolean }> {
  let page = 0
  let total = 0
  let totalPages = 1
  for (;;) {
    page += 1
    const { items, totalPages: tp } = await opts.fetchPage(page)
    if (page === 1) totalPages = Math.max(1, tp)
    const stop = opts.onPage(items) === false
    total += items.length
    if (stop) return { total, pages: page, truncated: false }
    if (items.length === 0 || page >= totalPages || page >= opts.maxPages) {
      return { total, pages: page, truncated: page >= opts.maxPages && page < totalPages }
    }
  }
}

/**
 * Full product record plus its variations (variable products only). Reads
 * every variation page up to a hard cap of 2000 variations. Used as the API
 * fallback for a product the local store has not seen yet.
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

/** Create a customer (POST /customers). Requires a Read/Write API key. */
export async function createCustomer(cfg: WooConfig, payload: CustomerPayload): Promise<Customer> {
  const { data } = await wooRequest<Customer>(cfg, 'POST', '/customers', {}, payload)
  return data
}

/** Create an order (POST /orders). Requires a Read/Write API key. */
export async function createOrder(cfg: WooConfig, payload: OrderPayload): Promise<Order> {
  // Order creation is the heaviest store write (stock + emails + coupons);
  // slow hosts regularly exceed the default 20s, so give it 90s.
  const { data } = await wooRequest<Order>(cfg, 'POST', '/orders', {}, payload, 'v3', 90000)
  return data
}

/** Look up a store coupon by its exact code (GET /coupons?code=...). */
export async function findCoupon(cfg: WooConfig, code: string): Promise<Coupon | null> {
  const clean = String(code ?? '').trim()
  if (!clean) return null
  const { data } = await wooRequest<Coupon[]>(cfg, 'GET', '/coupons', { code: clean, per_page: 10 })
  return (data ?? [])[0] ?? null
}

/* ------------------------------------------------------------------ */
/* Orders snapshot walk (سفارش‌ها — feeds the local store)               */
/* ------------------------------------------------------------------ */

/** Hard cap on pages walked when syncing the whole orders list. */
export const MAX_ORDER_SYNC_PAGES = 200 // 200 × 100 = up to 20,000 orders

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
          // Immutable sort key: ids never reorder, so paged walks stay stable
          // even while the store is live (date-sorted pages drift and skip rows).
          orderby: 'id',
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
 * One page of the store's orders, every status included, with retries. Feeds
 * the local store's orders sync (walkApiPages drives the paging).
 */
export async function walkOrderPages(
  cfg: WooConfig,
  extra: Record<string, string | number> = {},
  onPage: (orders: Order[]) => void,
): Promise<{ total: number; truncated: boolean }> {
  const res = await walkApiPages<Order>({
    fetchPage: async (page) => {
      const r = await ordersPageWithRetry(cfg, page, extra)
      return { items: r.data, totalPages: Math.max(1, Number(r.headers.get('x-wp-totalpages') ?? 1)) }
    },
    maxPages: MAX_ORDER_SYNC_PAGES,
    onPage,
  })
  return { total: res.total, truncated: res.truncated }
}

/**
 * All order ids of the store (cheap `_fields=id` pages) — delete-diff scan.
 * Null on error; `truncated` true when the walk hit the page cap OR the
 * fetched distinct ids don't cover the header total (unstable pagination /
 * lost rows) — either way the caller must skip deletions: an incomplete
 * remote id list must never delete local rows.
 */
export async function scanOrderIds(cfg: WooConfig): Promise<{ ids: Set<number>; truncated: boolean } | null> {
  const ids = new Set<number>()
  let total = 0
  try {
    const res = await walkApiPages<Order>({
      fetchPage: async (page) => {
        const r = await ordersPageWithRetry(cfg, page, { _fields: 'id' })
        if (page === 1) total = Number(r.headers.get('x-wp-total') ?? 0) || 0
        return { items: r.data, totalPages: Math.max(1, Number(r.headers.get('x-wp-totalpages') ?? 1)) }
      },
      maxPages: MAX_ORDER_SYNC_PAGES,
      onPage: (items) => {
        for (const o of items) ids.add(o.id)
      },
    })
    const incomplete = res.truncated || (total > 0 && ids.size < total)
    return { ids, truncated: incomplete }
  } catch {
    return null
  }
}

/** Safety cap per status while syncing the product catalog. */
export const MAX_PRODUCT_SYNC_PAGES = 10 // 10 × 100 = 1000 products per status

/**
 * Walk one product status' listing (newest first), folding every page into
 * `onPage`. Feeds the local store's products sync; the delta pass passes a
 * `modified_after` ISO stamp (stores too old to know the parameter return
 * everything — the upserts are idempotent, so the sync stays correct).
 */
export async function walkProductPages(
  cfg: WooConfig,
  status: string,
  extra: Record<string, string | number> = {},
  onPage: (products: Product[]) => void,
): Promise<{ total: number; truncated: boolean }> {
  const res = await walkApiPages<Product>({
    fetchPage: async (page) => {
      const { data, headers } = await wooRequest<Product[]>(cfg, 'GET', '/products', {
        page,
        per_page: 100,
        status,
        orderby: 'id',
        order: 'desc',
        ...extra,
      })
      return { items: data, totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)) }
    },
    maxPages: MAX_PRODUCT_SYNC_PAGES,
    onPage,
  })
  return { total: res.total, truncated: res.truncated }
}

/**
 * All product ids across the catalog's statuses (cheap `_fields=id` pages) —
 * delete-diff scan. Null on error; `truncated` true when any status's walk hit
 * the page cap or its distinct ids don't cover the header total — the caller
 * must then skip deletions (an incomplete id list must never delete rows).
 */
export async function scanProductIds(
  cfg: WooConfig,
  statuses: string[],
): Promise<{ ids: Set<number>; truncated: boolean } | null> {
  const ids = new Set<number>()
  let truncated = false
  try {
    for (const status of statuses) {
      let total = 0
      const res = await walkApiPages<Product>({
        fetchPage: async (page) => {
          const { data, headers } = await wooRequest<Product[]>(cfg, 'GET', '/products', {
            page,
            per_page: 100,
            status,
            orderby: 'id',
            order: 'desc',
            _fields: 'id',
          })
          if (page === 1) total = Number(headers.get('x-wp-total') ?? 0) || 0
          return { items: data, totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)) }
        },
        maxPages: MAX_PRODUCT_SYNC_PAGES,
        onPage: (items) => {
          for (const p of items) ids.add(p.id)
        },
      })
      truncated = truncated || res.truncated || (total > 0 && res.total < total)
    }
  } catch {
    return null
  }
  return { ids, truncated }
}

/** Page cap while walking one variable product's combinations. */
export const MAX_VARIATION_WALK_PAGES = 20

/**
 * Every combination of one variable product (id asc), folded into `onPage`
 * page by page. The caller upserts the variations into the local store.
 */
export async function walkVariationPages(
  cfg: WooConfig,
  productId: number,
  onPage: (variations: ProductVariation[]) => void,
): Promise<void> {
  await walkApiPages<ProductVariation>({
    fetchPage: async (page) => {
      const { data, headers } = await wooRequest<ProductVariation[]>(
        cfg,
        'GET',
        `/products/${productId}/variations`,
        { per_page: 100, page, orderby: 'id', order: 'asc' },
      )
      return { items: data, totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)) }
    },
    maxPages: MAX_VARIATION_WALK_PAGES,
    onPage,
  })
}

/**
 * Walk the customers listing (newest registrations first), folding every page
 * into `onPage`. Customers support no `modified_after` filter, so the delta
 * pass stops early: once a page contains no customer registered after
 * `newerThanMs`, the walk ends (edits of old customers are picked up by the
 * next full walk — see forceFull).
 */
export async function walkCustomerPages(
  cfg: WooConfig,
  newerThanMs: number | null,
  onPage: (customers: Customer[]) => void,
): Promise<{ total: number; truncated: boolean; fresh: number }> {
  let fresh = 0
  const res = await walkApiPages<Customer>({
    fetchPage: async (page) => {
      const { data, headers } = await wooRequest<Customer[]>(
        cfg,
        'GET',
        '/customers',
        { page, per_page: 100, orderby: 'registered_date', order: 'desc' },
        undefined,
        'v2',
      )
      return { items: data, totalPages: Math.max(1, Number(headers.get('x-wp-totalpages') ?? 1)) }
    },
    maxPages: MAX_CUSTOMER_SYNC_PAGES,
    onPage: (items) => {
      let pageFresh = 0
      for (const c of items) {
        const created = Date.parse(c.date_created_gmt ?? c.date_created)
        if (Number.isFinite(created) && newerThanMs != null && created <= newerThanMs) continue
        pageFresh += 1
      }
      fresh += pageFresh
      onPage(items)
      // A full page with no new registration means nothing newer behind it.
      if (newerThanMs != null && pageFresh === 0) return false
    },
  })
  return { total: res.total, truncated: res.truncated, fresh }
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

/** Add a note to an order (POST /orders/{id}/notes). Requires a Read/Write key.
 * added_by_user:true attributes the note to the API key owner (WooCommerce REST
 * defaults to "WooCommerce"/system, which hides the staff name next to the date). */
export async function createOrderNote(
  cfg: WooConfig,
  orderId: number,
  payload: OrderNotePayload,
): Promise<OrderNote> {
  const { data } = await wooRequest<OrderNote>(cfg, 'POST', `/orders/${orderId}/notes`, {}, {
    ...payload,
    added_by_user: true,
  })
  return data
}

/** Change an order's status (PUT /orders/{id} with { status }). */
export async function updateOrderStatus(cfg: WooConfig, orderId: number, status: string): Promise<Order> {
  const { data } = await wooRequest<Order>(cfg, 'PUT', '/orders/' + orderId, {}, { status })
  return data
}

/** Fetch a single order (used before editing to know its current status). */
export async function getOrder(cfg: WooConfig, orderId: number): Promise<Order> {
  const { data } = await wooRequest<Order>(cfg, 'GET', '/orders/' + orderId)
  return data
}

/** Update an existing order's line items and addresses. */
export async function updateOrder(cfg: WooConfig, orderId: number, payload: OrderUpdatePayload): Promise<Order> {
  const { data } = await wooRequest<Order>(cfg, 'PUT', '/orders/' + orderId, {}, payload)
  return data
}

