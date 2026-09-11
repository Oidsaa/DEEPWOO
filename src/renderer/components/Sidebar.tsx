import { useEffect, useState } from 'react'
import type { AccountsSnapshot, ConnState, ViewId } from '../../shared/types'
import { api, isMock } from '../api'
import { faDigits, faNum } from '../lib/format'
import {
  IconBag,
  IconBox,
  IconChart,
  IconChevronD,
  IconClock,
  IconGear,
  IconGrid,
  IconPlus,
  IconStore,
  IconUsers,
  IconWarehouse,
} from './Icons'

interface Props {
  view: ViewId
  configured: boolean
  host: string | null
  conn: ConnState
  storeName: string | null
  userName?: string | null
  /** لوگوی شخصی انتخاب‌شده در تنظیمات (data URL) — جایگزین کادر لوگوی پیش‌فرض. */
  logo?: string | null
  /** اکانت‌های کارشناس (از App) — وقتی بیش از یکی باشد سوئیچر نمایش داده می‌شود. */
  accounts?: AccountsSnapshot | null
  /** در حال سوئیچ اکانت (دکمه‌ها غیرفعال می‌شوند). */
  switchingAccount?: boolean
  /** خطای سوئیچ اکانت — زیر دکمهٔ کارشناس نمایش داده می‌شود. */
  switchError?: string | null
  onSwitchAccount?: (id: string) => void
  onNavigate: (view: ViewId) => void
}

