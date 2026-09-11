/** Connection settings for the WooCommerce REST API (stored on-device only). */
export interface Settings {
  siteUrl: string
  consumerKey: string
  consumerSecret: string
  /** Store identity printed on receipts (all optional). */
  storeName?: string
  storeAddress?: string
  storePostcode?: string
  storePhone?: string
  /** Store logo as a data URL (read from a local image file). Also shown at the top of the sidebar. */
  storeLogo?: string
  /** رنگ‌بندی برنامه: «dark» پیش‌فرض است؛ «light» تم روشن مینیمال. */
  theme?: 'dark' | 'light'
  /** رنگ تأکیدی دستی (هگز مثل #2dd4bf) برای دکمه‌ها و عناصر اصلی؛ خالی = رنگ پیش‌فرض تم. */
  accentColor?: string
  /**
   * نام کارشناس فعال: نام نمایشیِ صاحبِ کلید API (از خود سایت با wp/v2/users/me
   * خوانده می‌شود) که در «لاگ تغییرات» به هر اکشن چسبانده می‌شود.
   */
  userName?: string
  /**
   * Phrases (one per entry) whose containing order notes are NOT printed on
   * the warehouse receipt — each shop manages its own excluded note texts.
   */
  noteExclusions?: string[]
  /**
   * Cost of goods per product (keyed by product id, تومان per unit) — entered
   * in تنظیمات and read by the «سود ناخالص» sales report.
   */
  productCosts?: Record<string, number>
  /**
   * حد نصاب موجودی (reorder alert): products whose stock_quantity is at or
   * below this number are flagged in the گزارشات «موجودی» tab. Default 5.
   */
  lowStockThreshold?: number
  /**
   * انبارهای فروشگاه (کارگاه/فروشگاه و…). Each warehouse keeps its stock in
   * the product/variation meta `_stock_{id}` and may map to a custom order
   * status that triggers automatic allocation (تخصیص) of new orders. Stored
   * on every device — the ids must match across devices because they name the
   * site meta keys.
   */
  warehouses?: WarehouseDef[]
  /**
   * اکانت‌های کارشناسی (کلیدهای API) ثبت‌شده روی این دستگاه؛ consumerKey/
   * consumerSecret همیشه همان اکانت فعال‌اند. دستگاه‌های قدیمی بدون این فیلد
   * کلیدشان به‌صورت یک اکانت «main» دیده می‌شود.
   */
  accounts?: StaffAccount[]
  /** شناسهٔ اکانت فعال از accounts (خالی = اولین اکانت). */
  activeAccountId?: string
  /**
   * Cache lifetime (seconds) for list reads (customers, orders, products,
   * status totals). Default 60. Bigger = faster menu switches but data may be
   * that old until the next write or manual refresh.
   */
  cacheListSec?: number
  /**
   * Cache lifetime (seconds) for detail/history reads (order notes, customer/
   * product order history, store stats). Default 120.
   */
  cacheDetailSec?: number
  /**
   * Cache lifetime (seconds) for heavy report scans and product catalog/
   * detail fetches. Default 300.
   */
  cacheReportSec?: number
  /**
   * On app start the disk cache may serve snapshots at most this old (hours)
   * before re-fetching — 0 disables stale serving entirely (strict). Default 12.
   */
  cacheStaleHours?: number
}

/** Cache usage stats surfaced to the UI (see the «آخرین همگام‌سازی» badge). */
export interface CacheStatus {
  /** Reads served from a fresh in-memory entry (no store request). */
  hits: number
  /** Reads that had to invoke the store loader. */
  misses: number
  /** Cold-start reads served from a disk snapshot (refreshed in the background). */
  staleServes: number
  /** Successful store fetches (fresh loads + background refreshes). */
  fetches: number
  /** Live cache entries (memory). */
  size: number
  /**
   * Last time each endpoint prefix (customers, orders, products, reports, …)
   * was really fetched from the store (ms epoch). Empty in the browser demo.
   */
  syncedAt: Record<string, number>
}

/** Minimal shape of a WooCommerce customer (/wp-json/wc/v3/customers). */
export interface Customer {
  id: number
  email: string
  first_name: string
  last_name: string
  username: string
  avatar_url: string
  role: string
  is_paying_customer: boolean
  orders_count: number
  total_spent: string
  date_created: string
  billing: {
    first_name?: string
    last_name?: string
    city?: string
    state?: string
    country?: string
    address_1?: string
    postcode?: string
    phone?: string
    email?: string
  }
}

export interface CustomersResult {
  customers: Customer[]
  total: number
  totalPages: number
  page: number
  perPage: number
}

