/** Connection settings for the WooCommerce REST API (stored on-device only). */
export interface Settings {
  siteUrl: string
  consumerKey: string
  consumerSecret: string
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

/** Minimal shape of a WooCommerce order (/wp-json/wc/v3/orders). */
export interface Order {
  id: number
  number: string
  status: string
  date_created: string
  total: string
  currency: string
  payment_method_title: string
  customer_id: number
  line_items: Array<{
    name: string
    quantity: number
    total: string
    product_id?: number
    variation_id?: number
    meta_data?: Array<{ key: string; value: string }>
  }>
  billing: {
    first_name?: string
    last_name?: string
    phone?: string
    email?: string
    city?: string
    address_1?: string
  }
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
  getStoreStats(): Promise<StoreStats>
  listProducts(query: ListProductsQuery): Promise<ProductsResult>
  getProductDetail(productId: number): Promise<ProductDetail>
  updateProductVariation(productId: number, variationId: number, patch: VariationPatch): Promise<ProductVariation>
  updateProduct(productId: number, patch: ProductPatch): Promise<Product>
  createProduct(payload: ProductPayload): Promise<Product>
  listProductOrders(productId: number): Promise<ProductOrdersResult>
}

export type ViewId = 'customers' | 'products' | 'settings'
export type ConnState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'ok'; message: string }
  | { state: 'fail'; message: string }