export default function Sidebar({
  view,
  configured,
  host,
  conn,
  storeName,
  userName,
  logo,
  accounts,
  switchingAccount,
  switchError,
  onSwitchAccount,
  onNavigate,
}: Props) {
  // سفارش‌های در حال انجام (processing) — badge کنار منوی سفارش‌ها.
  const [processingCount, setProcessingCount] = useState<number | null>(null)
  // اقلامِ مغایرت‌دار (مجموع انبارها ≠ موجودی سایت) — badge کنار منوی انبارها.
  const [mismatchCount, setMismatchCount] = useState<number | null>(null)
  // تغییر وضعیت سفارش/انبارداری در هر نمای دیگر → بج‌ها هم تازه شوند.
  const [stockTick, setStockTick] = useState(0)
  // منوی سوئیچ اکانت کارشناس.
  const [acctOpen, setAcctOpen] = useState(false)

  // Write actions in the main process push data:stock-changed → refetch both badges.
  useEffect(() => api.onStockChanged(() => setStockTick((t) => t + 1)), [])

  useEffect(() => {
    if (!acctOpen) return
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.sb-user-wrap')) return
      setAcctOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [acctOpen])

  useEffect(() => {
    if (!configured) {
      setProcessingCount(null)
      return
    }
    let cancelled = false
    api
      .listOrderStatusTotals()
      .then((list) => {
        if (!cancelled) setProcessingCount(list.find((s) => s.slug === 'processing')?.total ?? 0)
      })
      .catch(() => {
        if (!cancelled) setProcessingCount(null)
      })
    return () => {
      cancelled = true
    }
    // Re-fetch when navigating to سفارش‌ها (a status change may have happened there),
    // when the connection state settles, and after any stock-affecting write.
  }, [configured, view, conn.state, stockTick])

  useEffect(() => {
    if (!configured) {
      setMismatchCount(null)
      return
    }
    let cancelled = false
    api
      .getWarehousesOverview()
      .then((ov) => {
        if (!cancelled) {
          setMismatchCount(ov.items.filter((i) => i.delta !== null && i.delta !== 0).length)
        }
      })
      .catch(() => {
        if (!cancelled) setMismatchCount(null)
      })
    return () => {
      cancelled = true
    }
    // Shares the cached 'warehouses-overview' snapshot — refetch on navigation,
    // after an انبارداری save/allocation, and after any stock-affecting write.
  }, [configured, view, conn.state, stockTick])

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        {logo ? (
          <img className="sb-logo sb-logo-img" src={logo} alt="لوگوی فروشگاه" />
        ) : (
          <div className="sb-logo">
            <IconStore size={23} />
          </div>
        )}
        <div>
          <div className="sb-name">داشبورد ووکامرس</div>
          <div className="sb-tag">مدیریت فروشگاه «{storeName ?? 'ووکامرس'}»</div>
        </div>
      </div>

      <nav className="sb-nav">
        <div className="sb-sec">منوها</div>
        <button
          type="button"
          className={'sb-item' + (view === 'dashboard' ? ' active' : '')}
          onClick={() => onNavigate('dashboard')}
        >
          <IconGrid size={18} />
          <span>پیشخوان</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'orders' ? ' active' : '')}
          onClick={() => onNavigate('orders')}
        >
          <IconBag size={18} />
          <span>سفارش‌ها</span>
          {processingCount !== null && <span className="sb-badge">{faNum(processingCount)}</span>}
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'quick-order' ? ' active' : '')}
          onClick={() => onNavigate('quick-order')}
        >
          <IconPlus size={18} />
          <span>ثبت سفارش سریع</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'products' ? ' active' : '')}
          onClick={() => onNavigate('products')}
        >
          <IconBox size={18} />
          <span>محصولات</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'warehouses' ? ' active' : '')}
          onClick={() => onNavigate('warehouses')}
        >
          <IconWarehouse size={18} />
          <span>انبارها</span>
          {mismatchCount !== null && mismatchCount > 0 && (
            <span className="sb-badge sb-badge-warn" title="اقلام مغایرت‌دار با موجودی سایت">
              {faNum(mismatchCount)}
            </span>
          )}
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'customers' ? ' active' : '')}
          onClick={() => onNavigate('customers')}
        >
          <IconUsers size={18} />
          <span>مشتریان</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'reports' ? ' active' : '')}
          onClick={() => onNavigate('reports')}
        >
          <IconChart size={18} />
          <span>گزارشات</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'log' ? ' active' : '')}
          onClick={() => onNavigate('log')}
        >
          <IconClock size={18} />
          <span>لاگ تغییرات</span>
        </button>
        <button
          type="button"
          className={'sb-item' + (view === 'settings' ? ' active' : '')}
          onClick={() => onNavigate('settings')}
        >
          <IconGear size={18} />
          <span>تنظیمات</span>
        </button>
      </nav>

      <div className="sb-foot">
        {renderConnection()}
        {accounts && accounts.accounts.length > 0 ? (
          <div className="sb-user-wrap">
            <button
              type="button"
              className="sb-user sb-user-btn"
              onClick={() => setAcctOpen((o) => !o)}
              title="سوئیچ بین اکانت‌های کارشناس"
              aria-expanded={acctOpen}
            >
              <span className="sb-user-txt">کارشناس: {userName ?? activeLabel()}</span>
              <IconChevronD size={13} className={acctOpen ? 'sb-chev flip' : 'sb-chev'} />
            </button>
            {acctOpen && (
              <div className="sb-acct-menu" role="menu">
                {accounts.accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitem"
                    className={'sb-acct' + (a.id === accounts.activeId ? ' active' : '')}
                    disabled={switchingAccount}
                    onClick={() => {
                      setAcctOpen(false)
                      if (a.id !== accounts.activeId) onSwitchAccount?.(a.id)
                    }}
                  >
                    <span className={'sb-acct-dot' + (a.id === accounts.activeId ? ' on' : '')} />
                    <span className="sb-acct-label">{a.label}</span>
                    {a.id === accounts.activeId && <span className="sb-acct-active">فعال</span>}
                  </button>
                ))}
                <div className="sb-acct-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="sb-acct sb-acct-manage"
                  onClick={() => {
                    setAcctOpen(false)
                    onNavigate('settings')
                  }}
                >
                  <IconGear size={13} />
                  مدیریت اکانت‌ها
                </button>
              </div>
            )}
          </div>
        ) : userName ? (
          <div className="sb-user" title="صاحب کلید API این دستگاه">
            کارشناس: {userName}
          </div>
        ) : null}
        {switchError && (
          <div className="sb-switch-err" role="alert">
            {switchError}
          </div>
        )}
        {isMock && <div className="mock-chip">پیش‌نمایش با دادهٔ آزمایشی</div>}
        <div className="sb-ver">نسخهٔ {faDigits('1.1')}</div>
      </div>
    </aside>
  )

  function activeLabel(): string | null {
    const act = accounts?.accounts.find((a) => a.id === accounts?.activeId)
    return act?.label ?? null
  }

  function renderConnection() {
    if (!configured || conn.state === 'idle') {
      return (
        <button type="button" className="conn-box" onClick={() => onNavigate('settings')}>
          <span className="conn-dot off" />
          <span className="conn-txt">
            <span className="conn-title">اتصال به فروشگاه</span>
            <span className="conn-sub">کلید API را در تنظیمات وارد کنید</span>
          </span>
        </button>
      )
    }
    if (conn.state === 'checking') {
      return (
        <div className="conn-box">
          <span className="conn-dot check" />
          <span className="conn-txt">
            <span className="conn-title">در حال بررسی اتصال…</span>
            <span className="conn-sub">{host}</span>
          </span>
        </div>
      )
    }
    if (conn.state === 'ok') {
      return (
        <div className="conn-box">
          <span className="conn-dot ok" />
          <span className="conn-txt">
            <span className="conn-title ok">اتصال برقرار است</span>
            <span className="conn-sub">{host}</span>
          </span>
        </div>
      )
    }
    return (
      <button type="button" className="conn-box" onClick={() => onNavigate('settings')} title={conn.message}>
        <span className="conn-dot fail" />
        <span className="conn-txt">
          <span className="conn-title" style={{ color: 'var(--red)' }}>
            اتصال برقرار نیست
          </span>
          <span className="conn-sub">برای رفع مشکل به تنظیمات بروید</span>
        </span>
      </button>
    )
  }
}