export interface ConnectionResult {
  ok: boolean
  message: string
}

export interface ListCustomersQuery {
  search?: string
  /**
   * Normalized mobile lookup (quick order): scans customers for a matching
   * billing phone. When present, pagination is ignored and every match is
   * returned on page 1 (bounded scan).
   */
  phone?: string
  page?: number
  perPage?: number
}

/** Minimal shape of a WooCommerce product (/wp-json/wc/v3/products). */
export interface Product {
  id: number
  name: string
  slug: string
  type: string
  status: string
  sku: string
  price: string
  regular_price: string
  sale_price: string
  on_sale: boolean
  total_sales: number
  stock_status: string
  stock_quantity: number | null
  manage_stock: boolean
  categories: Array<{ id: number; name: string; slug: string }>
  images: Array<{ id: number; src: string; name: string }>
  date_created: string
  /** GMT modification stamp — drives the incremental (modified_after) sync. */
  date_modified_gmt?: string
  /** Product reviews (read-only from the store catalog — drives «محصولات دارای بیشترین امتیاز»). */
  average_rating?: string
  rating_count?: number
  review_count?: number
  /** Raw site meta of the product (drives the per-warehouse stock `_stock_{id}`). */
  meta_data?: Array<{ id?: number; key: string; value: unknown }>
  /** Per-warehouse stock parsed from the `_stock_{id}` metas (absent = ثبت‌نشده). */
  warehouseStock?: Record<string, number>
}

export interface ProductsResult {
  products: Product[]
  /** Products in the requested scope incl. the stock segment (drives pager/chip). */
  total: number
  totalPages: number
  page: number
  perPage: number
  /** All products matching search + publication status (widget scope — ignores the stock segment). */
  totalAll: number
  /** instock products in the widget scope, across ALL pages. */
  inStock: number
  /** outofstock products in the widget scope, across ALL pages. */
  outOfStock: number
  /** Sum of total_sales over ALL products of the widget scope (not just the page). */
  totalSales: number
}

export interface ListProductsQuery {
  search?: string
  page?: number
  perPage?: number
  /** Single product status to filter by; omit/empty to show all non-trash statuses. */
  status?: string
  /** Stock-status segment filter (instock / outofstock); omit/empty for all. */
  stockStatus?: string
}

/** A product variation (combination) — GET /wp-json/wc/v3/products/{id}/variations. */
export interface ProductVariation {
  id: number
  sku: string
  price: string
  regular_price: string
  sale_price: string
  on_sale: boolean
  stock_status: string
  stock_quantity: number | null
  manage_stock: boolean
  attributes: Array<{ id: number; name: string; option: string }>
  image: { id: number; src: string; name: string } | null
  /** Raw site meta of the combination (drives the per-warehouse stock `_stock_{id}`). */
  meta_data?: Array<{ id?: number; key: string; value: unknown }>
  /** Per-warehouse stock parsed from the `_stock_{id}` metas (absent = ثبت‌نشده). */
  warehouseStock?: Record<string, number>
}

/** A product together with its variations (variations only for variable products). */
export interface ProductDetail {
  product: Product
  variations: ProductVariation[]
}

/** Editable fields of a product variation (PUT …/products/{id}/variations/{vid}). */
export interface VariationPatch {
  regular_price?: string
  sale_price?: string
  stock_quantity?: number | null
  stock_status?: string
  manage_stock?: boolean
}

/** Editable fields of a (simple) product (PUT …/products/{id}). */
export interface ProductPatch {
  status?: string
  regular_price?: string
  sale_price?: string
  stock_quantity?: number | null
  stock_status?: string
  manage_stock?: boolean
}

/** Payload for creating a product (POST /wp-json/wc/v3/products). */
export interface ProductPayload {
  name: string
  type: string
  status: string
  regular_price?: string
  sale_price?: string
  stock_quantity?: number | null
  stock_status?: string
  short_description?: string
}

export interface ProductOrdersResult {
  /** Only orders whose status counts toward sales (see `excluded`). */
  orders: Order[]
  /** Number of orders shown (excl. failed/cancelled/refunded statuses). */
  total: number
  /** Units of this product (incl. its variations) sold across the counted orders. */
  unitsSold: number
  /** Sum of order totals under the app rule (excl. failed/cancelled/refunded). */
  revenueSum: number
  /** How many orders were omitted because of their status (failed/cancelled/refunded). */
  excluded: number
  revenueTruncated: boolean
  truncated: boolean
}

