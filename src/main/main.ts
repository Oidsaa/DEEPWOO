import { app, BrowserWindow, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { getSettings, saveSettings, clearSettings, sanitizeSettings, cacheTtlMs, cacheStaleMs } from './settings'
import { cachedRun, clearCaches, bumpCacheVersion, initCache, flushCache, cacheStatus, patchCachedOrder, patchCacheKeepFresh, getSyncMark, setSyncMark } from './cache'
import { appendLog, initLog, queryLog, flushLog } from './log'
import { phonesMatch } from '../shared/phone'
import { currencyLabel, DEFAULT_CURRENCY } from '../shared/currency'
import {
  activeWarehouses,
  allocationForStatus,
  allocateOrder,
  applySaveToOverview,
  applySaveToProductDetail,
  saveWarehouseStock,
  scheduleReconcile,
  warehousesOverview,
} from './warehouses'
import {
  testConnection,
  wpUsersMe,
  getAuthUser,
  fetchCurrencyCode,
  listCustomers,
  createCustomer,
  createOrder,
  getSalesReports,
  listCustomerOrders,
  listOrders,
  syncOrdersSnapshot,
  syncCustomersSnapshot,
  filterAndPaginateOrders,
  listOrderStatusTotals,
  listOrderNotes,
  createOrderNote,
  updateOrderStatus,
  listProducts,
  syncProductCatalog,
  getProductDetail,
  updateProductVariation,
  updateProduct,
  createProduct,
  listProductOrders,
  getStoreStats,
  postChangeLog,
  getServerChangeLog,
} from './woo'
import type {
  ChangeLogQuery,
  ChangeLogSection,
  Customer,
  CustomerPayload,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  Order,
  OrderNotePayload,
  OrderPayload,
  ProductCatalog,
  ProductDetail,
  ReportsQuery,
  PrintBulkDoc,
  PrintReceiptDoc,
  ProductPatch,
  ProductPayload,
  Settings,
  VariationPatch,
  WarehousesOverview,
  WarehouseStockSavePayload,
} from '../shared/types'

app.setName('WooCommerce-Dashboard')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#080d19',
    autoHideMenuBar: true,
    title: 'داشبورد ووکامرس',
    icon: path.join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Open external links (target=_blank / window.open) in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

type PrintableDoc = Pick<PrintReceiptDoc, 'widthMm' | 'landscape' | 'html'>

/**
 * Load a print document in a hidden window and open the system print dialog.
 * Windows opens the native print dialog only when the printing window is
 * visible, focused and settled. NOTE: the PROMISE form of webContents.print
 * resolves instantly WITHOUT opening the dialog on Windows (Electron 37), so
 * the callback form must be used — it fires only after the dialog closes.
 */
async function printViaDialog(doc: PrintableDoc): Promise<{ ok: boolean }> {
  const win = new BrowserWindow({
    show: false,
    width: Math.max(560, Math.min(1200, Math.round((doc.widthMm || 100) * 3.9))),
    height: 640,
    autoHideMenuBar: true,
    title: 'چاپ رسید',
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true },
  })
  const payload = 'data:text/html;charset=utf-8,' + encodeURIComponent(doc.html)
  try {
    await win.loadURL(payload)
    win.show()
    win.focus()
    // Give the window manager + layout a moment before opening the dialog.
    await new Promise((r) => setTimeout(r, 600))
    const ok = await new Promise<boolean>((resolve) => {
      win.webContents.print(
        {
          silent: false,
          printBackground: true,
          landscape: !!doc.landscape,
          margins: { marginType: 'none' },
        },
        (success) => resolve(success),
      )
    })
    return { ok }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/** Stable cache key for one IPC read (endpoint + serialized arguments). */
const ck = (prefix: string, ...parts: unknown[]): string => prefix + ':' + JSON.stringify(parts)

/** Persian label of an order status (for the change log — unknown slugs stay as-is). */
const FA_STATUS: Record<string, string> = {
  pending: 'در انتظار پرداخت',
  processing: 'در حال انجام',
  'on-hold': 'در انتظار بررسی',
  completed: 'انجام شده',
  cancelled: 'لغو شده',
  refunded: 'مسترد شده',
  failed: 'ناموفق',
  'sale-hazouri': 'فروش حضوری',
}
const faStatus = (s: string): string => FA_STATUS[s] ?? s

/* واحد پولی فروشگاه — یک بار از API خوانده و یک ساعت کش می‌شود؛ آخرین کد
 * موفق «چسبنده» است تا قطعی موقت سایت، واحد را از قیمت‌ها حذف نکند. */
let currencyCache: { code: string | null; at: number } | null = null
const CURRENCY_TTL_MS = 60 * 60 * 1000

async function storeCurrencyLabel(): Promise<string> {
  const cfg = getSettings()
  if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
    return currencyLabel(currencyCache?.code ?? '') || DEFAULT_CURRENCY
  }
  if (!currencyCache || Date.now() - currencyCache.at > CURRENCY_TTL_MS) {
    try {
      const code = await fetchCurrencyCode(cfg)
      if (code) currencyCache = { code, at: Date.now() }
      else if (currencyCache) currencyCache.at = Date.now()
    } catch {
      if (currencyCache) currencyCache.at = Date.now()
    }
  }
  return currencyLabel(currencyCache?.code ?? '') || DEFAULT_CURRENCY
}

/** Record one action in the لاگ تغییرات, attributed to the کارشناس (API key owner). */
function logAction(
  section: ChangeLogSection,
  action: string,
  title: string,
  details?: string,
  target?: string,
  amount?: number,
): void {
  const s = getSettings()
  appendLog({ user: s.userName?.trim() || 'نامشخص', section, action, title, details, target, amount })
  // Mirror to the WP-side shared log so every device sees the same لاگ — best-effort.
  void pushChangeLog(section, action, title, details, target, amount)
}

/** Fire-and-forget mirror of one log entry to the «WC App Change Log» plugin. */
async function pushChangeLog(
  section: ChangeLogSection,
  action: string,
  title: string,
  details?: string,
  target?: string,
  amount?: number,
): Promise<void> {
  const cfg = getSettings()
  if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) return
  try {
    await postChangeLog(cfg, { section, action, title, details, target, device: os.hostname(), amount })
  } catch {
    /* پلاگین نصب نیست یا سایت در دسترس نیست — لاگ لوکال همچنان ردیف را دارد */
  }
}

