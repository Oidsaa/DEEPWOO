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
  /** Store logo as a data URL (read from a local image file). */
  storeLogo?: string
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
  total: string
  currency: string
  payment_method_title: string
  customer_id: number
  customer_note?: string
  discount_total?: string
  shipping_total?: string
  line_items: Array<{
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
  page?: number
  perPage?: number
  /** Only these order ids (bulk print fetch — respects WooCommerce `include`). */
  include?: number[]
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
}

/** Kinds of printable order receipts. */
export type ReceiptType = 'postal' | 'warehouse' | 'store'

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

/** API surface exposed to the renderer through the preload bridge. */
export interface ApiBridge {
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<{ ok: boolean }>
  clearSettings(): Promise<{ ok: boolean }>
  /** Pass settings to test unsaved form input; otherwise tests the stored config. */
  testConnection(settings?: Settings): Promise<ConnectionResult>
  listCustomers(query: ListCustomersQuery): Promise<CustomersResult>
  createCustomer(payload: CustomerPayload): Promise<Customer>
  listCustomerOrders(customerId: number): Promise<OrdersResult>
  listOrders(query: ListOrdersQuery): Promise<OrdersListResult>
  listOrderNotes(orderId: number): Promise<OrderNote[]>
  createOrderNote(orderId: number, payload: OrderNotePayload): Promise<OrderNote>
  updateOrderStatus(orderId: number, status: string): Promise<Order>
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
}

export type ViewId = 'customers' | 'orders' | 'products' | 'settings'
export type ConnState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; message: string }
  | { state: 'fail'; message: string }