/**
 * Minimal shape of a WooCommerce order (/wp-json/wc/v3/orders). The list
 * endpoint returns the full order objects, so the extra `?` detail fields
 * below are also populated when present (they back the order-details panel).
 */
export interface Order {
  id: number
  number: string
  status: string
  date_created: string
  date_modified?: string
  /** GMT modification stamp — drives the incremental (modified_after) sync. */
  date_modified_gmt?: string
  total: string
  currency: string
  payment_method_title: string
  customer_id: number
  customer_note?: string
  discount_total?: string
  shipping_total?: string
  line_items: Array<{
    id?: number
    name: string
    quantity: number
    total: string
    price?: string
    sku?: string
    product_id?: number
    variation_id?: number
    meta_data?: Array<{ key: string; value: string; display_key?: string; display_value?: string }>
  }>
  billing: {
    first_name?: string
    last_name?: string
    phone?: string
    email?: string
    city?: string
    state?: string
    address_1?: string
    address_2?: string
    postcode?: string
    country?: string
  }
  shipping?: {
    first_name?: string
    last_name?: string
    address_1?: string
    address_2?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  }
  shipping_lines?: Array<{ method_title?: string; total?: string }>
  coupon_lines?: Array<{ code?: string; discount?: string }>
  /** Display name of the order's customer (billing name, or the linked account's name). */
  customer_name?: string
  /** Raw site meta — carries the warehouse-allocation marker (`_warehouse_alloc`). */
  meta_data?: Array<{ id?: number; key: string; value: unknown }>
  /** Warehouse id this order's stock was allocated from, when known (app-managed marker). */
  allocatedWarehouse?: string
}

export interface OrdersResult {
  orders: Order[]
  total: number
  page: number
  perPage: number
  /**
   * مجموع خرید طبق قانون برنامه: مجموع مبلغ سفارش‌ها با هر وضعیتی به‌جز
   * failed / cancelled / refunded (ووکامرس خودش فقط سفارش‌های «پرداخت‌شده» را می‌شمرد).
   */
  purchaseSum: number
  /** زمانی true که سفارش‌های بیشتری از سقف محاسبه وجود داشته باشد. */
  purchaseSumTruncated: boolean
}

/** One page of the store-wide orders list (newest first). */
export interface OrdersListResult {
  orders: Order[]
  total: number
  totalPages: number
  page: number
  perPage: number
}

/**
 * Payload for creating an order (POST /wp-json/wc/v3/orders) from the
 * quick-registration screen. Only product/variation ids and quantities are
 * sent — WooCommerce computes prices, totals and variation meta itself.
 */
export interface OrderPayload {
  customer_id?: number
  customer_note?: string
  payment_method?: string
  payment_method_title?: string
  /** Mark the order paid immediately (in-store cash / card-to-card sales). */
  set_paid?: boolean
  /** Status to create the order with (e.g. processing / pending-payment). */
  status?: string
  billing?: {
    first_name?: string
    last_name?: string
    phone?: string
    address_1?: string
    address_2?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  }
  shipping?: {
    first_name?: string
    last_name?: string
    address_1?: string
    address_2?: string
    city?: string
    state?: string
    postcode?: string
    country?: string
  }
  line_items: Array<{
    product_id: number
    /** Required for variable products — picks the exact combination. */
    variation_id?: number
    quantity: number
  }>
  /** Coupon codes to apply at the store (WooCommerce validates them itself). */
  coupon_lines?: Array<{ code: string }>
  /** Extra shipping line (هزینهٔ ارسال سفارش‌های ارسالی ثبت‌شده در برنامه). */
  shipping_lines?: Array<{ method_id?: string; method_title?: string; total?: string }>
}

/** Payload for updating an existing order's line items and addresses.
 * Line-item semantics (WooCommerce REST):
 *  - existing line → send its `id` (+ product/variation ids) with the new quantity
 *  - deleted line  → send its `id` with quantity 0
 *  - new line      → no `id`, just product_id/variation_id + quantity
 */
export interface OrderUpdatePayload {
  line_items: Array<{
    id?: number
    product_id?: number
    variation_id?: number
    quantity: number
  }>
  billing?: Partial<Order['billing']>
  shipping?: Partial<NonNullable<Order['shipping']>>
}

/** Document handed to the main process for BULK printing (one big HTML doc). */
export interface PrintBulkDoc {
  type: ReceiptType
  widthMm: number
  heightMm: number
  landscape: boolean
  html: string
}

export interface ListOrdersQuery {
  search?: string
  /** Single order status to filter by; omit/empty for every non-trash status. */
  status?: string
  page?: number
  perPage?: number
  /** Only these order ids (bulk print fetch — respects WooCommerce `include`). */
  include?: number[]
}

