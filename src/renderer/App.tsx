import { useCallback, useEffect, useState } from 'react'
import type { ConnState, Settings, ViewId } from '../shared/types'
import { api, bridgeMissing } from './api'
import { DEMO_SETTINGS } from './lib/mock'
import CustomersView from './components/CustomersView'
import OrdersView from './components/OrdersView'
import ProductsView from './components/ProductsView'
import SettingsView from './components/SettingsView'
import Sidebar from './components/Sidebar'

function hostOf(url: string): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export default function App() {
  const [view, setView] = useState<ViewId>('customers')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [conn, setConn] = useState<ConnState>({ state: 'idle' })

  const isConfigured = (s: Settings | null): boolean => !!(s?.siteUrl && s?.consumerKey && s?.consumerSecret)

  const checkConnection = useCallback(async (cfg: Settings): Promise<boolean> => {
    if (!cfg.siteUrl || !cfg.consumerKey || !cfg.consumerSecret) {
      setConn({ state: 'idle' })
      return false
    }
    setConn({ state: 'checking' })
    const r = await api.testConnection()
    setConn(r.ok ? { state: 'ok', message: r.message } : { state: 'fail', message: r.message })
    return r.ok
  }, [])

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

  /** Demo preview only: explicitly load the built-in sample dataset. */
  const handleUseDemo = useCallback(async () => {
    await api.saveSettings(DEMO_SETTINGS)
    setSettings(DEMO_SETTINGS)
    setConn({ state: 'ok', message: 'حالت نمایشی فعال شد — دادهٔ آزمایشی بارگذاری می‌شود.' })
    setView('customers')
  }, [])

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

  return (
    <div className="app">
      <Sidebar
        view={view}
        configured={configured}
        host={hostOf(settings?.siteUrl ?? '')}
        conn={conn}
        onNavigate={setView}
      />
      <main className="main">
        {view === 'customers' ? (
          <CustomersView
            key={`${configured}-${settings?.siteUrl ?? ''}-${conn.state}`}
            configured={configured}
            conn={conn}
            onGoSettings={() => setView('settings')}
            onUseDemo={handleUseDemo}
          />
        ) : view === 'orders' ? (
          <OrdersView
            key={`${configured}-${settings?.siteUrl ?? ''}-${conn.state}`}
            configured={configured}
            conn={conn}
            onGoSettings={() => setView('settings')}
          />
        ) : view === 'products' ? (
          <ProductsView
            key={`${configured}-${settings?.siteUrl ?? ''}-${conn.state}`}
            configured={configured}
            conn={conn}
            onGoSettings={() => setView('settings')}
          />
        ) : (
          <SettingsView settings={settings} conn={conn} onSaved={handleSaved} />
        )}
      </main>
    </div>
  )
}
