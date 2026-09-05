import { useEffect, useState } from 'react'
import type { ConnState, ViewId } from '../../shared/types'
import { api, isMock } from '../api'
import { faDigits, faNum } from '../lib/format'
import { IconBag, IconBox, IconGear, IconStore, IconUsers } from './Icons'

interface Props {
  view: ViewId
  configured: boolean
  host: string | null
  conn: ConnState
  storeName: string | null
  onNavigate: (view: ViewId) => void
}

export default function Sidebar({ view, configured, host, conn, storeName, onNavigate }: Props) {
  // سفارش‌های در حال پردازش (processing) — badge کنار منوی سفارش‌ها.
  const [processingCount, setProcessingCount] = useState<number | null>(null)

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
    // Re-fetch when navigating to سفارش‌ها (a status change may have happened there)
    // and when the connection state settles.
  }, [configured, view, conn.state])

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo">
          <IconStore size={23} />
        </div>
        <div>
          <div className="sb-name">داشبورد ووکامرس</div>
          <div className="sb-tag">مدیریت فروشگاه «{storeName ?? 'ووکامرس'}»</div>
        </div>
      </div>

      <nav className="sb-nav">
        <div className="sb-sec">منوها</div>
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
          className={'sb-item' + (view === 'orders' ? ' active' : '')}
          onClick={() => onNavigate('orders')}
        >
          <IconBag size={18} />
          <span>سفارش‌ها</span>
          {processingCount !== null && <span className="sb-badge">{faNum(processingCount)}</span>}
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
          className={'sb-item' + (view === 'settings' ? ' active' : '')}
          onClick={() => onNavigate('settings')}
        >
          <IconGear size={18} />
          <span>تنظیمات</span>
        </button>
      </nav>

      <div className="sb-foot">
        {renderConnection()}
        {isMock && <div className="mock-chip">پیش‌نمایش با دادهٔ آزمایشی</div>}
        <div className="sb-ver">نسخهٔ {faDigits('1.1')}</div>
      </div>
    </aside>
  )

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
