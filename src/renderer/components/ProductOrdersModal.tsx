import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Order, Product, ProductOrdersResult } from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum, orderStatusMeta } from '../lib/format'
import { IconAlert, IconBag, IconBox, IconRefresh, IconX } from './Icons'

interface Props {
  product: Product
  onClose: () => void
}


/** Line items of an order that belong to the product under review. */
const linesOf = (order: Order, productId: number) =>
  order.line_items.filter((l) => (l.product_id ?? productId) === productId)

export default function ProductOrdersModal({ product, onClose }: Props) {
  const [result, setResult] = useState<ProductOrdersResult | null>(null)
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
      .listProductOrders(product.id)
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
  }, [product.id, loadCount])

  /** Units sold per sold combination (label = line name), for the breakdown chips. */
  const breakdown = useMemo(() => {
    if (!result) return []
    const groups = new Map<string, number>()
    for (const order of result.orders) {
      for (const line of linesOf(order, product.id)) {
        const label = line.name.trim() || '—'
        groups.set(label, (groups.get(label) ?? 0) + (Number(line.quantity) || 0))
      }
    }
    return [...groups.entries()]
      .map(([label, qty]) => ({ label, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 12)
  }, [result, product.id])

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`سفارش‌های محصول ${product.name}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconBag size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                سفارش‌های محصول
              </div>
              <div className="modal-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {product.name}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>

        <div className="order-summary">
          <div className="order-summary-item">
            <span className="stat-label">تعداد سفارش‌ها</span>
            <span className="order-summary-val">{result ? faNum(result.total) : '—'}</span>
          </div>
          <div className="order-summary-item">
            <span className="stat-label">عدد فروخته‌شده</span>
            <span className="order-summary-val">{result ? faNum(result.unitsSold) : '—'}</span>
          </div>
          <div className="order-summary-item">
            <span className="stat-label">مجموع فروش</span>
            <span
              className="order-summary-val"
              title="مجموع مبلغ سفارش‌ها با هر وضعیتی به‌جز ناموفق، لغو شده و بازپرداخت‌شده"
            >
              {result ? faNum(result.revenueSum) : '—'}
            </span>
          </div>
          <div className="order-summary-item order-summary-sub">
            <span className="stat-label">نوع</span>
            <span className="order-summary-val" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)' }}>
              {product.type === 'variable' ? 'متغیر (شامل ترکیبات)' : product.type === 'simple' ? 'ساده' : product.type}
            </span>
          </div>
        </div>

        <div className="modal-body" style={{ paddingTop: 0 }}>
          {error ? (
            <div className="empty" style={{ padding: '34px 20px' }}>
              <div className="empty-ic amber">
                <IconAlert size={26} />
              </div>
              <div className="empty-title">دریافت سفارش‌ها ناموفق بود</div>
              <div className="empty-sub">{error}</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
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
                </div>
              ))}
            </div>
          ) : !result || result.orders.length === 0 ? (
            <div className="empty" style={{ padding: '40px 20px' }}>
              <div className="empty-ic">
                <IconBox size={26} />
              </div>
              <div className="empty-title">سفارشی برای این محصول ثبت نشده است</div>
              <div className="empty-sub">
                هنوز هیچ سفارشی شامل این محصول{product.type === 'variable' ? ' یا ترکیبات آن' : ''} در فروشگاه ثبت نشده
                است.
              </div>
            </div>
          ) : (
            <>
              {product.type === 'variable' && breakdown.length > 0 && (
                <div>
                  <div className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>
                    ترکیبات به‌فروش‌رسیده
                  </div>
                  <div className="bd-row">
                    {breakdown.map((b) => (
                      <span className="bd-chip" key={b.label}>
                        {b.label}
                        <b>{faNum(b.qty)} عدد</b>
                      </span>
                    ))}
                    {breakdown.length === 12 && result.unitsSold > 0 && (
                      <span className="bd-more">و ترکیب‌های دیگر…</span>
                    )}
                  </div>
                </div>
              )}

              <div>
                <div className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>
                  فهرست سفارش‌ها
                </div>
                <div className="order-list">
                  {result.orders.map((order) => (
                    <ProductOrderCard key={order.id} order={order} productId={product.id} />
                  ))}
                </div>
              </div>

              {result.excluded > 0 && (
                <div className="f-hint" style={{ textAlign: 'center', padding: '6px 0 2px' }}>
                  {faNum(result.excluded)} سفارش با وضعیت ناموفق، لغو شده یا بازپرداخت‌شده در نظر گرفته نشده است.
                </div>
              )}

              {result.truncated && (
                <div className="f-hint" style={{ textAlign: 'center', padding: '2px 0 2px' }}>
                  سفارش‌های قدیمی‌تری هم برای این محصول در فروشگاه ثبت شده که به دلیل محدودیت بررسی نشده‌اند (حداکثر{' '}
                  {faNum(2000)} سفارش).
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

function ProductOrderCard({ order, productId }: { order: Order; productId: number }) {
  const meta = orderStatusMeta(order.status)
  const lines = linesOf(order, productId)
  const lineTotal = lines.reduce((a, l) => a + l.quantity, 0)
  const totalLines = order.line_items.reduce((a, l) => a + l.quantity, 0)

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
        {lines.map((li, i) => (
          <li key={i}>
            <span className="order-item-name">{li.name}</span>
            <span className="order-item-qty">× {faNum(li.quantity)}</span>
            <span className="order-item-total">{faNum(li.total)}</span>
          </li>
        ))}
      </ul>

      <div className="order-card-foot">
        <span className="order-meta">
          {faNum(lineTotal)} از {faNum(totalLines)} مورد این سفارش
          {order.payment_method_title ? ` • ${order.payment_method_title}` : ''}
          {order.billing?.first_name || order.billing?.last_name
            ? ` • ${[order.billing.first_name, order.billing.last_name].filter(Boolean).join(' ')}`
            : ''}
        </span>
      </div>
    </div>
  )
}