/**
 * Resolve + persist the display name of the API key's WordPress owner
 * (wp/v2/users/me). Called after a successful connection test and on startup;
 * failure keeps whatever name exists (or «نامشخص»).
 */
async function resolveUserName(): Promise<void> {
  const cfg = getSettings()
  if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) return
  let name: string | null = null
  // اول پلاگین لاگ (wcapp/v1/ping) — همان احراز هویتی ثبت لاگ؛ wp/v2 فقط پشتیبان.
  try {
    name = await getAuthUser(cfg)
  } catch {
    /* پلاگین نصب نیست یا سایت در دسترس نیست */
  }
  if (!name) {
    try {
      name = (await wpUsersMe(cfg)).name || null
    } catch {
      /* احراز wp/v2 ممکن نشد */
    }
  }
  if (!name) return
  const s = getSettings()
  if (s.userName !== name) saveSettings({ ...s, userName: name })
}

function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('woo:currency', () => storeCurrencyLabel())

  ipcMain.handle('settings:save', (_event, raw: Settings) => {
    const settings = sanitizeSettings(raw)
    saveSettings(settings)
    logAction('settings', 'settings-save', 'ذخیرهٔ تنظیمات')
    // تنظیمات روی گزارش‌ها/هزینه‌ها اثر می‌گذارد — کش بعدی باید تازه باشد.
    bumpCacheVersion()
    return { ok: true }
  })

  ipcMain.handle('settings:clear', () => {
    clearSettings()
    bumpCacheVersion()
    return { ok: true }
  })

  // دکمه‌های «به‌روزرسانی» در UI این را صدا می‌زنند تا داده از نو همگام شود.
  ipcMain.handle('cache:clear', () => {
    clearCaches()
    bumpCacheVersion()
    logAction('system', 'cache-refresh', 'به‌روزرسانی دستی داده‌ها')
    return { ok: true }
  })

  // نشانگر «آخرین همگام‌سازی» در سربرگ هر نما: زمان واقعی آخرین دریافت از فروشگاه.
  ipcMain.handle('cache:status', () => cacheStatus())

  // لاگ تغییرات: اول از جدول مشترک روی سایت (پلاگین) خوانده می‌شود تا همهٔ
  // دستگاه‌ها یکجا دیده شوند؛ در نبود پلاگین/اتصال، لاگ لوکال همین دستگاه.
  ipcMain.handle('log:query', async (_event, q: ChangeLogQuery) => {
    const query = q ?? {}
    const s = getSettings()
    if (s.siteUrl && s.consumerKey && s.consumerSecret) {
      try {
        return await getServerChangeLog(s, query)
      } catch {
        /* پلاگین نصب نیست یا خطای شبکه → لاگ لوکال */
      }
    }
    return queryLog(query)
  })

  ipcMain.handle('wc:test', async (_event, override?: Settings) => {
    const cfg = override && override.siteUrl && override.consumerKey && override.consumerSecret
      ? sanitizeSettings(override)
      : getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      return { ok: false, message: 'ابتدا آدرس سایت و کلیدهای API را در تنظیمات وارد کنید.' }
    }
    try {
      const result = await testConnection(cfg)
      // نام کارشناس (صاحب کلید) را تازه کن — مبنای «لاگ تغییرات» و پیشخوان.
      await resolveUserName()
      return {
        ok: true,
        message: 'اتصال برقرار شد — ' + result.totalCustomers.toLocaleString('fa-IR') + ' مشتری در فروشگاه موجود است.',
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('wc:customers', async (_event, query: ListCustomersQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const q = query ?? {}
      // جست‌وجوی موبایل (ثبت سفارش سریع): تطبیق از اسنپ‌شاتِ محلی مشتریان — آنی
      // و بدون فشار به هاست. اسنپ‌شات به‌صورت افزایشی تازه می‌شود (پروبِ صفحات
      // جدید ثبت‌نام) و «بارگذاری مجدد» آن را کامل بازسازی می‌کند.
      if (q.phone) {
        const all = await cachedRun('customers-all', cacheTtlMs(cfg, 'list'), (prev?: Customer[]) =>
          syncCustomersSnapshot(cfg, prev),
        )
        const matches = all.filter((c) => phonesMatch(c.billing?.phone, q.phone))
        return {
          customers: matches,
          total: matches.length,
          totalPages: 1,
          page: 1,
          perPage: Math.max(1, matches.length),
        }
      }
      return await cachedRun(ck('customers', q), cacheTtlMs(cfg, 'list'), () => listCustomers(cfg, q))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:create-customer', async (_event, payload: CustomerPayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await createCustomer(cfg, payload ?? {})
      bumpCacheVersion()
      logAction(
        'customers',
        'customer-create',
        'افزودن مشتری',
        [result.first_name, result.last_name].filter(Boolean).join(' ').trim() || '#' + result.id,
        '#' + result.id,
      )
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-create', async (_event, payload: OrderPayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await createOrder(cfg, payload ?? { line_items: [] })
      // Surgical: prepend the new order to the cached snapshot; the orders
      // list stays instant instead of re-walking the whole store.
      if (!patchCachedOrder(result)) bumpCacheVersion()
      logAction(
        'orders',
        'order-create',
        'ثبت سفارش سریع #' + (result.number ?? result.id),
        [
          result.customer_name || [result.billing?.first_name, result.billing?.last_name].filter(Boolean).join(' ').trim(),
          result.total ? result.total + ' ' + (await storeCurrencyLabel()) : '',
        ]
          .filter(Boolean)
          .join(' • '),
        '#' + result.id,
        Number(result.total) || 0,
      )

      // سفارش سریعِ حضوری (sale-hazouri) بلافاصله در انبارِ سفارش‌سریع تخصیص
      // می‌خورد؛ سفارش‌های آنلاین منتظر وضعیتِ انباردار می‌مانند.
      if (result.status === 'sale-hazouri') {
        const quick = activeWarehouses(cfg).find((w) => w.quickOrder)
        if (quick) {
          try {
            const allocated = await allocateOrder(cfg, cfg, result, quick.id)
            if (allocated) {
              if (!patchCachedOrder(allocated)) bumpCacheVersion()
              return allocated
            }
          } catch (err) {
            // تخصیص حیاتی نیست — گذرگاه آشتی‌گیری بعداً دوباره تلاش می‌کند.
            console.warn('warehouse allocation failed for order', result.id, err)
          }
        }
      }
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:reports', async (_event, query: ReportsQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const q = query ?? { days: 30 }
      return await cachedRun(ck('reports', q), cacheTtlMs(cfg, 'report'), () => getSalesReports(cfg, q, cfg.productCosts))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:store-stats', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await cachedRun('store-stats', cacheTtlMs(cfg, 'detail'), () => getStoreStats(cfg))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:products', async (_event, query: ListProductsQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const q = query ?? {}
      return await cachedRun(ck('products', q), cacheTtlMs(cfg, 'list'), () => listProducts(cfg, q))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-catalog', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      // همگام‌سازی افزایشی: فقط محصولاتِ تغییرکرده بعد از آخرین همگام‌سازی
      // دانلود می‌شوند؛ حذف‌ها با اسکن ارزان id و ادغام idempotent اعمال می‌شوند.
      return await cachedRun('product-catalog', cacheTtlMs(cfg, 'report'), async (prev?: ProductCatalog) => {
        const mark = prev && prev.products.length > 0 ? getSyncMark('product-catalog') : undefined
        const { value, since } = await syncProductCatalog(cfg, prev, mark)
        setSyncMark('product-catalog', since)
        return value
      })
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:customer-orders', async (_event, customerId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await cachedRun(ck('customer-orders', customerId), cacheTtlMs(cfg, 'detail'), () => listCustomerOrders(cfg, customerId))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:orders', async (_event, query: ListOrdersQuery) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const q = query ?? {}
      // Bulk print (exact ids): cache the precise fetch under its own key.
      if (q.include && q.include.length > 0) {
        return await cachedRun(ck('orders', q), cacheTtlMs(cfg, 'list'), () => listOrders(cfg, q))
      }
      // Normal list: ONE cached snapshot of all orders — status filters, search
      // and pagination run locally, so switching chips/typing never re-downloads
      // the store. Invalidate via writes, the list TTL, or «بارگذاری مجدد».
      // همگام‌سازی افزایشی: فقط سفارش‌های تغییرکرده بعد از آخرین همگام‌سازی
      // دانلود می‌شوند (modified_after)؛ اسنپ‌شات قبلی برای ادغام به لودر پاس
      // می‌شود و «بارگذاری مجدد» همیشه یک پایه‌گذاری کامل (baseline) است.
      const all = await cachedRun('orders-all', cacheTtlMs(cfg, 'list'), async (prev?: Order[]) => {
        const mark = prev && prev.length > 0 ? getSyncMark('orders-all') : undefined
        const { value, since } = await syncOrdersSnapshot(cfg, prev, mark)
        setSyncMark('orders-all', since)
        return value
      })
      // آشتی‌گیری انبار: تغییر وضعیت‌های انجام‌شده روی دستگاه انباردارها را
      // به تخصیص/برگشت موجودی ترجمه می‌کند (fire-and-forget، با محدودیت زمانی).
      scheduleReconcile(cfg, cfg, all)
      return filterAndPaginateOrders(all, q)
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-status-totals', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      return []
    }
    try {
      return await cachedRun('order-status-totals', cacheTtlMs(cfg, 'list'), () => listOrderStatusTotals(cfg))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-notes', async (_event, orderId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await cachedRun(ck('notes', orderId), cacheTtlMs(cfg, 'detail'), () => listOrderNotes(cfg, orderId))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-note-create', async (_event, orderId: number, payload: OrderNotePayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await createOrderNote(cfg, orderId, payload ?? { note: '' })
      bumpCacheVersion()
      logAction('orders', 'order-note', `یادداشت سفارش #${orderId}`, String(payload?.note ?? '').slice(0, 120), '#' + orderId)
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:order-status', async (_event, orderId: number, status: string) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      let result = await updateOrderStatus(cfg, orderId, status)
      // Surgical: patch the changed order inside the cached snapshot — a full
      // cache invalidation would force a multi-minute re-walk on slow stores.
      if (!patchCachedOrder(result)) bumpCacheVersion()

      // تخصیص/برگشت انبار بلافاصله پس از تغییر وضعیت در همین دستگاه.
      const alloc = allocationForStatus(cfg, status)
      if (alloc !== undefined) {
        try {
          const allocated = await allocateOrder(cfg, cfg, result, alloc)
          if (allocated) {
            result = allocated
            if (!patchCachedOrder(allocated)) bumpCacheVersion()
          }
        } catch (err) {
          // تغییر وضعیت انجام شده است؛ گذرگاه آشتی‌گیری تخصیص را بعداً کامل می‌کند.
          console.warn('warehouse allocation failed for order', orderId, err)
        }
      }
      logAction('orders', 'order-status', `تغییر وضعیت سفارش #${orderId}`, 'وضعیت جدید: ' + faStatus(status), '#' + orderId)
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('warehouses:overview', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      // ONE cached walk (products + variations of every variable product)
      // shared by the «انبارها» view and the sidebar badge.
      return await cachedRun('warehouses-overview', cacheTtlMs(cfg, 'report'), () => warehousesOverview(cfg, cfg))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('warehouses:save-stock', async (_event, payload: WarehouseStockSavePayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await saveWarehouseStock(cfg, cfg, payload ?? { productId: 0, rows: [] })
      // Write → everything goes stale, but the two caches that already hold
      // the fresh data are folded forward and stay valid (no re-walk).
      bumpCacheVersion()
      patchCacheKeepFresh<WarehousesOverview>('warehouses-overview', (o) => applySaveToOverview(o, result))
      patchCacheKeepFresh<ProductDetail>(ck('product-detail', result.productId), (d) => applySaveToProductDetail(d, result))
      logAction(
        'warehouses',
        'stock-save',
        `ثبت موجودی انبار — محصول #${result.productId}`,
        `${result.rows.length} ترکیب` + (result.rows.some((r) => r.siteSynced) ? ' • همگام با سایت' : ''),
        '#' + result.productId,
      )
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-detail', async (_event, productId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await cachedRun(ck('product-detail', productId), cacheTtlMs(cfg, 'report'), () => getProductDetail(cfg, productId))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-variation-update', async (_event, productId: number, variationId: number, patch: VariationPatch) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await updateProductVariation(cfg, productId, variationId, patch ?? {})
      bumpCacheVersion()
      logAction(
        'products',
        'variation-update',
        `ویرایش ترکیب محصول #${productId}`,
        'ترکیب #' + variationId + ' • ' + Object.keys(patch ?? {}).join('، '),
        '#' + productId,
      )
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-update', async (_event, productId: number, patch: ProductPatch) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await updateProduct(cfg, productId, patch ?? {})
      bumpCacheVersion()
      logAction('products', 'product-update', `ویرایش محصول «${result.name}»`, Object.keys(patch ?? {}).join('، '), '#' + result.id)
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:product-create', async (_event, payload: ProductPayload) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const result = await createProduct(cfg, payload ?? {})
      bumpCacheVersion()
      logAction('products', 'product-create', `افزودن محصول «${result.name}»`, undefined, '#' + result.id)
      return result
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('print:receipt', async (_event, doc: PrintReceiptDoc) => {
    if (!doc || typeof doc.html !== 'string' || !doc.html) {
      throw new Error('سند چاپ نامعتبر است.')
    }
    return printViaDialog(doc)
  })

  ipcMain.handle('print:bulk', async (_event, doc: PrintBulkDoc) => {
    if (!doc || typeof doc.html !== 'string' || !doc.html) {
      throw new Error('سند چاپ گروهی نامعتبر است.')
    }
    return printViaDialog(doc)
  })

  ipcMain.handle('wc:product-orders', async (_event, productId: number) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      return await cachedRun(ck('product-orders', productId), cacheTtlMs(cfg, 'detail'), () => listProductOrders(cfg, productId))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
}

app.whenReady().then(() => {
  // Hydrate the persisted WooCommerce response cache before any IPC read runs.
  // TTLs and the cold-start stale shelf come from the user's Settings (تنظیمات).
  initCache(path.join(app.getPath('userData'), 'wc-cache.json'), cacheStaleMs(getSettings()))
  initLog(app.getPath('userData'))
  registerIpc()
  createWindow()
  // نام کارشناس (صاحب کلید API) را در پس‌زمینه تازه کن — مبنای «لاگ تغییرات».
  void resolveUserName()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Persist the latest cache + change-log snapshots when the app exits.
app.on('will-quit', () => {
  flushLog()
  flushCache()
})
