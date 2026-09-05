import type {
  ApiBridge,
  ConnectionResult,
  Customer,
  CustomerPayload,
  CustomersResult,
  ListCustomersQuery,
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
  Settings,
  StoreStats,
  VariationPatch,
} from '../../shared/types'
import { persianMonthKey } from '../../shared/persianMonth'
import { orderStatusMeta } from './format'

/* ------------------------------------------------------------------ */
/* Seeded pseudo-random data so the preview looks stable & realistic   */
/* ------------------------------------------------------------------ */

const NAMES: Array<{ fa: string; en: string }> = [
  { fa: 'علی', en: 'ali' }, { fa: 'سارا', en: 'sara' }, { fa: 'مهدی', en: 'mehdi' },
  { fa: 'نگار', en: 'negar' }, { fa: 'رضا', en: 'reza' }, { fa: 'مریم', en: 'maryam' },
  { fa: 'امیر', en: 'amir' }, { fa: 'زهرا', en: 'zahra' }, { fa: 'حسین', en: 'hossein' },
  { fa: 'فاطمه', en: 'fatemeh' }, { fa: 'محمد', en: 'mohammad' }, { fa: 'نازنین', en: 'nazanin' },
  { fa: 'کیان', en: 'kian' }, { fa: 'الهام', en: 'elham' }, { fa: 'بهراد', en: 'behrad' },
  { fa: 'آیدا', en: 'aida' }, { fa: 'پویا', en: 'pouya' }, { fa: 'شیرین', en: 'shirin' },
  { fa: 'آرش', en: 'arash' }, { fa: 'لیلا', en: 'leila' }, { fa: 'سامان', en: 'saman' },
  { fa: 'رویا', en: 'roya' }, { fa: 'فرهاد', en: 'farhad' }, { fa: 'مینا', en: 'mina' },
]

const LAST: Array<{ fa: string; en: string }> = [
  { fa: 'محمدی', en: 'mohammadi' }, { fa: 'احمدی', en: 'ahmadi' }, { fa: 'کریمی', en: 'karimi' },
  { fa: 'حسینی', en: 'hosseini' }, { fa: 'قاسمی', en: 'ghasemi' }, { fa: 'رضایی', en: 'rezaei' },
  { fa: 'عباسی', en: 'abbasi' }, { fa: 'موسوی', en: 'mousavi' }, { fa: 'نادری', en: 'naderi' },
  { fa: 'صادقی', en: 'sadeghi' }, { fa: 'جعفری', en: 'jafari' }, { fa: 'میرزایی', en: 'mirzaei' },
  { fa: 'توکلی', en: 'tavakoli' }, { fa: 'عسگری', en: 'askari' }, { fa: 'کاظمی', en: 'kazemi' },
  { fa: 'شریفی', en: 'sharifi' }, { fa: 'نوروزی', en: 'norouzi' }, { fa: 'یزدانی', en: 'yazdani' },
]

const IRAN_CITIES = ['تهران', 'اصفهان', 'شیراز', 'مشهد', 'تبریز', 'کرج', 'قم', 'اهواز', 'رشت', 'یزد', 'ارومیه', 'زنجان', 'ساری', 'گرگان']
const FOREIGN = [
  { city: 'دبی', country: 'AE' },
  { city: 'استانبول', country: 'TR' },
  { city: 'هامبورگ', country: 'DE' },
  { city: 'لندن', country: 'GB' },
]
const DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'mail.com', 'proton.me']

function placeOf(i: number): { city: string; country: string } {
  if (i % 23 === 0) return FOREIGN[(i / 23) % FOREIGN.length]
  return { city: IRAN_CITIES[(i * 5 + 2) % IRAN_CITIES.length], country: 'IR' }
}

/** Plausible phone number per country: Iranian mobiles are 09xx…, others get +cc. */
function phoneOf(i: number, country: string): string {
  const rnd = seeded(i * 104729 + 7)
  const digits = (n: number) => String(Math.floor(rnd() * Math.pow(10, n))).padStart(n, '0')
  switch (country) {
    case 'IR':
      return '09' + (rnd() > 0.5 ? '12' : '35') + digits(8)
    case 'AE':
      return '+971 5' + digits(8)
    case 'TR':
      return '+90 5' + digits(9)
    case 'DE':
      return '+49 17' + digits(9)
    case 'GB':
      return '+44 7' + digits(9)
    default:
      return digits(11)
  }
}