/** One row of GET /wp-json/wc/v3/reports/orders/totals. */
export interface OrderStatusTotal {
  slug: string
  /** WooCommerce's own name (often English — the UI shows the Persian label). */
  name: string
  total: number
}

/** One order note (GET/POST /wp-json/wc/v3/orders/{id}/notes). */
export interface OrderNote {
  id: number
  author: string
  date_created: string
  note: string
  /** true → customer note (also emailed / visible on the storefront); false → private/system note. */
  customer_note: boolean
  /** true when written by a human (shop manager) through the admin. */
  added_by_user: boolean
}

/** Payload for POST /wp-json/wc/v3/orders/{id}/notes. */
export interface OrderNotePayload {
  note: string
  customer_note?: boolean
  /** true → attribute the note to the API key owner instead of the system. */
  added_by_user?: boolean
}

/** Kinds of printable order receipts. */
export type ReceiptType = 'postal' | 'warehouse' | 'store'

/** Store coupon, narrowed to what the quick-order screen needs. */
export interface Coupon {
  id: number
  code: string
  amount: string
  discount_type: string
}

/** Document handed to the main process for printing (its own full HTML doc). */
export interface PrintReceiptDoc {
  type: ReceiptType
  /** Printable width of the paper in mm (used to size the hidden window). */
  widthMm: number
  /** Landscape hint for the print dialog (e.g. the 210 mm postal strip). */
  landscape?: boolean
  html: string
}

/** Payload for creating a customer (POST /wp-json/wc/v3/customers). */
export interface CustomerPayload {
  /** Optional in this app: when omitted, the account is created with the phone username only. */
  email?: string
  /** When omitted, WooCommerce uses the phone number as the login name. */
  username?: string
  first_name?: string
  last_name?: string
  billing?: {
    first_name?: string
    last_name?: string
    phone?: string
    city?: string
    state?: string
    country?: string
    address_1?: string
    postcode?: string
  }
}

/**
 * Store-wide customer KPIs (computed over ALL customers of the store, not the
 * currently visible page): rule-based purchase total + buyers in the current
 * Persian month + the total customer count.
 */
export interface StoreStats {
  /** All customers scanned (page cap may stop early — see `truncated`). */
  totalCustomers: number
  /** مجموع خرید همهٔ مشتریان طبق قانون برنامه (به‌جز ناموفق/لغو/بازپرداخت). */
  sum: number
  /** Customers with at least one counted order in the current Persian month. */
  monthCustomers: number
  /** True when per-customer order reads failed for someone (sum is a lower bound). */
  partial: boolean
  /** True when the customer scan stopped at the page cap before the end. */
  truncated: boolean
  computedAt: string
}

/* ------------------------------------------------------------------ */
/* انبارها — multi-warehouse stock (per product + per combination)      */
/* ------------------------------------------------------------------ */

/** One warehouse of the store (defined in تنظیمات on every device). */
export interface WarehouseDef {
  /**
   * Stable identifier — names the site meta key `_stock_{id}`, so it MUST be
   * the same on every device (e.g. `kargah` / `forooshgah`). Latin letters,
   * digits, dash and underscore only.
   */
  id: string
  /** Persian display name (کارگاه، فروشگاه، …). */
  name: string
  /**
   * Custom order status that allocates (تخصیص) new orders from this
   * warehouse — e.g. `kargah` (تایید کارگاه). Empty = no automatic allocation.
   */
  orderStatus?: string
  /** Quick-registration (سفارش سریع) orders are allocated to this warehouse. */
  quickOrder?: boolean
}

/** One stock row of the warehouses overview (one product or one variation). */
export interface WarehouseItemState {
  productId: number
  /** null → the product itself (simple products); otherwise the combination id. */
  variationId: number | null
  /** Product name (+ the combination label for variations). */
  name: string
  /** Parent product name — populated for variation rows. */
  productName?: string
  sku?: string
  imageUrl?: string
  type: string
  status: string
  /** Stock is managed on the site for this item (stock_quantity is numeric). */
  manageStock: boolean
  /** The site's own stock (ملاک) — null when stock is not managed. */
  siteStock: number | null
  /** Per-warehouse registered stock; a missing key or null = ثبت‌نشده. */
  warehouseStock: Record<string, number | null>
  /** Sum of the REGISTERED warehouses (null when nothing is registered). */
  sum: number | null
  /** sum − siteStock (null when nothing registered or stock not managed). */
  delta: number | null
}

