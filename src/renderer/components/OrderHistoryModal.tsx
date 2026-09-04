import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Customer, Order, OrdersResult } from '../../shared/types'
import { api } from '../api'
import { avatarPalette, faDate, faDigits, faNum, orderStatusMeta } from '../lib/format'
import { IconAlert, IconBag, IconRefresh, IconX } from './Icons'

interface Props {
  customer: Customer
  onClose: () => void
}

function initialsOf(c: Customer): string {
  const fn = (c.first_name ?? '').trim()
  const ln = (c.last_name ?? '').trim()
  if (fn || ln) return ((fn[0] ?? '') + (ln[0] ?? '')).trim().slice(0, 2) || '؟'
  const u = c.username || c.email
  return u.slice(0, 2).toUpperCase()
}

export default function OrderHistoryModal({ customer, onClose }: Props) {
  const [result, setResult] = useState<OrdersResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listCustomerOrders(customer.id)
      .then((r) => {
        if (!cancelled) setResult(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [customer.id, loadCount])

  const retry = useCallback(() => setLoadCount((n) => n + 1), [])

  const pal = avatarPalette(String(customer.id) + customer.username + customer.email)
  const name = [customer.first_name, customer.last_name].filter(Boolean).join(' ') || customer.username || customer.email

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`تاریخچهٔ سفارش‌های ${name}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="u-avatar" style={{ width: 44, height: 44, borderRadius: 13, color: pal.color, background: pal.bg }}>
              {initialsOf(customer)}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </div>
              <div className="modal-sub" style={{ direction: 'rtl', textAlign: 'start' }}>
                {customer.username && <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>@{customer.username}</span>}
                {customer.billing?.phone ? (
                  <span>
                    {' '}
                    • <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>{faDigits(customer.billing.phone)}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>

        <div className="order-summary">
          <div className="order-summary-item">
            <span className="stat-label">کل سفارش‌ها</span>
            <span className="order-summary-val">{result ? faNum(result.total) : faNum(customer.orders_count)}</span>
          </div>
          <div className="order-summary-item">
            <span className="stat-label">مجموع خرید</span>
            <span className="order-summary-val" title="شامل همهٔ وضعیت‌ها به‌جز ناموفق، لغو شده و بازپرداخت‌شده">
              {result ? faNum(result.purchaseSum) : faNum(customer.total_spent)}
            </span>
          </div>
          <div className="order-summary-item order-summary-sub">
            <span className="stat-label">ایمیل</span>
            <span className="order-summary-val" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-2)' }} dir="ltr">
              {customer.email || '—'}
            </span>
          </div>
        </div>
        {result?.purchaseSumTruncated && (
          <div className="f-hint" style={{ padding: '2px 2px 0' }}>
            مجموع خرید از روی {faNum(2000)} سفارش اخیر محاسبه شد — سفارش‌های بیشتری در فروشگاه وجود دارد.
          </div>
        )}

        <div className="modal-body" style={{ paddingTop: 0 }}>
          <div className="panel-title" style={{ fontSize: 13.5 }}>
            تاریخچهٔ سفارش‌ها
          </div>

          {error ? (
            <div className="empty" style={{ padding: '34px 20px' }}>
              <div className="empty-ic amber">
                <IconAlert size={26} />
              </div>
              <div className="empty-title">دریافت سفارش‌ها ناموفق بود</div>
              <div className="empty-sub">{error}</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={retry}>
                  <IconRefresh size={15} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : loading ? (
            <div className="order-list">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="order-card" key={i}>
                  <div className="sk sk-line" style={{ width: 180, height: 13 }} />
                  <div className="sk sk-line" style={{ width: '100%', height: 11, marginTop: 12 }} />
                  <div className="sk sk-line" style={{ width: '60%', height: 11, marginTop: 8 }} />
                </div>
              ))}
            </div>
          ) : !result || result.orders.length === 0 ? (
            <div className="empty" style={{ padding: '40px 20px' }}>
              <div className="empty-ic">
                <IconBag size={26} />
              </div>
              <div className="empty-title">سفارشی ثبت نشده است</div>
              <div className="empty-sub">این مشتری هنوز در فروشگاه سفارشی ثبت نکرده است.</div>
            </div>
          ) : (
            <>
              <div className="order-list">
                {result.orders.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}
              </div>
              {result.total > result.orders.length && (
                <div className="f-hint" style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                  {faNum(result.total)} سفارش در فروشگاه وجود دارد و {faNum(result.orders.length)} سفارش اخیر نمایش داده شده است.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function OrderCard({ order }: { order: Order }) {
  const meta = orderStatusMeta(order.status)
  const lineTotal = order.line_items.reduce((a, l) => a + l.quantity, 0)
  const visibleItems = order.line_items.slice(0, 4)
  const hiddenCount = order.line_items.length - visibleItems.length

  return (
    <div className="order-card">
      <div className="order-card-head">
        <span className={'pill ' + meta.cls}>{meta.fa}</span>
        <span className="order-num" dir="ltr">
          #{faDigits(order.number)}
        </span>
        <span className="order-date">{faDate(order.date_created)}</span>
        <span className="order-card-total">{faNum(order.total)}</span>
      </div>

      <ul className="order-items">
        {visibleItems.map((li, i) => (
          <li key={i}>
            <span className="order-item-name">{li.name}</span>
            <span className="order-item-qty">× {faNum(li.quantity)}</span>
            <span className="order-item-total">{faNum(li.total)}</span>
          </li>
        ))}
        {hiddenCount > 0 && <li className="order-more">و {faNum(hiddenCount)} مورد دیگر…</li>}
      </ul>

      <div className="order-card-foot">
        <span className="order-meta">
          {faNum(lineTotal)} {lineTotal === 1 ? 'مورد' : 'مورد'}
          {order.payment_method_title ? ` • ${order.payment_method_title}` : ''}
        </span>
      </div>
    </div>
  )
}