function seeded(seed: number): () => number {
  let s = seed + 1
  return () => {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TOTAL = 247

function makeCustomer(i: number): Customer {
  const rnd = seeded(i * 7919 + 13)
  const f = NAMES[i % NAMES.length]
  const l = LAST[(i * 7 + 3) % LAST.length]
  const place = placeOf(i)
  const domain = DOMAINS[Math.floor(rnd() * DOMAINS.length)]
  const hasOrders = rnd() > 0.28
  const ordersCount = hasOrders ? 1 + Math.floor(rnd() * rnd() * 40) : 0
  const spent = hasOrders ? Math.round((ordersCount * (rnd() * 90 + 8) + rnd() * 2000) * 100) / 100 : 0
  const paying = hasOrders && rnd() > 0.35
  const phone = phoneOf(i, place.country)
  const year = 2021 + Math.floor(rnd() * 5.2)
  const day = 1 + Math.floor(rnd() * 360)
  const created = new Date(Date.UTC(year, 0, 1) + day * 86400000 + Math.floor(rnd() * 86400000))
  const unique = i % 5 === 0 ? i : i % 7
  const emailUser = i % 13 === 0 ? `${f.en}.${l.en}` : `${f.en}${l.en}${unique % 1000}`

  return {
    id: 4000 + i,
    email: `${emailUser}${i % 9 === 0 ? '.' + unique : ''}@${domain}`,
    first_name: f.fa,
    last_name: l.fa,
    username: `${f.en}${l.en}${i % 7 === 0 ? '_' + unique : ''}`,
    avatar_url: '',
    role: 'customer',
    is_paying_customer: paying,
    orders_count: ordersCount,
    total_spent: String(spent),
    date_created: created.toISOString(),
    billing: { city: place.city, country: place.country, phone },
  }
}

let ALL: Customer[] = Array.from({ length: TOTAL }, (_, i) => makeCustomer(i)).sort(
  (a, b) => +new Date(b.date_created) - +new Date(a.date_created),
)

/* ------------------------------------------------------------------ */

const delay = (ms = 420) => new Promise((r) => setTimeout(r, ms))

/** Demo credentials written only when the user explicitly picks «دادهٔ آزمایشی». */
export const DEMO_SETTINGS: Settings = {
  siteUrl: 'https://shop.example.com',
  consumerKey: 'ck_demo_preview_only',
  consumerSecret: 'cs_demo_preview_only',
  storeName: 'فروشگاه آزمایشی',
  storeAddress: 'تهران، خیابان ولیعصر، کوچهٔ آزادی، پلاک ۱۲',
  storePostcode: '۱۹۶۴۶۷۳۳۱۱',
  storePhone: '۰۲۱-۹۱۰۰۴۲۳۱',
}

/**
 * Preview (plain browser) builds have no bridge to the real store, so the mock
 * may ONLY pretend to be connected when the stored credentials are exactly the
 * demo ones. Real-looking keys get an honest Persian error instead of fake data.
 */
const NOT_REAL_MSG =
  'اتصال واقعی در این پیش‌نمایش مرورگر ممکن نیست و دادهٔ آزمایشی نمایش داده می‌شود. برای اتصال به فروشگاه واقعی، ' +
  'برنامهٔ دسکتاپ (فایل نصبی) را اجرا کنید و کلیدهای API را در همان‌جا وارد کنید.'

function isDemoSettings(s: Settings | null | undefined): boolean {
  return !!(
    s &&
    s.siteUrl.trim() === DEMO_SETTINGS.siteUrl &&
    s.consumerKey.trim() === DEMO_SETTINGS.consumerKey &&
    s.consumerSecret.trim() === DEMO_SETTINGS.consumerSecret
  )
}

function storedSettings(): Settings {
  try {
    const raw = localStorage.getItem('mock-settings')
    return raw ? (JSON.parse(raw) as Settings) : { siteUrl: '', consumerKey: '', consumerSecret: '' }
  } catch {
    return { siteUrl: '', consumerKey: '', consumerSecret: '' }
  }
}

/* ------------------------------------------------------------------ */
/* Purchase totals — same app rule as the real client (src/main/woo.ts) */
/* ------------------------------------------------------------------ */

const PURCHASE_EXCLUDED = new Set(['failed', 'cancelled', 'refunded'])

function purchaseSumOf(orders: Order[]): number {
  return Math.round(
    orders.reduce((a, o) => a + (o.status && !PURCHASE_EXCLUDED.has(o.status) ? Number(o.total) || 0 : 0), 0) * 100,
  ) / 100
}

/** Per-customer rule-based totals, so list + history agree within a session. */
const mockSpentCache = new Map<number, number>()

function mockPurchaseSum(customer: Customer): number {
  const hit = mockSpentCache.get(customer.id)
  if (hit !== undefined) return hit
  const sum = purchaseSumOf(makeOrders(customer))
  if (mockSpentCache.size > 3000) mockSpentCache.delete(mockSpentCache.keys().next().value as number)
  mockSpentCache.set(customer.id, sum)
  return sum
}

/* ------------------------- products mock ---------------------------- */

interface MockCat {
  id: number
  slug: string
  fa: string
  items: string[]
}

const MOCK_CATS: MockCat[] = [
  { id: 11, slug: 'clothing', fa: 'پوشاک', items: ['پیراهن مردانه', 'هودی بافت', 'مانتو اداری', 'شلوار جین', 'تی‌شرت نخی', 'کت چرم', 'شومیز زنانه', 'بافت پاییزه'] },
  { id: 12, slug: 'bags-shoes', fa: 'کیف و کفش', items: ['کیف چرم دست‌دوز', 'کفش راحتی', 'بوت چرم', 'کیف دوشی', 'صندل تابستانی', 'کوله‌پشتی شهری', 'کیف آرایش', 'نیم‌بوت'] },
  { id: 13, slug: 'beauty', fa: 'آرایشی و بهداشتی', items: ['عطر ۱۰۰ میل', 'کرم مرطوب‌کننده', 'شامپو تقویت مو', 'رژ لب', 'سرم پوست', 'ادکلن مردانه', 'ماسک صورت', 'ژل شست‌وشو'] },
  { id: 14, slug: 'home', fa: 'لوازم خانگی', items: ['کتری برقی', 'جاروبرقی', 'مخلوط‌کن', 'ساندویچ‌ساز', 'اتو بخار', 'چای‌ساز', 'بخارشوی', 'آبمیوه‌گیری'] },
  { id: 15, slug: 'digital', fa: 'دیجیتال و موبایل', items: ['هدفون بلوتوثی', 'اسپیکر قابل حمل', 'ساعت هوشمند', 'پاوربانک', 'کابل شارژ', 'موس بی‌سیم', 'وب‌کم', 'هدست گیمینگ'] },
  { id: 16, slug: 'stationery', fa: 'کتاب و لوازم تحریر', items: ['دفتر یادداشت', 'خودنویس', 'کتاب داستان', 'رنگ آبرنگ', 'پازل', 'کتاب کودک', 'جعبه‌مداد', 'پلنر سالانه'] },
  { id: 17, slug: 'sports', fa: 'ورزشی', items: ['دمبل سبک', 'تشک یوگا', 'توپ فوتبال', 'طناب ورزشی', 'کیسه بوکس', 'دوچرخهٔ شهری', 'بند مقاومتی', 'کفش پیاده‌روی'] },
  { id: 18, slug: 'kids', fa: 'کودک و نوزاد', items: ['لباس نوزادی', 'اسباب‌بازی چوبی', 'کالسکه', 'بطری شیر', 'پتو نوزاد', 'ست شیشه', 'روبالشی کودک', 'عروسک پارچه‌ای'] },
  { id: 19, slug: 'decor', fa: 'دکوراسیون', items: ['لامپ رومیزی', 'تابلو دیواری', 'گلدان سرامیکی', 'شمع معطر', 'آینهٔ دکوراتیو', 'پارچهٔ مبل', 'ساعت دیواری', 'چراغ خواب'] },
  { id: 20, slug: 'food', fa: 'خوراکی و کافه', items: ['قهوهٔ ترک', 'عسل طبیعی', 'چای ممتاز', 'شکلات تلخ', 'مربای خانگی', 'زعفران', 'آجیل مخلوط', 'خرمای مضافتی'] },
]

const PRODUCT_TOTAL = 264

const faD = (s: string | number): string => String(s).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

function makeProduct(i: number): Product {
  const rnd = seeded(i * 104729 + 97)
  const cat = MOCK_CATS[i % MOCK_CATS.length]
  const item = cat.items[(i * 3 + 1) % cat.items.length]
  const isVariable = i % 17 === 0
  const name = i % 11 === 0 ? `${item} — مدل ${faD(200 + i)}` : item
  const regular = Math.round((rnd() * 3800 + 55) * 1000) / 100
  const onSale = !isVariable && rnd() > 0.72
  const salePrice = onSale ? Math.round(regular * (0.55 + rnd() * 0.35) * 100) / 100 : ''
  const stockRoll = rnd()
  const stockStatus = isVariable ? 'instock' : stockRoll > 0.82 ? 'outofstock' : stockRoll > 0.74 ? 'onbackorder' : 'instock'
  const manageStock = !isVariable && stockStatus !== 'onbackorder'
  const stockQty = manageStock && stockStatus === 'instock' ? Math.floor(rnd() * 130) : null
  const year = 2019 + Math.floor(rnd() * 7.5)
  const day = 1 + Math.floor(rnd() * 360)
  const created = new Date(Date.UTC(year, 0, 1) + day * 86400000 + Math.floor(rnd() * 86400000))
  const statusRoll = i % 23 === 0 ? 'private' : i % 31 === 0 ? 'draft' : i % 41 === 0 ? 'pending' : 'publish'

  return {
    id: 9000 + i,
    name,
    slug: cat.slug + '-' + i,
    type: isVariable ? 'variable' : 'simple',
    status: statusRoll,
    sku: isVariable ? '' : 'PRD-' + String(9100 + i),
    price: isVariable ? '' : onSale ? String(salePrice) : String(regular),
    regular_price: isVariable ? '' : String(regular),
    sale_price: isVariable ? '' : onSale ? String(salePrice) : '',
    on_sale: onSale,
    total_sales: Math.floor(rnd() * rnd() * 900),
    stock_status: stockStatus,
    stock_quantity: isVariable ? null : stockQty,
    manage_stock: manageStock,
    categories: [{ id: cat.id, name: cat.fa, slug: cat.slug }],
    images: [],
    date_created: created.toISOString(),
  }
}

const ALL_PRODUCTS: Product[] = Array.from({ length: PRODUCT_TOTAL }, (_, i) => makeProduct(i)).sort(
  (a, b) => +new Date(b.date_created) - +new Date(a.date_created),
)

/* ------------------- variations + product extras mock ---------------- */

const COLORS = ['مشکی', 'سفید', 'طوسی', 'سرمه‌ای']
const SIZES = ['S', 'M', 'L', 'XL']

/** Deterministic variations for one (variable) product; cached for the session. */
const mockVariationCache = new Map<number, ProductVariation[]>()

function mockVariationsOf(product: Product): ProductVariation[] {
  if (product.type !== 'variable') return []
  const cached = mockVariationCache.get(product.id)
  if (cached) return cached

  const rnd = seeded(product.id * 50021 + 31)
  const base = Math.round((rnd() * 3200 + 150) * 100) / 100
  const colors = 2 + Math.floor(rnd() * 3) // 2..4
  const sizes = 2 + Math.floor(rnd() * 2) // 2..3
  const variations: ProductVariation[] = []

  for (let c = 0; c < colors; c++) {
    for (let s = 0; s < sizes; s++) {
      if (rnd() < 0.18) continue // some combos are simply not produced
      const id = product.id * 1000 + variations.length + 1
      const price = Math.round(base * (0.82 + rnd() * 0.5) * 100) / 100
      const onSale = rnd() > 0.6
      const sale = onSale ? Math.round(price * (0.55 + rnd() * 0.3) * 100) / 100 : ''
      const qty = Math.floor(rnd() * 46)
      variations.push({
        id,
        sku: 'VAR-' + id,
        regular_price: String(price),
        sale_price: sale ? String(sale) : '',
        price: sale ? String(sale) : String(price),
        on_sale: !!sale,
        stock_status: qty === 0 ? 'outofstock' : 'instock',
        stock_quantity: qty,
        manage_stock: true,
        attributes: [
          { id: 0, name: 'رنگ', option: COLORS[(c + product.id) % COLORS.length] },
          { id: 0, name: 'سایز', option: SIZES[(s + product.id) % SIZES.length] },
        ],
        image: null,
      })
    }
  }
  mockVariationCache.set(product.id, variations)
  return variations
}

const comboLabel = (v: ProductVariation): string => v.attributes.map((a) => `${a.name}: ${a.option}`).join('، ')

/** Deterministic orders that contain one product (incl. its variations). */
function mockProductOrders(product: Product): ProductOrdersResult {
  const rnd = seeded(product.id * 7823 + 19)
  const variations = mockVariationsOf(product)
  const n = 2 + Math.floor(rnd() * 26) // 2..27 orders
  const orders: Order[] = []
  const now = Date.now()

  for (let i = 0; i < n; i++) {
    const variation = variations.length ? variations[Math.floor(rnd() * variations.length)] : null
    const qty = 1 + Math.floor(rnd() * 3)
    const unit = Number(variation ? variation.price : product.price || 800) || 800
    const total = Math.round(unit * qty * 100) / 100
    const status = ORDER_STATUS[Math.floor(rnd() * ORDER_STATUS.length)]
    const frac = (n - i - rnd() * 0.7) / n
    const date = new Date(now - (now - new Date('2021-01-01').getTime()) * Math.min(0.995, Math.max(0.001, frac)))

    orders.push({
      id: product.id * 100 + i + 1,
      number: String(900000 + product.id + i),
      status,
      date_created: date.toISOString(),
      total: String(total),
      currency: '',
      payment_method_title: PAY_METHODS[Math.floor(rnd() * PAY_METHODS.length)],
      customer_id: 0,
      line_items: [
        {
          name: variation ? `${product.name} — ${comboLabel(variation)}` : product.name,
          quantity: qty,
          total: String(total),
          product_id: product.id,
          ...(variation ? { variation_id: variation.id } : {}),
        },
      ],
      billing: {},
    })
  }

  orders.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  // Same rule as the real client: failed/cancelled/refunded orders are excluded
  // from the list, the order count, the units and the revenue sum.
  const valid = orders.filter((o) => o.status && !PURCHASE_EXCLUDED.has(o.status))
  return {
    orders: valid,
    total: valid.length,
    unitsSold: valid.reduce((a, o) => a + o.line_items.reduce((s, l) => s + (Number(l.quantity) || 0), 0), 0),
    revenueSum: purchaseSumOf(valid),
    excluded: orders.length - valid.length,
    revenueTruncated: false,
    truncated: false,
  }
}

function normalize(p: string): string {
  return p.toLowerCase().replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
}

/* ------------------------- order history mock ------------------------ */

const PRODUCTS = [
  'پیراهن مردانه',
  'هودی بافت',
  'کفش ورزشی',
  'کیف چرم دست‌دوز',
  'شال و روسری',
  'عطر ۱۰۰ میل',
  'گوشوارهٔ نقره',
  'ساعت مچی',
  'کتاب و دفتر',
  'لوازم آرایشی',
  'وسایل خانه',
  'اسپیکر بلوتوثی',
]

const PAY_METHODS = ['زرین‌پال', 'درگاه پرداخت بانکی', 'کارت به کارت', 'پرداخت در محل', 'کیف پول']

const ORDER_STATUS = [
  'completed',
  'completed',
  'completed',
  'processing',
  'processing',
  'pending-payment',
  'on-hold',
  'refunded',
  'cancelled',
  'failed',
]

const SHIP_METHODS = ['پست پیشتاز', 'پست سفارشی', 'تیپاکس', 'پیک موتوری']
const COUPON_CODES = ['SAVE10', 'WELCOME', 'OFF5', 'NOFAN']
const STREETS = ['ولیعصر', 'انقلاب', 'شریعتی', 'مطهری', 'سعدی', 'فردوسی', 'بهشتی', 'آزادی']
const CITY_PROV: Record<string, string> = {
  تهران: 'تهران', اصفهان: 'اصفهان', شیراز: 'فارس', مشهد: 'خراسان رضوی', تبریز: 'آذربایجان شرقی',
  کرج: 'البرز', قم: 'قم', اهواز: 'خوزستان', رشت: 'گیلان', یزد: 'یزد', ارومیه: 'آذربایجان غربی',
  زنجان: 'زنجان', ساری: 'مازندران', گرگان: 'گلستان',
}

interface MockOrderExtras {
  shipping_total: string
  discount_total: string
  method_title: string
  coupon?: { code: string; discount: string }
  note?: string
  state?: string
  address_1?: string
  postcode?: string
  country: string
}

/**
 * Plausible shipping/coupon/address details for one order. Its own seeded
 * stream (never the order's main `rnd`) keeps line items, dates and statuses
 * unchanged; the caller folds shipping/coupon into the order total so the
 * amounts stay internally consistent.
 */
function mockOrderExtras(key: number, countryIn?: string, cityIn?: string): MockOrderExtras {
  const rnd = seeded(key)
  const ir = (countryIn ?? 'IR') === 'IR'
  const country: string = ir ? 'IR' : countryIn || 'IR'
  const method_title = SHIP_METHODS[Math.floor(rnd() * SHIP_METHODS.length)]
  const shipping = rnd() > 0.16 ? Math.round((rnd() * 42 + 8) * 100) / 100 : 0
  const hasCoupon = rnd() > 0.82
  const discount = hasCoupon ? Math.round((rnd() * 20 + 4) * 100) / 100 : 0
  const note = rnd() > 0.9 ? 'لطفاً پیش از ارسال هماهنگ کنید.' : undefined
  let state: string | undefined
  let address_1: string | undefined
  let postcode: string | undefined
  if (ir) {
    const city = cityIn && CITY_PROV[cityIn] ? cityIn : Object.keys(CITY_PROV)[Math.floor(rnd() * Object.keys(CITY_PROV).length)]
    state = CITY_PROV[city]
    address_1 =
      'خیابان ' + STREETS[Math.floor(rnd() * STREETS.length)] + '، کوچهٔ ' + (1 + Math.floor(rnd() * 28)) + '، پلاک ' + (1 + Math.floor(rnd() * 180))
    postcode = String(1 + Math.floor(rnd() * 9)) + String(Math.floor(rnd() * 1000000000)).padStart(9, '0')
  }
  return {
    shipping_total: String(shipping),
    discount_total: discount ? String(discount) : '',
    method_title,
    coupon: discount ? { code: COUPON_CODES[Math.floor(rnd() * COUPON_CODES.length)], discount: String(discount) } : undefined,
    note,
    state,
    address_1,
    postcode,
    country,
  }
}

/** Deterministic, plausible order history for one customer (newest first). */
function makeOrders(customer: Customer): Order[] {
  const n = Math.min(customer.orders_count || 0, 60)
  if (n <= 0) return []
  const rnd = seeded(customer.id * 65437 + 11)
  const reg = new Date(customer.date_created).getTime()
  const now = Date.now()
  const span = Math.max(0, now - reg)
  const orders: Order[] = []

  for (let i = 0; i < n; i++) {
    const lineCount = 1 + Math.floor(rnd() * 3)
    const lines = Array.from({ length: lineCount }, () => {
      const name = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)]
      const quantity = 1 + Math.floor(rnd() * 3)
      const unit = Math.round((rnd() * 480 + 20) * 100) / 100
      const total = Math.round(unit * quantity * 100) / 100
      return { name, quantity, unit: String(unit), total: String(total) }
    })
    const itemsTotal = Math.round(lines.reduce((a, l) => a + Number(l.total), 0) * 100) / 100
    const status = ORDER_STATUS[Math.floor(rnd() * ORDER_STATUS.length)]
    const frac = (n - i - rnd() * 0.7) / n
    const date = new Date(reg + span * Math.min(0.995, Math.max(0.001, frac)))
    const pay = PAY_METHODS[Math.floor(rnd() * PAY_METHODS.length)]
    const x = mockOrderExtras(customer.id * 7919 + i * 104729 + 31, customer.billing.country, customer.billing.city)
    const discount = Number(x.discount_total) || 0
    const shipTotal = Number(x.shipping_total) || 0
    const total = Math.max(0, Math.round((itemsTotal - discount + shipTotal) * 100) / 100)
    const shipAddress = x.country === 'IR'
      ? { state: x.state, address_1: x.address_1, postcode: x.postcode, city: customer.billing.city, country: 'IR' }
      : { city: customer.billing.city, country: x.country }

    orders.push({
      id: customer.id * 1000 + i + 1,
      number: String(60000 + customer.id * 100 + i),
      status,
      date_created: date.toISOString(),
      date_modified: new Date(date.getTime() + 3600 * 1000 + Math.floor(rnd() * 7200) * 1000).toISOString(),
      total: String(total),
      currency: '',
      payment_method_title: pay,
      customer_id: customer.id,
      customer_name: customer.first_name + ' ' + customer.last_name,
      discount_total: x.discount_total || undefined,
      shipping_total: String(shipTotal),
      customer_note: x.note,
      line_items: lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unit, total: l.total })),
      shipping_lines: [{ method_title: x.method_title, total: String(shipTotal) }],
      coupon_lines: x.coupon ? [x.coupon] : undefined,
      billing: {
        first_name: customer.first_name,
        last_name: customer.last_name,
        phone: customer.billing.phone,
        city: customer.billing.city,
        country: x.country,
        state: x.state,
        address_1: x.address_1,
        postcode: x.postcode,
      },
      shipping: shipAddress,
    })
  }

  // Ensure newest-first regardless of jitter.
  orders.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  return orders
}