/** Full warehouses snapshot for the «انبارها» view + the sidebar badge. */
export interface WarehousesOverview {
  /** Canonical warehouse list from settings. */
  warehouses: WarehouseDef[]
  /** Every product + combination of the store (newest first). */
  items: WarehouseItemState[]
  /** ISO time the snapshot was computed. */
  computedAt: string
}

/** One editable row of the انبارداری modal (a product or one combination). */
export interface WarehouseSaveRow {
  variationId: number | null
  /** Absolute count per warehouse id — every warehouse must be present. */
  values: Record<string, number>
  /** true → the site stock_quantity is set to the sum of `values` (تأیید انبارداری). */
  syncSite: boolean
}

/** Payload of one انبارداری save (all rows of one product at once). */
export interface WarehouseStockSavePayload {
  productId: number
  rows: WarehouseSaveRow[]
}

/** Result of one saved row (read back from the site response). */
export interface WarehouseSaveRowResult {
  variationId: number | null
  siteStock: number | null
  warehouseStock: Record<string, number>
  /** true when the site stock was changed by this save. */
  siteSynced: boolean
}

export interface WarehouseStockSaveResult {
  productId: number
  rows: WarehouseSaveRowResult[]
}

/** بخش برنامه‌ای که یک ردیف لاگ به آن تعلق دارد. */
export type ChangeLogSection = 'orders' | 'products' | 'customers' | 'warehouses' | 'settings' | 'system'

/**
 * One logged action: WHO (کارشناس = the API key's owner) did WHAT (title +
 * details) on WHICH section, WHEN (ts, ms epoch). Written by the desktop app
 * for every write action it performs through the store API.
 */
export interface ChangeLogEntry {
  ts: number
  user: string
  section: ChangeLogSection
  action: string
  title: string
  details?: string
  target?: string
  /** مبلغ تومانی مرتبط با اکشن (فقط برای ثبت سفارش) — مبنای آمار «سفارش‌های من» در پیشخوان. */
  amount?: number
}

export interface ChangeLogQuery {
  page?: number
  perPage?: number
  search?: string
  /** فقط کارشناس خاص (خالی = همه). */
  user?: string
  /** فقط بخش خاص (خالی = همه). */
  section?: ChangeLogSection | ''
  /** فقط اکشن خاص مثل order-create (خالی = همه). */
  action?: string
}

export interface ChangeLogResult {
  entries: ChangeLogEntry[]
  total: number
  page: number
  perPage: number
  /** کاربران حاضر در لاگ — برای فیلتر. */
  users: string[]
}

