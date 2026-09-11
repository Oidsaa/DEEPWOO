import { useCallback, useEffect, useState } from 'react'
import type { AccountsSnapshot, ConnState, Settings, ViewId } from '../shared/types'
import { api, bridgeMissing } from './api'
import { applyAppearance } from './lib/theme'
import { DEMO_SETTINGS } from './lib/mock'
import CustomersView from './components/CustomersView'
import ChangeLogView from './components/ChangeLogView'
import DashboardView from './components/DashboardView'
import OrdersView from './components/OrdersView'
import ProductsView from './components/ProductsView'
import QuickOrderView from './components/QuickOrderView'
import ReportsView from './components/ReportsView'
import SettingsView from './components/SettingsView'
import Sidebar from './components/Sidebar'
import WarehousesView from './components/WarehousesView'

function hostOf(url: string): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export default function App() {
  const [view, setView] = useState<ViewId>('dashboard')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conn, setConn] = useState<ConnState>({ state: 'idle' })
  // اکانت‌های کارشناس (برای سوئیچر سایدبار) + خطای سوئیچ.
  const [accounts, setAccounts] = useState<AccountsSnapshot | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchErr, setSwitchErr] = useState<string | null>(null)

  const isConfigured = (s: Settings | null): boolean => !!(s?.siteUrl && s?.consumerKey && s?.consumerSecret)

  const refreshAccounts = useCallback(() => {
    api
      .listAccounts()
      .then(setAccounts)
      .catch(() => setAccounts(null))
  }, [])

  useEffect(() => {
    refreshAccounts()
  }, [refreshAccounts, settings?.activeAccountId, settings?.accounts?.length])

  const checkConnection = useCallback(async (cfg: Settings): Promise<boolean> => {
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      setConn({ state: 'idle' })
      return false
    }
    setConn({ state: 'checking' })
    const r = await api.testConnection()
    setConn(r.ok ? { state: 'ok', message: r.message } : { state: 'fail', message: r.message })
    if (r.ok) {
      // نام کارشناس (صاحب کلید) همین حالا در main resolve و ذخیره شده — دوباره بخوان.
      void api
        .getSettings()
        .then((fresh) => setSettings(fresh))
        .catch(() => {})
    }
    return r.ok
  }, [])

  useEffect(() => {
    applyAppearance(settings?.theme, settings?.accentColor)
  }, [settings?.theme, settings?.accentColor])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const s = await api.getSettings()
      if (cancelled) return
      setSettings(s)
      // On start-up, silently probe the connection; the customer list loads live on view mount.
      if (isConfigured(s)) void checkConnection(s)
    })()
    return () => {
      cancelled = true
    }
  }, [checkConnection])

  /**
   * After saving settings: reload canonical values, test the connection and —
   * when it succeeds — jump straight to the customers view so the live list
   * (synced from the store) is shown immediately.
   */
  const handleSaved = useCallback(async () => {
    const s = await api.getSettings()
    setSettings(s)
    const ok = await checkConnection(s)
    if (ok && isConfigured(s)) setView('customers')
  }, [checkConnection])

  /** سوئیچ اکانت کارشناس از سایدبار: کلیدها عوض، کش باطل، اتصال دوباره بررسی، نماها از نو. */
  const handleSwitchAccount = useCallback(
    async (id: string) => {
      setSwitching(true)
      setSwitchErr(null)
      try {
        const r = await api.switchAccount(id)
        if (!r.ok) {
          setSwitchErr(r.message ?? 'سوئیچ اکانت ناموفق بود.')
          return
        }
        const s = await api.getSettings()
        setSettings(s)
        setView('dashboard')
        if (isConfigured(s)) await checkConnection(s)
      } catch (e) {
        setSwitchErr(e instanceof Error ? e.message : String(e))
      } finally {
        setSwitching(false)
      }
    },
    [checkConnection],
  )

  useEffect(() => {
    if (!switchErr) return
    const t = window.setTimeout(() => setSwitchErr(null), 5200)
    return () => window.clearTimeout(t)
  }, [switchErr])

  /** پس از افزودن/حذف اکانت در تنظیمات: تنظیمات + اتصال تازه شود، بدون پرش از تنظیمات. */
  const handleAccountsChanged = useCallback(async () => {
    const s = await api.getSettings()
    setSettings(s)
    refreshAccounts()
    if (isConfigured(s)) await checkConnection(s)
  }, [checkConnection, refreshAccounts])

  /** Demo preview only: explicitly load the built-in sample dataset. */
  const handleUseDemo = useCallback(async () => {
    // ترجیحات ظاهری دستگاهی هستند (تم/رنگ/لوگو) — با ورود به حالت نمایشی پاک نشوند.
    const demo: Settings = {
      ...DEMO_SETTINGS,
      theme: settings?.theme,
      accentColor: settings?.accentColor,
      storeLogo: settings?.storeLogo,
    }
    await api.saveSettings(demo)
    setSettings(demo)
    setConn({ state: 'ok', message: 'حالت نمایشی فعال شد — دادهٔ آزمایشی بارگذاری می‌شود.' })
    setView('customers')
  }, [settings?.theme, settings?.accentColor, settings?.storeLogo])

  if (bridgeMissing) {
    return (
      <div className="bridge-err">
        <div className="bridge-err-card">
          <div className="empty-ic amber" style={{ marginInline: 'auto' }}>
            ⚠
          </div>
          <div className="empty-title">پل ارتباطی برنامه بارگذاری نشد</div>
          <div className="empty-sub">
            این برنامه باید داخل نسخهٔ دسکتاپ اجرا شود؛ اتصال امن به فروشگاه (پل preload) در دسترس نیست. برنامه را
            ببندید و دوباره اجرا کنید؛ اگر مشکل ادامه داشت، نسخهٔ نصب‌شده را به‌روزرسانی یا دوباره نصب کنید.
          </div>
        </div>
      </div>
    )
  }

  const configured = isConfigured(settings)
  /** Store name from «اطلاعات رسید» (Settings), shown across the UI. */
  const storeName = (settings?.storeName ?? '').trim() || null
  /** Views remount when the account changes too — every view refetches fresh data. */
  const viewKey = `${configured}-${settings?.siteUrl ?? ''}-${settings?.activeAccountId ?? ''}-${conn.state}`

  return (
    <div className="app">
      <Sidebar
        view={view}
        configured={configured}
        host={hostOf(settings?.siteUrl ?? '')}
        conn={conn}
        storeName={storeName}
        userName={settings?.userName ?? null}
        logo={settings?.storeLogo ?? null}
        accounts={accounts}
        switchingAccount={switching}
        switchError={switchErr}
        onSwitchAccount={handleSwitchAccount}
        onNavigate={setView}
      />
      <main className="main">
        {view === 'dashboard' ? (
          <DashboardView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            userName={settings?.userName ?? null}
            onGoSettings={() => setView('settings')}
            onOpenLog={() => setView('log')}
          />
        ) : view === 'customers' ? (
          <CustomersView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
            onUseDemo={handleUseDemo}
          />
        ) : view === 'orders' ? (
          <OrdersView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'quick-order' ? (
          <QuickOrderView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'products' ? (
          <ProductsView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'warehouses' ? (
          <WarehousesView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'log' ? (
          <ChangeLogView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'reports' ? (
          <ReportsView
            key={viewKey}
            configured={configured}
            conn={conn}
            storeName={storeName}
            onGoSettings={() => setView('settings')}
          />
        ) : (
          <SettingsView settings={settings} conn={conn} onSaved={handleSaved} onAccountsChanged={handleAccountsChanged} />
        )}
      </main>
    </div>
  )
}