/* ------------------------- store-wide orders mock ------------------- */

/** A handful of guest-checkout orders (no linked customer account). */
function makeGuestOrders(): Order[] {
  const rnd = seeded(88001)
  const orders: Order[] = []
  const now = Date.now()
  for (let i = 0; i < 14; i++) {
    const f = NAMES[Math.floor(rnd() * NAMES.length)]
    const l = LAST[Math.floor(rnd() * LAST.length)]
    const lineCount = 1 + Math.floor(rnd() * 2)
    const lines = Array.from({ length: lineCount }, () => {
      const name = PRODUCTS[Math.floor(rnd() * PRODUCTS.length)]
      const quantity = 1 + Math.floor(rnd() * 2)
      const unit = Math.round((rnd() * 420 + 30) * 100) / 100
      const total = Math.round(unit * quantity * 100) / 100
      return { name, quantity, unit: String(unit), total: String(total) }
    })
    const itemsTotal = Math.round(lines.reduce((a, x) => a + Number(x.total), 0) * 100) / 100
    const day = Math.floor(rnd() * 620) // 0..~20 months back
    const date = new Date(now - day * 86400000 - Math.floor(rnd() * 86400000))
    const pay = PAY_METHODS[Math.floor(rnd() * PAY_METHODS.length)]
    const x = mockOrderExtras(900000 + i * 8191 + 77, 'IR')
    const discount = Number(x.discount_total) || 0
    const shipTotal = Number(x.shipping_total) || 0
    const total = Math.max(0, Math.round((itemsTotal - discount + shipTotal) * 100) / 100)
    orders.push({
      id: 300000 + i + 1,
      number: String(50000 + i + 1),
      status: ORDER_STATUS[Math.floor(rnd() * ORDER_STATUS.length)],
      date_created: date.toISOString(),
      date_modified: new Date(date.getTime() + 3600 * 1000 + Math.floor(rnd() * 7200) * 1000).toISOString(),
      total: String(total),
      currency: '',
      payment_method_title: pay,
      customer_id: 0,
      customer_name: f.fa + ' ' + l.fa,
      discount_total: x.discount_total || undefined,
      shipping_total: String(shipTotal),
      customer_note: x.note,
      line_items: lines.map((l) => ({ name: l.name, quantity: l.quantity, price: l.unit, total: l.total })),
      shipping_lines: [{ method_title: x.method_title, total: String(shipTotal) }],
      coupon_lines: x.coupon ? [x.coupon] : undefined,
      billing: {
        first_name: f.fa,
        last_name: l.fa,
        country: 'IR',
        state: x.state,
        address_1: x.address_1,
        postcode: x.postcode,
      },
      shipping: { state: x.state, address_1: x.address_1, postcode: x.postcode, country: 'IR' },
    })
  }
  return orders
}