/** API surface exposed to the renderer through the preload bridge. */
export interface ApiBridge {
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<{ ok: boolean }>
  clearSettings(): Promise<{ ok: boolean }>
  /** Pass settings to test unsaved form input; otherwise tests the stored config. */
  testConnection(settings?: Settings): Promise<ConnectionResult>
  listCustomers(query: ListCustomersQuery): Promise<CustomersResult>
  createCustomer(payload: CustomerPayload): Promise<Customer>
  /** Create an order (quick registration). Requires a Read/Write API key. */
  createOrder(payload: OrderPayload): Promise<Order>
  /** Look up a store coupon by its exact code (null when unknown). */
  findCoupon(code: string): Promise<Coupon | null>
  /**
   * Drop every cached store response (desktop cache + demo rebuild). Called by
   * the «به‌روزرسانی» / «بارگذاری مجدد» buttons so the next read refetches
   * from the store instead of serving the TTL cache.
   */
  clearCache(): Promise<{ ok: boolean }>
  /** Cache usage stats + last real store-sync stamps (آخرین همگام‌سازی). */
  getCacheStatus(): Promise<CacheStatus>
  /** Sales report over the last N days (store analytics). */
  getReports(query: ReportsQuery): Promise<SalesReport>
  listCustomerOrders(customerId: number): Promise<OrdersResult>
  listOrders(query: ListOrdersQuery): Promise<OrdersListResult>
  /** Order counts per status (drives the sidebar badge + the orders filter chips). */
  listOrderStatusTotals(): Promise<OrderStatusTotal[]>
  listOrderNotes(orderId: number): Promise<OrderNote[]>
  createOrderNote(orderId: number, payload: OrderNotePayload): Promise<OrderNote>
  updateOrderStatus(orderId: number, status: string): Promise<Order>
  /** Update an order (line items, totals, etc). */
  updateOrder(orderId: number, payload: OrderUpdatePayload): Promise<Order>
  /** Print a receipt document through the system print dialog (desktop only). */
  printReceipt(doc: PrintReceiptDoc): Promise<{ ok: boolean }>
  /** Print a BULK document (several receipts on one paper layout). */
  printBulk(doc: PrintBulkDoc): Promise<{ ok: boolean }>
  getStoreStats(): Promise<StoreStats>
  listProducts(query: ListProductsQuery): Promise<ProductsResult>
  getProductDetail(productId: number): Promise<ProductDetail>
  updateProductVariation(productId: number, variationId: number, patch: VariationPatch): Promise<ProductVariation>
  updateProduct(productId: number, patch: ProductPatch): Promise<Product>
  createProduct(payload: ProductPayload): Promise<Product>
  listProductOrders(productId: number): Promise<ProductOrdersResult>
  /**
   * Full (bounded) product catalog for the محصولات/موجودی report tabs — all
   * non-trash statuses, newest first. Separate from listProducts because the
   * report tabs need every page at once (ratings + stock alerts).
   */
  getProductCatalog(): Promise<ProductCatalog>
  /**
   * انبارها snapshot: every product/combination with its site stock and
   * per-warehouse registered stock (cached like the reports — the first walk
   * reads the variations of every variable product).
   */
  getWarehousesOverview(): Promise<WarehousesOverview>
  /** ثبت انبارداری: save per-warehouse counts (+ optionally sync the site stock to their sum). */
  saveWarehouseStock(payload: WarehouseStockSavePayload): Promise<WarehouseStockSaveResult>
  /**
   * After a write that moves stock (order status change / item edit / quick
   * order), main drops the stock-dependent caches and pings every window —
   * انبارها و نشان‌های سایدبار خودکار تازه می‌شوند. Returns the unsubscribe fn.
   */
  onStockChanged(cb: () => void): () => void
  /** اکانت‌های کارشناس (کلیدهای API) ثبت‌شده روی این دستگاه + اکانت فعال. */
  listAccounts(): Promise<AccountsSnapshot>
  /** افزودن اکانت کارشناس: کلید اعتبارسنجی و (با نام صاحبش) به فهرست اضافه می‌شود. */
  addAccount(payload: { label?: string; consumerKey: string; consumerSecret: string }): Promise<AccountsSnapshot>
  /** حذف اکانت؛ اگر فعال حذف شود، اولین اکانت باقی‌مانده فعال می‌شود. */
  removeAccount(id: string): Promise<AccountsSnapshot>
  /** سوئیچ به اکانت دیگر: کلید فعال عوض، کش باطل و نام کارشناس تازه می‌شود. */
  switchAccount(id: string): Promise<{ ok: boolean; userName?: string | null; message?: string }>
  /** لاگ تغییرات: paged/filtered record of every write action performed in the app. */
  getChangeLog(query?: ChangeLogQuery): Promise<ChangeLogResult>
  /** Store currency label read from the WooCommerce API (واحد پولی قیمت‌ها). */
  getCurrency(): Promise<string>
}

/** فهرست اکانت‌های کارشناسی دستگاه + کدام اکنون فعال است. */
export interface AccountsSnapshot {
  activeId: string | null
  accounts: StaffAccount[]
}

/** یک اکانت کارشناسی: کلیدهای API ووکامرس یک نفر از کارکنان. */
export interface StaffAccount {
  id: string
  /** نام نمایشی در سوئیچر سایدبار (پیش‌فرض: نام صاحب کلید روی سایت). */
  label: string
  consumerKey: string
  consumerSecret: string
}

/** Amounts for one sales-report slice (payments / statuses). */
export interface NamedAmount {
  label: string
  count: number
  total: number
}

/** One day's sales within the report window. */
export interface DailySale {
  /** Local date key YYYY-MM-DD (the axis of the chart). */
  date: string
  total: number
  orders: number
}

/** A sold product aggregated across the window (by revenue / units). */
export interface TopSeller {
  id: number
  name: string
  sku: string
  units: number
  /** Distinct orders containing the product. */
  orders: number
  revenue: number
}

/** One row of the «سود ناخالص» breakdown (per sold product). */
export interface ProductProfitRow {
  id: number
  name: string
  sku: string
  units: number
  /** Distinct orders containing the product. */
  orders: number
  /** فروش سطرها (خطوط سفارش) در بازه. */
  revenue: number
  /** قیمت تمام‌شدهٔ هر واحد از تنظیمات (تومان) — null تا وقتی ثبت نشده. */
  unitCost: number | null
  /** واحد × قیمت تمام‌شده — ۰ وقتی unitCost ثبت نشده. */
  cogs: number
  /** revenue − cogs — معتبر فقط وقتی unitCost ثبت شده باشد. */
  profit: number
  /** false → قیمت تمام‌شده در تنظیمات ثبت نشده (سودش محاسبه نمی‌شود). */
  covered: boolean
}

