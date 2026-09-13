import { app, BrowserWindow, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { getSettings, saveSettings, clearSettings, sanitizeSettings, cacheTtlMs, cacheStaleMs, normalizeSiteUrl } from './settings'
import { cachedRun, clearCaches, bumpCacheVersion, initCache, flushCache, cacheStatus } from './cache'
import { appendLog, initLog, queryLog, flushLog } from './log'
import { clearPin, hasPin, setPin, verifyPin } from './pins'
import { currencyLabel, DEFAULT_CURRENCY } from '../shared/currency'
import { faStatus } from '../shared/statusLabels'
import { IR_PROVINCES, provinceFa } from '../shared/iran'
import {
  activeWarehouses,
  allocationForStatus,
  allocateOrder,
  saveWarehouseStock,
  scheduleReconcile,
  warehousesOverview,
} from './warehouses'
import {
  testConnection,
  wpUsersMe,
  getAuthUser,
  fetchCurrencyCode,
  createCustomer,
  createOrder,
  findCoupon,
  listOrderNotes,
  createOrderNote,
  updateOrderStatus,
  updateOrder,
  getOrder,
  getProductDetail,
  updateProductVariation,
  updateProduct,
  createProduct,
  postChangeLog,
  getServerChangeLog,
  wooRequest,
} from './woo'
import {
  catalog,
  closeStore,
  customerOrders,
  initStore,
  listCustomers,
  listOrders,
  listProducts,
  listSyncChanges,
  getOrderById,
  productDetail,
  productOrders,
  recentOrders,
  salesReport,
  statusTotals,
  storeStats,
  upsertCustomer,
  upsertOrder,
  upsertProduct,
  upsertVariation,
  wipeStore,
} from './store'
import type { SyncEntity } from './store'
import { allStates, ensureSynced, setOnSynced, startWorker, statesMap, stopWorker, syncNow } from './sync'
import type {
  AccountsSnapshot,
  ChangeLogQuery,
  ChangeLogSection,
  CustomerPayload,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  Order,
  OrderNotePayload,
  OrderPayload,
  OrderUpdatePayload,
  PrintBulkDoc,
  PrintReceiptDoc,
  ProductPatch,
  ProductPayload,
  ReportsQuery,
  Settings,
  SyncChangeQuery,
  VariationPatch,
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

/** SQLite file of the local entity store (one per device, site-switch wipes it). */
function storeFile(): string {
  return path.join(app.getPath('userData'), 'store.db')
}

/** Settings guard for store-backed reads/writes — throws when the API is not configured yet. */
function requireConfig(): Settings {
  const s = getSettings()
  if (!s.siteUrl || !s.consumerKey || !s.consumerSecret) throw new Error('تنظیمات API کامل نشده است.')
  return s
}

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

/* فیلد استان روی خودِ سایت: هستهٔ ووکامرس فهرست استان ایران ندارد (افزونهٔ
 * فارسی‌ساز ثبتش می‌کند) و کدهای افزونه‌ها هم لزوماً استاندارد نیستند — برخی
 * کد عددی دارند. برای اینکه استان در سفارشِ سایت واقعاً «انتخاب» شود، فهرست
 * استان‌های سایت (GET data/countries) واکشی و نام فارسی به «کدِ همان فهرست»
 * نگاشت می‌شود؛ اگر نامی در فهرست نبود، نام فارسی عیناً فرستاده می‌شود. */
let provCodeCache: { map: Map<string, string>; at: number } | null = null
const PROV_MAP_TTL_MS = 60 * 60 * 1000

/** یکسان‌سازی نام استان برای تطبیق: ي/ک عربی → فارسی، نیم‌فاصله/فاصله حذف، «و» حذف. */
const normProv = (v: string): string =>
  v
    .replace(/\u064a/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u200c/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'و')
    .join('')

async function siteProvinceCodes(cfg: Settings): Promise<Map<string, string>> {
  if (provCodeCache && Date.now() - provCodeCache.at <= PROV_MAP_TTL_MS) return provCodeCache.map
  const map = new Map<string, string>()
  try {
    const { data } = await wooRequest<Array<{ code: string; states?: Array<{ code: string; name: string }> }>>(
      cfg,
      'GET',
      '/data/countries',
      {},
      undefined,
      'v3',
      15000,
    )
    const ir = (data ?? []).find((c) => c?.code === 'IR')
    for (const st of ir?.states ?? []) {
      const n = normProv(String(st?.name ?? ''))
      if (n && st?.code !== undefined) map.set(n, String(st.code))
    }
    provCodeCache = { map, at: Date.now() }
  } catch {
    /* سایت در دسترس نیست — کش نشود؛ سفارش بعدی دوباره تلاش می‌کند */
  }
  return map
}

/** استان سفارش را به کدِ فهرستِ خودِ سایت تبدیل می‌کند (تا در فرم سایت انتخاب
 * شده و فارسی نمایش داده شود)؛ نام‌های خارج از فهرست دست‌نخورده می‌مانند. */
async function adaptOrderStates(
  cfg: Settings,
  payload?: { billing?: { state?: string }; shipping?: { state?: string } } | null,
): Promise<void> {
  const isCode = (v?: string) => !!v && IR_PROVINCES.some((p) => p.code.toLowerCase() === v.trim().toLowerCase())
  const b = payload?.billing?.state
  const s = payload?.shipping?.state
  if (!isCode(b) && !isCode(s)) return
  const map = await siteProvinceCodes(cfg)
  const resolve = (v?: string): string | undefined => {
    if (!v) return v
    const fa = provinceFa(v)
    // سایت فهرست استان ندارد → نام فارسی؛ دارد → کدِ همان فهرست (یا نام فارسی اگر نام یافت نشد)
    return map.size === 0 ? fa : (map.get(normProv(fa)) ?? fa)
  }
  if (isCode(b)) payload!.billing!.state = resolve(b)!
  if (isCode(s)) payload!.shipping!.state = resolve(s)!
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
 * بعد از هر نوشته‌ای که موجودی سایت/انبار را عوض می‌کند (تغییر وضعیت سفارش،
 * ویرایش اقلام، ثبت سفارش سریع) رندرر باخبر می‌شود تا نماهای وابسته به موجودی
 * خودکار تازه شوند.
 */
function invalidateStockDependents(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('data:stock-changed')
}

/** After a sync pass finishes: tell the renderer + reconcile off-device status changes. */
function broadcastSynced(entity: SyncEntity): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('data:synced', allStates())
  if (entity === 'orders') {
    const s = getSettings()
    if (s.siteUrl && s.consumerKey && s.consumerSecret) scheduleReconcile(s, s, recentOrders(150))
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
    const prev = getSettings()
    const settings = sanitizeSettings(raw)
    saveSettings(settings)
    // تعویض سایت: مخزن محلی به داده‌های سایت قبلی تعلق دارد — خالی و از نو.
    if (normalizeSiteUrl(settings.siteUrl) !== normalizeSiteUrl(prev.siteUrl)) {
      initStore(storeFile(), normalizeSiteUrl(settings.siteUrl))
      void syncNow()
    }
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

  /* ---- اکانت‌های کارشناس (چند-کاربری روی یک دستگاه) ---- */

  function accountSnapshot(): AccountsSnapshot {
    const s = getSettings()
    const accounts = (s.accounts ?? []).map((a) => ({ ...a, hasPin: hasPin(a.id) }))
    const activeId =
      s.activeAccountId && accounts.some((a) => a.id === s.activeAccountId)
        ? s.activeAccountId
        : (accounts[0]?.id ?? null)
    return { activeId, accounts }
  }

  ipcMain.handle('accounts:list', () => accountSnapshot())

  ipcMain.handle('accounts:add', async (_event, payload: { label?: string; consumerKey: string; consumerSecret: string }) => {
    const s = getSettings()
    if (!s.siteUrl) throw new Error('ابتدا آدرس سایت را در تنظیمات ذخیره کنید.')
    const ck = String(payload?.consumerKey ?? '').trim()
    const cs = String(payload?.consumerSecret ?? '').trim()
    if (!ck || !cs) throw new Error('کلید و رمز API الزامی است.')
    const existing = s.accounts ?? (s.consumerKey && s.consumerSecret
      ? [{ id: 'main', label: s.userName ?? 'کارشناس اصلی', consumerKey: s.consumerKey, consumerSecret: s.consumerSecret }]
      : [])
    if (existing.some((a) => a.consumerKey === ck && a.consumerSecret === cs)) {
      throw new Error('این اکانت قبلاً اضافه شده است.')
    }
    // برچسب پیش‌فرض = نام صاحب کلید (پلاگین لاگ، سپس wp/v2) — اکانت بی‌اعتبار رد می‌شود.
    let label = String(payload?.label ?? '').trim()
    const probe: Settings = { ...s, consumerKey: ck, consumerSecret: cs }
    if (!label) {
      try {
        label = (await getAuthUser(probe)) ?? ''
      } catch {
        /* پلاگین نصب نیست */
      }
      if (!label) {
        try {
          label = (await wpUsersMe(probe)).name || ''
        } catch {
          /* احراز wp/v2 ناموفق */
        }
      }
      if (!label) throw new Error('کلیدهای API معتبر نیستند — احراز هویت با این کلیدها ممکن نشد.')
    }
    const id = 'acct-' + Date.now().toString(36)
    const next: Settings = {
      ...s,
      accounts: [...existing, { id, label, consumerKey: ck, consumerSecret: cs }],
      activeAccountId: id,
      consumerKey: ck,
      consumerSecret: cs,
      userName: label,
    }
    saveSettings(sanitizeSettings(next))
    // کلید جدید ممکن است داده‌های متفاوتی ببیند — همهٔ کش باطل شود.
    bumpCacheVersion()
    logAction('settings', 'account-add', `افزودن اکانت کارشناس: ${label}`)
    return accountSnapshot()
  })

  ipcMain.handle('accounts:remove', (_event, id: string) => {
    const s = getSettings()
    const accounts = s.accounts ?? []
    const target = accounts.find((a) => a.id === id)
    if (!target) throw new Error('اکانت موردنظر پیدا نشد.')
    const remaining = accounts.filter((a) => a.id !== id)
    if (remaining.length === 0) {
      throw new Error('حداقل یک اکانت باید باقی بماند — ابتدا اکانت دیگری اضافه کنید.')
    }
    const activeId = s.activeAccountId === id ? remaining[0].id : (s.activeAccountId ?? remaining[0].id)
    const act = remaining.find((a) => a.id === activeId)
    clearPin(id)
    saveSettings(
      sanitizeSettings({
        ...s,
        accounts: remaining,
        activeAccountId: activeId,
        consumerKey: act!.consumerKey,
        consumerSecret: act!.consumerSecret,
      }),
    )
    bumpCacheVersion()
    logAction('settings', 'account-remove', `حذف اکانت کارشناس: ${target.label}`)
    return accountSnapshot()
  })

  ipcMain.handle('accounts:switch', async (_event, id: string, pin?: string) => {
    const s = getSettings()
    const acc = (s.accounts ?? []).find((a) => a.id === id)
    if (!acc) return { ok: false, message: 'اکانت موردنظر پیدا نشد.' }
    if (s.activeAccountId === id) return { ok: true, userName: s.userName ?? acc.label }
    // نگهبان رمز شخصی: اکانتِ دارای رمز فقط با همان رمز باز می‌شود؛ اکانتِ بدون
    // رمز در اولین سوئیچ رمزش را (همین‌جا) تعیین می‌کند.
    if (hasPin(id)) {
      if (!pin) return { ok: false, needPin: true, hasPin: true, message: 'این اکانت رمز شخصی دارد.' }
      if (!verifyPin(id, pin)) return { ok: false, needPin: true, hasPin: true, message: 'رمز نادرست است.' }
    } else if (pin) {
      try {
        setPin(id, pin)
      } catch (e) {
        return { ok: false, needPin: true, hasPin: false, message: e instanceof Error ? e.message : String(e) }
      }
    } else {
      return {
        ok: false,
        needPin: true,
        hasPin: false,
        message: 'این اکانت هنوز رمز شخصی ندارد — برای ورود، رمزش را تعیین کنید.',
      }
    }
    saveSettings(
      sanitizeSettings({
        ...s,
        activeAccountId: id,
        consumerKey: acc.consumerKey,
        consumerSecret: acc.consumerSecret,
      }),
    )
    bumpCacheVersion()
    // نام صاحب کلید جدید — اول پلاگین، بعد wp/v2؛ در نبود هر دو، برچسب اکانت.
    let userName = acc.label
    const cfg = getSettings()
    try {
      const n = await getAuthUser(cfg)
      if (n) userName = n
    } catch {
      /* پلاگین نصب نیست */
    }
    if (userName === acc.label) {
      try {
        userName = (await wpUsersMe(cfg)).name || acc.label
      } catch {
        /* برچسب اکانت می‌ماند */
      }
    }
    const cur = getSettings()
    if (cur.userName !== userName) saveSettings({ ...cur, userName })
    logAction('settings', 'account-switch', `سوئیچ به اکانت کارشناس: ${userName}`)
    return { ok: true, userName }
  })

  // تعیین/تغییر رمز شخصی اکانت — تغییرِ رمزِ موجود فقط با دانستن رمز فعلی ممکن است.
  ipcMain.handle('accounts:change-pin', (_event, id: string, current: string, next: string) => {
    const s = getSettings()
    const acc = (s.accounts ?? []).find((a) => a.id === id)
    if (!acc) return { ok: false, message: 'اکانت موردنظر پیدا نشد.' }
    const had = hasPin(id)
    if (had && !verifyPin(id, current)) {
      return { ok: false, message: 'رمز فعلی نادرست است.' }
    }
    try {
      setPin(id, next)
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
    logAction('settings', 'account-pin', `${had ? 'تغییر' : 'تعیین'} رمز اکانت کارشناس: ${acc.label}`)
    return { ok: true }
  })

  // «بازسازی کامل داده‌ها» در تنظیمات این را صدا می‌زند: مخزن خالی و همهٔ داده‌ها
  // از نو پایه‌گذاری می‌شود. دکمهٔ «به‌روزرسانی» صفحات دیگر گذرِ دلتای همان بخش است.
  ipcMain.handle('cache:clear', () => {
    clearCaches()
    bumpCacheVersion()
    // مخزن محلی هم خالی می‌شود — گذر بعدی سینک پایه‌گذاری کامل (baseline) است.
    wipeStore()
    void syncNow()
    logAction('system', 'cache-refresh', 'به‌روزرسانی دستی داده‌ها')
    return { ok: true }
  })

  // نشانگر «آخرین همگام‌سازی» در سربرگ هر نما + وضعیت سینک هر موجودیت.
  ipcMain.handle('cache:status', () => ({ ...cacheStatus(), entities: statesMap() }))

  // دکمهٔ «همگام‌سازی الان» در تنظیمات: یک گذر سینک فوری و برگرداندن وضعیت.
  ipcMain.handle('sync:now', (_event, entity?: SyncEntity) => syncNow(entity))

  // «تغییرات فروشگاه»: created/updated/status_changed که هنگام سینک از سایت
  // تشخیص داده شده — از جدول change_log مخزن محلی.
  ipcMain.handle('sync:changes', (_event, q?: SyncChangeQuery) => listSyncChanges(q ?? {}))

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
    requireConfig()
    await ensureSynced('customers')
    // جست‌وجوی موبایل (ثبت سفارش سریع) هم از مخزن محلی پاس داده می‌شود.
    return listCustomers(query ?? {})
  })

  ipcMain.handle('wc:create-customer', async (_event, payload: CustomerPayload) => {
    const cfg = requireConfig()
    const body: CustomerPayload = { ...(payload ?? {}) }
    if (!String(body.email ?? '').trim()) {
      // وردپرس ایمیلِ بدون @دامنه را با «ایمیل نامعتبر» رد می‌کند؛ بنابراین
      // فقط شماره ممکن نیست — شماره + دامنهٔ رزروشدهٔ غیرقابل‌دریافت می‌گذاریم
      // تا هم فرم معتبر باشد و هم به صندوقِ دامنهٔ فروشگاه تحویل نشود.
      const local = String(body.username ?? body.billing?.phone ?? '').replace(/[^0-9A-Za-z]/g, '')
      if (local) body.email = `${local}@no-reply.invalid`
    }
    const result = await createCustomer(cfg, body)
    upsertCustomer(result, { silent: true })
    logAction(
      'customers',
      'customer-create',
      'افزودن مشتری',
      [result.first_name, result.last_name].filter(Boolean).join(' ').trim() || '#' + result.id,
      '#' + result.id,
    )
    return result
  })

  ipcMain.handle('wc:order-create', async (_event, payload: OrderPayload) => {
    const cfg = requireConfig()
    await adaptOrderStates(cfg, payload)
    const result = await createOrder(cfg, payload ?? { line_items: [] })
    upsertOrder(result, { silent: true })
    // نام غنی‌شده (از جدول مشتریان انبار) به پاسخ بچسبد تا رسید سفارش سریع آن را نشان دهد.
    const enriched = getOrderById(Number(result.id))
    if (enriched) result.customer_name = enriched.customer_name
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
            upsertOrder(allocated, { silent: true })
            invalidateStockDependents()
            return allocated
          }
        } catch (err) {
          // تخصیص حیاتی نیست — گذرگاه آشتی‌گیری بعداً دوباره تلاش می‌کند.
          console.warn('warehouse allocation failed for order', result.id, err)
        }
      }
    }
    return result
  })

  ipcMain.handle('wc:coupon-get', async (_event, code: string) => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      throw new Error('تنظیمات API کامل نشده است.')
    }
    try {
      const clean = String(code ?? '').trim()
      if (!clean) return null
      // Cached (negative results included) — re-applying a code on a slow
      // store must not wait another full round-trip. Apps never write
      // coupons, so a short detail TTL + write-invalidation is enough.
      return await cachedRun(ck('coupon', clean.toLowerCase()), cacheTtlMs(cfg, 'detail'), () => findCoupon(cfg, clean))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle('wc:reports', async (_event, query: ReportsQuery) => {
    const cfg = requireConfig()
    await ensureSynced('orders')
    return salesReport(query ?? { days: 30 }, cfg.productCosts)
  })

  ipcMain.handle('wc:store-stats', async () => {
    requireConfig()
    await Promise.all([ensureSynced('customers'), ensureSynced('orders')])
    return storeStats()
  })

  ipcMain.handle('wc:products', async (_event, query: ListProductsQuery) => {
    requireConfig()
    await ensureSynced('products')
    return listProducts(query ?? {})
  })

  ipcMain.handle('wc:product-catalog', async () => {
    requireConfig()
    await ensureSynced('products')
    return catalog()
  })

  ipcMain.handle('wc:customer-orders', async (_event, customerId: number) => {
    requireConfig()
    await Promise.all([ensureSynced('orders'), ensureSynced('customers')])
    return customerOrders(customerId)
  })

  ipcMain.handle('wc:orders', async (_event, query: ListOrdersQuery) => {
    requireConfig()
    await ensureSynced('orders')
    return listOrders(query ?? {})
  })

  ipcMain.handle('wc:order-status-totals', async () => {
    const cfg = getSettings()
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      return []
    }
    await ensureSynced('orders')
    return statusTotals()
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
    const cfg = requireConfig()
    let result = await updateOrderStatus(cfg, orderId, status)
    upsertOrder(result, { silent: true })

    // تخصیص/برگشت انبار بلافاصله پس از تغییر وضعیت در همین دستگاه.
    const alloc = allocationForStatus(cfg, status)
    if (alloc !== undefined) {
      try {
        const allocated = await allocateOrder(cfg, cfg, result, alloc)
        if (allocated) {
          result = allocated
          upsertOrder(allocated, { silent: true })
        }
      } catch (err) {
        // تغییر وضعیت انجام شده است؛ گذرگاه آشتی‌گیری تخصیص را بعداً کامل می‌کند.
        console.warn('warehouse allocation failed for order', orderId, err)
      }
    }
    logAction('orders', 'order-status', `تغییر وضعیت سفارش #${orderId}`, 'وضعیت جدید: ' + faStatus(status), '#' + orderId)
    // ووکامرس با تغییر وضعیت موجودی را کم/زیاد کرده — انبارها خودکار تازه شوند.
    invalidateStockDependents()
    return result
  })

  ipcMain.handle('wc:order-update', async (_event, orderId: number, payload: OrderUpdatePayload) => {
    const cfg = requireConfig()
    await adaptOrderStates(cfg, payload)
    // جریان استاندارد ویرایش ووکامرس: ابتدا وضعیت به «در انتظار پرداخت» برمی‌گردد
    // (موجودی/سقف‌ها در فروشگاه اصلاح می‌شوند)، سپس اقلام/آدرس ویرایش و در پایان
    // وضعیت قبلی سفارش دوباره برقرار می‌شود.
    const current = await getOrder(cfg, orderId)
    const origStatus = current.status
    const dance = origStatus !== 'pending'
    let result: Order
    if (dance) await updateOrderStatus(cfg, orderId, 'pending')
    try {
      result = await updateOrder(cfg, orderId, payload)
    } catch (e) {
      if (dance) await updateOrderStatus(cfg, orderId, origStatus).catch(() => {})
      throw e
    }
    if (dance) result = await updateOrderStatus(cfg, orderId, origStatus)
    upsertOrder(result, { silent: true })
    const detail =
      payload.line_items.length + ' قلم' +
      (payload.billing || payload.shipping ? ' · آدرس به‌روزرسانی شد' : '') +
      (dance ? ' · وضعیت: ' + faStatus(result.status) : '')
    logAction('orders', 'order-update', `ویرایش سفارش #${orderId}`, detail, '#' + orderId)
    // رقصِ وضعیتِ ویرایش موجودی سایت را جابه‌جا کرده — انبارها تازه شوند.
    invalidateStockDependents()
    return result
  })

  ipcMain.handle('warehouses:overview', async () => {
    requireConfig()
    await ensureSynced('products')
    return warehousesOverview(getSettings())
  })

  ipcMain.handle('warehouses:save-stock', async (_event, payload: WarehouseStockSavePayload) => {
    const cfg = requireConfig()
    const result = await saveWarehouseStock(cfg, cfg, payload ?? { productId: 0, rows: [] })
    logAction(
      'warehouses',
      'stock-save',
      `ثبت موجودی انبار — محصول #${result.productId}`,
      `${result.rows.length} ترکیب` + (result.rows.some((r) => r.siteSynced) ? ' • همگام با سایت' : ''),
      '#' + result.productId,
    )
    invalidateStockDependents()
    return result
  })

  ipcMain.handle('wc:product-detail', async (_event, productId: number) => {
    const cfg = requireConfig()
    await ensureSynced('products')
    const local = productDetail(productId)
    if (local) return local
    // Fallback: a node the store has not seen yet (deep link right after creation).
    const fresh = await getProductDetail(cfg, productId)
    upsertProduct(fresh.product, { silent: true })
    for (const v of fresh.variations) upsertVariation(productId, v)
    return fresh
  })

  ipcMain.handle('wc:product-variation-update', async (_event, productId: number, variationId: number, patch: VariationPatch) => {
    const cfg = requireConfig()
    const result = await updateProductVariation(cfg, productId, variationId, patch ?? {})
    upsertVariation(productId, result)
    logAction(
      'products',
      'variation-update',
      `ویرایش ترکیب محصول #${productId}`,
      'ترکیب #' + variationId + ' • ' + Object.keys(patch ?? {}).join('، '),
      '#' + productId,
    )
    invalidateStockDependents()
    return result
  })

  ipcMain.handle('wc:product-update', async (_event, productId: number, patch: ProductPatch) => {
    const cfg = requireConfig()
    const result = await updateProduct(cfg, productId, patch ?? {})
    upsertProduct(result, { silent: true })
    logAction('products', 'product-update', `ویرایش محصول «${result.name}»`, Object.keys(patch ?? {}).join('، '), '#' + result.id)
    invalidateStockDependents()
    return result
  })

  ipcMain.handle('wc:product-create', async (_event, payload: ProductPayload) => {
    const cfg = requireConfig()
    const result = await createProduct(cfg, payload ?? {})
    upsertProduct(result, { silent: true })
    logAction('products', 'product-create', `افزودن محصول «${result.name}»`, undefined, '#' + result.id)
    return result
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
    requireConfig()
    await ensureSynced('orders')
    return productOrders(productId)
  })
}

app.whenReady().then(() => {
  // Hydrate the persisted WooCommerce response cache before any IPC read runs.
  // TTLs and the cold-start stale shelf come from the user's Settings (تنظیمات).
  initCache(path.join(app.getPath('userData'), 'wc-cache.json'), cacheStaleMs(getSettings()))
  initLog(app.getPath('userData'))
  // مخزن محلی موجودیت‌ها (سفارش‌ها/محصولات/مشتریان) — تعویض سایت آن را خالی می‌کند.
  initStore(storeFile(), normalizeSiteUrl(getSettings().siteUrl))
  registerIpc()
  createWindow()
  setOnSynced(broadcastSynced)
  startWorker()
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
  stopWorker()
  flushLog()
  flushCache()
  closeStore()
})