/** All store orders (newest first), lazily built and cached until a customer is created. */
let ordersCache: Order[] | null = null

function allOrders(): Order[] {
  if (ordersCache) return ordersCache
  const orders: Order[] = []
  for (const c of ALL) orders.push(...makeOrders(c))
  orders.push(...makeGuestOrders())
  orders.sort((a, b) => +new Date(b.date_created) - +new Date(a.date_created))
  ordersCache = orders
  return orders
}

/* ------------------------- order notes mock ------------------------ */

/** Deterministic note history for one order (system → private → customer). */
function mockOrderNotes(order: Order): OrderNote[] {
  const created = new Date(order.date_created).getTime()
  const notes: OrderNote[] = []
  const push = (hours: number, author: string, note: string, customerNote: boolean, addedByUser: boolean) => {
    notes.push({
      id: order.id * 1000 + notes.length + 1,
      author,
      date_created: new Date(created + hours * 3600 * 1000).toISOString(),
      note,
      customer_note: customerNote,
      added_by_user: addedByUser,
    })
  }
  push(
    0.05,
    'WooCommerce',
    `سیستم: سفارش ایجاد شد و وضعیت «${orderStatusMeta(order.status).fa}» ثبت گردید.`,
    false,
    false,
  )
  // Some real stores show gateway/status events as admin-flagged notes —
  // deliberately mimicked here so the printable filter can be proven against them.
  push(0.8, 'WooCommerce', `وضعیت سفارش از «در انتظار پرداخت» به «در حال پردازش» تغییر کرد.`, false, true)
  if (order.customer_note) {
    push(0.2, order.customer_name ?? 'مشتری', order.customer_note, true, false)
  }
  const total = Number(order.total) || 0
  if (total > 0 && !PURCHASE_EXCLUDED.has(order.status)) {
    push(1.5, 'مدیر فروشگاه', `پرداخت تأیید شد — مبلغ ${total} تومان دریافت گردید.`, false, true)
  }
  return notes
}