/** Gross-profit summary of a sales-report window (from تنظیمات productCosts). */
export interface GrossProfitSummary {
  /** فروش کالاهایی که قیمت تمام‌شده دارند. */
  coveredRevenue: number
  /** فروش کالاهایی که قیمت تمام‌شده‌شان ثبت نشده. */
  uncoveredRevenue: number
  /** مجموع قیمت تمام‌شدهٔ کالاهای فروخته‌شده (فقط پوشش‌داده‌شده‌ها). */
  cogs: number
  /** سود ناخالص = coveredRevenue − cogs. */
  grossProfit: number
  /** درصد سود ناخالص نسبت به coveredRevenue (null وقتی پوششی نیست). */
  marginPct: number | null
  /** تعداد کالاهای فروخته‌شده بدون قیمت تمام‌شده. */
  uncoveredProducts: number
  /** ردیف‌های کالا (پوشش‌داده‌شده‌ها اول؛ سپس بدون قیمت) — تا سقف GROSS_ROWS. */
  rows: ProductProfitRow[]
  /** true وقتی کالاهای بیشتری از سقف ردیف‌های نمایش وجود دارند. */
  rowsTruncated: boolean
}

/** Sales attributed to one billing city. */
export interface CitySale {
  city: string
  count: number
  total: number
}

/* ------------------------------------------------------------------ */
/* Analytics additions to the sales report (خلاصه / مشتریان / محصولات /
/* سفارش‌ها). All are computed by the shared pure aggregator, so the   */
/* real client and the browser demo always agree on the same orders.   */
/* ------------------------------------------------------------------ */

/** One aggregated customer (from the window's counted orders). */
export interface ReportCustomer {
  /** Store account id — 0 when the buyer checked out as a guest. */
  id: number
  name: string
  city?: string
  /** ISO of the customer's earliest counted order inside the window. */
  firstOrder: string
  /** Counted orders inside the window. */
  orders: number
  /** Counted revenue inside the window. */
  revenue: number
}

/** One «نسبت» bucket of customers by how many counted orders they placed. */
export interface CustomerBucket {
  label: string
  count: number
}

/** Customer analytics of the report window (behaviour is «تقریبی» — see UI). */
export interface CustomerInsights {
  /** Unique customers with counted orders in the window (accounts + guests). */
  active: number
  /** Of active: checked out without an account (customer_id 0). */
  guests: number
  /** Active identities with no counted order in the equal window right before. */
  newCustomers: number
  /** Active identities that also bought in the equal previous window. */
  returning: number
  /** Active customers with ≥ 2 counted orders in the window. */
  repeatBuyers: number
  /** repeatBuyers / active × 100 — null when no counted orders. */
  repeatRate: number | null
  /** فروش هر مشتری فعال (countedRevenue / active). */
  avgRevenue: number | null
  /** نسبت سفارش به مشتری = counted orders / active — null when no counted orders. */
  orderRatio: number | null
  /** Customers bucketed by their counted-order count (1 / 2 / ۳–۵ / ۶+). */
  buckets: CustomerBucket[]
  /** Top 10 customers by counted revenue (ties → more orders first). */
  topByAmount: ReportCustomer[]
  /** Top 10 customers by counted order count (ties → more revenue first). */
  topByOrders: ReportCustomer[]
}

/** Coupon usage across the window's COUNTED orders (app rule). */
export interface CouponUse {
  code: string
  /** Distinct counted orders that used the code. */
  orders: number
  /** Sum of the coupon discounts on those orders. */
  discount: number
}

/**
 * Sales funnel «تقریبی»: derived from the order statuses of the window (the
 * store's REST API exposes no session/visit data).
 */
export interface FunnelInsights {
  /** Every order created in the window (any status). */
  created: number
  /** Still open: pending / pending-payment / on-hold / drafts. */
  awaiting: number
  /** Beyond awaiting payment and not lost (processing, completed, …). */
  paid: number
  /** Finished orders (completed — a subset of paid). */
  completed: number
  /** failed / cancelled / refunded / trash. */
  lost: number
  /** awaiting / created × 100. */
  waitingPct: number | null
  /** paid / created × 100. */
  paidPct: number | null
  /** completed / created × 100. */
  completionPct: number | null
  /** lost / created × 100. */
  lostPct: number | null
}