/** Notes added through the app during this session (prepended to the generated ones). */
const userOrderNotes = new Map<number, OrderNote[]>()

export const mockApi: ApiBridge = {
  async getSettings(): Promise<Settings> {
    await delay(120)
    return storedSettings()
  },
  async saveSettings(settings: Settings) {
    await delay(120)
    localStorage.setItem('mock-settings', JSON.stringify(settings))
    return { ok: true }
  },
  async clearSettings() {
    await delay(120)
    localStorage.removeItem('mock-settings')
    return { ok: true }
  },
  async testConnection(settings?: Settings): Promise<ConnectionResult> {
    await delay(600)
    if (!isDemoSettings(settings ?? storedSettings())) {
      return { ok: false, message: NOT_REAL_MSG }
    }
    return { ok: true, message: 'اتصال آزمایشی برقرار شد — ۲۴۷ مشتری آزمایشی در دسترس است.' }
  },
  async listCustomers(query: ListCustomersQuery): Promise<CustomersResult> {
    await delay(600)
    if (!isDemoSettings(storedSettings())) {
      throw new Error(NOT_REAL_MSG)
    }
    const search = (query.search ?? '').trim().toLowerCase()
    let list = ALL
    if (search) {
      list = list.filter((c) =>
        [c.first_name, c.last_name, c.username, c.email, c.billing.city, c.billing.phone].some((v) =>
          v?.toLowerCase().includes(search),
        ),
      )
    }
    const perPage = query.perPage ?? 100
    const page = query.page ?? 1
    const start = (page - 1) * perPage
    const customers = list.slice(start, start + perPage).map((c) => {
      // Mirror the real client: total_spent = app rule, not WooCommerce's paid-only value.
      if ((Number(c.orders_count) || 0) > 0) return { ...c, total_spent: String(mockPurchaseSum(c)) }
      return c
    })
    return {
      customers,
      total: list.length,
      totalPages: Math.max(1, Math.ceil(list.length / perPage)),
      page,
      perPage,
    }
  },
  async getStoreStats(): Promise<StoreStats> {
    await delay(800)
    if (!isDemoSettings(storedSettings())) {
      throw new Error(NOT_REAL_MSG)
    }
    // Mirror the real client: rule-based مجموع خرید over ALL customers plus
    // the count of customers with a counted order in the current Persian month.
    const cur = persianMonthKey(new Date())
    let sum = 0
    let monthCustomers = 0
    for (const c of ALL) {
      if ((Number(c.orders_count) || 0) > 0) {
        sum = Math.round((sum + mockPurchaseSum(c)) * 100) / 100
        const ords = makeOrders(c)
        if (
          ords.some(
            (o) =>
              !!o.status && !PURCHASE_EXCLUDED.has(o.status) && persianMonthKey(new Date(o.date_created)) === cur,
          )
        ) {
          monthCustomers += 1
        }
      }
    }
    return {
      totalCustomers: ALL.length,
      sum,
      monthCustomers,
      partial: false,
      truncated: false,
      computedAt: new Date().toISOString(),
    }
  },
  async listProducts(query: ListProductsQuery): Promise<ProductsResult> {
    await delay(600)
    if (!isDemoSettings(storedSettings())) {
      throw new Error(NOT_REAL_MSG)
    }
    const search = normalize((query.search ?? '').trim())
    let base = ALL_PRODUCTS
    const status = (query.status ?? '').trim()
    if (status) base = base.filter((p) => p.status === status)
    if (search) {
      base = base.filter((p) =>
        [p.name, p.sku, ...p.categories.map((c) => c.name)].some((v) => normalize(v ?? '').includes(search)),
      )
    }
    // Same as the real client: rows honor the stock segment, while the
    // aggregates (widgets) always describe the whole search/status scope.
    const stock = (query.stockStatus ?? '').trim()
    const rows = stock ? base.filter((p) => p.stock_status === stock) : base
    const perPage = query.perPage ?? 100
    const page = query.page ?? 1
    const start = (page - 1) * perPage
    return {
      products: rows.slice(start, start + perPage),
      total: rows.length,
      totalPages: Math.max(1, Math.ceil(rows.length / perPage)),
      page,
      perPage,
      totalAll: base.length,
      inStock: base.filter((p) => p.stock_status === 'instock').length,
      outOfStock: base.filter((p) => p.stock_status === 'outofstock').length,
      totalSales: Math.round(base.reduce((a, p) => a + (Number(p.total_sales) || 0), 0) * 100) / 100,
    }
  },
  async getProductDetail(productId: number): Promise<ProductDetail> {
    await delay(500)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const product = ALL_PRODUCTS.find((p) => p.id === productId)
    if (!product) throw new Error('محصول موردنظر در فروشگاه پیدا نشد.')
    return { product, variations: mockVariationsOf(product) }
  },
  async updateProductVariation(productId: number, variationId: number, patch: VariationPatch) {
    await delay(550)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const product = ALL_PRODUCTS.find((p) => p.id === productId)
    const variations = product ? mockVariationsOf(product) : []
    const v = variations.find((x) => x.id === variationId)
    if (!product || !v) throw new Error('ترکیب موردنظر پیدا نشد.')
    if (patch.regular_price !== undefined) v.regular_price = patch.regular_price
    if (patch.sale_price !== undefined) v.sale_price = patch.sale_price
    v.price = v.sale_price || v.regular_price
    v.on_sale = !!v.sale_price
    if (patch.stock_quantity !== undefined) v.stock_quantity = patch.stock_quantity
    if (patch.stock_status !== undefined) v.stock_status = patch.stock_status
    if (v.stock_quantity === 0) v.stock_status = 'outofstock'
    return v
  },
  async updateProduct(productId: number, patch: ProductPatch) {
    await delay(550)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const product = ALL_PRODUCTS.find((p) => p.id === productId)
    if (!product) throw new Error('محصول موردنظر پیدا نشد.')
    if (patch.status !== undefined) product.status = patch.status
    if (patch.regular_price !== undefined) product.regular_price = patch.regular_price
    if (patch.sale_price !== undefined) product.sale_price = patch.sale_price
    product.price = product.sale_price || product.regular_price || product.price
    product.on_sale = !!product.sale_price
    if (patch.stock_quantity !== undefined) product.stock_quantity = patch.stock_quantity
    if (patch.stock_status !== undefined) product.stock_status = patch.stock_status
    return product
  },
  async createProduct(payload: ProductPayload) {
    await delay(650)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const name = (payload.name ?? '').trim()
    if (!name) throw new Error('نام محصول را وارد کنید.')
    const id = Math.max(0, ...ALL_PRODUCTS.map((p) => p.id)) + 1
    const regular = (payload.regular_price ?? '').trim()
    const sale = (payload.sale_price ?? '').trim()
    const hasStock = payload.stock_quantity !== null && payload.stock_quantity !== undefined
    const qty = hasStock ? Number(payload.stock_quantity) || 0 : null
    const product: Product = {
      id,
      name,
      slug: 'product-' + id,
      type: payload.type === 'variable' ? 'variable' : 'simple',
      status: payload.status || 'publish',
      sku: payload.type === 'variable' ? '' : 'PRD-' + String(99000 + id),
      regular_price: payload.type === 'variable' ? '' : regular,
      sale_price: payload.type === 'variable' ? '' : sale,
      price: payload.type === 'variable' ? '' : sale || regular,
      on_sale: !!sale,
      total_sales: 0,
      stock_status: payload.type === 'variable' ? 'instock' : qty === 0 ? 'outofstock' : payload.stock_status || 'instock',
      stock_quantity: payload.type === 'variable' ? null : qty,
      manage_stock: payload.type !== 'variable' && hasStock,
      categories: [],
      images: [],
      date_created: new Date().toISOString(),
    }
    ALL_PRODUCTS.unshift(product)
    return product
  },
  async listProductOrders(productId: number): Promise<ProductOrdersResult> {
    await delay(600)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const product = ALL_PRODUCTS.find((p) => p.id === productId)
    if (!product)
      return { orders: [], total: 0, unitsSold: 0, revenueSum: 0, excluded: 0, revenueTruncated: false, truncated: false }
    return mockProductOrders(product)
  },
  async listCustomerOrders(customerId: number): Promise<OrdersResult> {
    await delay(650)
    const customer = ALL.find((c) => c.id === customerId)
    if (!customer) return { orders: [], total: 0, page: 1, perPage: 100, purchaseSum: 0, purchaseSumTruncated: false }
    const orders = makeOrders(customer)
    return {
      orders,
      total: orders.length,
      page: 1,
      perPage: 100,
      purchaseSum: mockPurchaseSum(customer),
      purchaseSumTruncated: false,
    }
  },
  async listOrders(query: ListOrdersQuery): Promise<OrdersListResult> {
    await delay(600)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    // Bulk print fetch: when `include` ids are given, search/pagination are ignored.
    if (query.include && query.include.length > 0) {
      const set = new Set(query.include)
      const byId = new Map(allOrders().filter((o) => set.has(o.id)).map((o) => [o.id, o]))
      const ordered = query.include.map((id) => byId.get(id)).filter((o): o is Order => !!o)
      return {
        orders: ordered,
        total: ordered.length,
        totalPages: 1,
        page: 1,
        perPage: ordered.length,
      }
    }
    const search = (query.search ?? '').trim().toLowerCase()
    let list = allOrders()
    if (search) {
      list = list.filter(
        (o) =>
          o.number.toLowerCase().includes(search) ||
          (o.customer_name ?? '').toLowerCase().includes(search) ||
          (o.billing?.phone ?? '').toLowerCase().includes(search),
      )
    }
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
  },
  async listOrderNotes(orderId: number): Promise<OrderNote[]> {
    await delay(450)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const order = allOrders().find((o) => o.id === orderId)
    const userNotes = userOrderNotes.get(orderId) ?? []
    if (!order) return userNotes
    return [...userNotes, ...mockOrderNotes(order)]
  },
  async createOrderNote(orderId: number, payload: OrderNotePayload) {
    await delay(500)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const text = (payload.note ?? '').trim()
    if (!text) throw new Error('متن یادداشت را وارد کنید.')
    const entry: OrderNote = {
      id: Date.now(),
      author: 'مدیر فروشگاه',
      date_created: new Date().toISOString(),
      note: text,
      customer_note: !!payload.customer_note,
      added_by_user: true,
    }
    const list = userOrderNotes.get(orderId) ?? []
    list.unshift(entry)
    userOrderNotes.set(orderId, list)
    return entry
  },
  async updateOrderStatus(orderId: number, status: string) {
    await delay(550)
    if (!isDemoSettings(storedSettings())) throw new Error(NOT_REAL_MSG)
    const order = allOrders().find((o) => o.id === orderId)
    if (!order) throw new Error('سفارش موردنظر پیدا نشد.')
    order.status = status
    order.date_modified = new Date().toISOString()
    return order
  },
  async printReceipt() {
    // Printing is a desktop-only capability (system print dialog).
    throw new Error('چاپ فقط در نسخهٔ دسکتاپ برنامه در دسترس است.')
  },
  async printBulk() {
    // Printing is a desktop-only capability (system print dialog).
    throw new Error('چاپ گروهی فقط در نسخهٔ دسکتاپ برنامه در دسترس است.')
  },
  async createCustomer(payload: CustomerPayload) {
    await delay(700)
    const email = (payload.email ?? '').trim()
    const username = (payload.username ?? '').trim()
    const lower = (s: string) => s.toLowerCase()
    if (email && ALL.some((c) => lower(c.email) === lower(email))) {
      throw new Error('مشتری با این ایمیل قبلاً ثبت شده است.')
    }
    if (username && ALL.some((c) => lower(c.username) === lower(username))) {
      throw new Error('این شمارهٔ موبایل قبلاً به‌عنوان نام کاربری ثبت شده است.')
    }
    const first = (payload.first_name ?? '').trim()
    const last = (payload.last_name ?? '').trim()
    const id = Math.max(...ALL.map((c) => c.id)) + 1
    const created: Customer = {
      id,
      email,
      first_name: first,
      last_name: last,
      username,
      avatar_url: '',
      role: 'customer',
      is_paying_customer: false,
      orders_count: 0,
      total_spent: '0',
      date_created: new Date().toISOString(),
      billing: {
        first_name: first,
        last_name: last,
        phone: payload.billing?.phone?.trim() ?? '',
        city: payload.billing?.city?.trim() ?? '',
        state: payload.billing?.state?.trim() ?? '',
        address_1: payload.billing?.address_1?.trim() ?? '',
        postcode: payload.billing?.postcode?.trim() ?? '',
        country: payload.billing?.country ?? 'IR',
      },
    }
    ALL = [created, ...ALL]
    ordersCache = null // the new customer has no orders, but the cache also covers guest data
    return created
  },
}