/** One compact order row for the operational (سفارش‌ها) reports. */
export interface OpsOrderRow {
  id: number
  number: string
  status: string
  date: string
  total: number
  customer: string
  payment?: string
  items: number
}

/** One operational group: count/total over the whole slice + the newest rows. */
export interface OpsGroup {
  /** ISO start of the slice. */
  from: string
  /** ISO end of the slice. */
  to: string
  count: number
  total: number
  rows: OpsOrderRow[]
  /** true when more rows exist than the display cap. */
  rowsTruncated: boolean
}

/** Operational order reports of the window (لغو/بازگشت، معوق، سبد رها شده). */
export interface OpsInsights {
  /** Cancelled + refunded orders of the whole window. */
  cancelled: OpsGroup
  /** Cancelled + refunded orders of the last 7 days of the window. */
  cancelled7: OpsGroup
  /** On-hold / pending / pending-payment orders of the window. */
  waiting: OpsGroup
  /** Cart sessions saved as draft/checkout-draft orders (best-effort). */
  abandoned: OpsGroup
}

/** One popular product attribute value (از meta خطوط سفارش). */
export interface AttrHit {
  /** Attribute name — e.g. «رنگ» / «سایز». */
  label: string
  /** Attribute value — e.g. «مشکی». */
  value: string
  /** Units sold with this value. */
  units: number
  /** Distinct counted orders containing it. */
  orders: number
}

/** Top-sellers of the final 7 days of the window (5 محصول/ترکیب برتر هفته). */
export interface WeeklyTop {
  from: string
  to: string
  top: TopSeller[]
}

/** Product catalog snapshot for the محصولات/موجودی tabs (not window-bound). */
export interface ProductCatalog {
  /** All non-trash products of the store (bounded scan, newest first). */
  products: Product[]
  total: number
  /** true when more products exist beyond the safety cap. */
  truncated: boolean
}

/**
 * Summary of the equal-length window that ends right before the report's
 * window — the «دورهٔ قبل» basis for the growth percentages.
 */
export interface PreviousPeriodTotals {
  /** ISO start of the previous window (local midnight). */
  from: string
  /** ISO end of the previous window (local end of day). */
  to: string
  revenue: number
  orders: number
  items: number
}

/**
 * Store sales report computed over an order window. Money follows the app
 * rule everywhere (failed / cancelled / refunded orders are excluded).
 */
export interface SalesReport {
  /** Requested window width in days. */
  days: number
  /** ISO start of the window (local midnight). */
  from: string
  /** ISO end of the window (local end of day). */
  to: string
  totals: { revenue: number; orders: number; items: number }
  /** Totals of the equal-length period right before this window. */
  previous: PreviousPeriodTotals
  /** Per-day revenue + order count, every day of the window (zeros filled). */
  daily: DailySale[]
  /** Revenue/count per payment-method title (top, desc). */
  payments: NamedAmount[]
  /** Revenue/count per order-status slug (top, desc). */
  statuses: NamedAmount[]
  /** Revenue/count per billing city (top, desc). */
  cities: CitySale[]
  /** Top products by revenue (then units). */
  products: TopSeller[]
  /** سود ناخالص بازه — از قیمت تمام‌شدهٔ تنظیمات (productCosts). */
  profit: GrossProfitSummary
  /** Customer analytics of the window (مشتریان tab). */
  customers: CustomerInsights
  /** Coupon usage across counted orders (مشتریان tab). */
  coupons: CouponUse[]
  /** Order-status funnel «تقریبی» (خلاصه tab). */
  funnel: FunnelInsights
  /** Operational order reports (سفارش‌ها tab). */
  ops: OpsInsights
  /** Top 5 of the final week of the window (محصولات tab). */
  weekly: WeeklyTop
  /** محبوب‌ترین ویژگی‌های محصولات از meta خطوط سفارش (محصولات tab). */
  features: AttrHit[]
  /** True when the scan hit the safety cap before the window ended. */
  truncated: boolean
}

export interface ReportsQuery {
  /** Preset window width in days (امروز / ۷ / ۳۰ / ۹۰ روز اخیر). */
  days?: number
  /** Custom range start — local date key YYYY-MM-DD (بازهٔ سفارشی). */
  from?: string
  /** Custom range end — local date key YYYY-MM-DD (inclusive). */
  to?: string
}

export type ViewId = 'dashboard' | 'customers' | 'quick-order' | 'orders' | 'products' | 'warehouses' | 'reports' | 'log' | 'settings'
export type ConnState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; message: string }
  | { state: 'fail'; message: string }
