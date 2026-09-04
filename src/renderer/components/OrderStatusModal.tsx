import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Order } from '../../shared/types'
import { api } from '../api'
import { faDigits, faNum, ORDER_STATUS_META } from '../lib/format'
import { IconAlert, IconCheck, IconRefresh, IconSwap, IconX } from './Icons'

interface Props {
  /** Single order when opened from a row's عملیات column. */
  order?: Order
  /** Orders when opened from the selection bar (bulk change). */
  orderIds?: number[]
  onClose: () => void
  /** Called after a successful change so the parent can refresh the list. */
  onChanged: () => void
}

/** Statuses offered for switching, in a sensible workflow order. */
const STATUS_ORDER = [
  'processing',
  'completed',
  'on-hold',
  'pending-payment',
  'failed',
  'cancelled',
  'refunded',
  'sale-hazouri',
  'foroshgah',
  'kargah',
  'courier-delivery',
  'post-delivery',
  'tipax-delivery',
]

const OPTIONS = STATUS_ORDER.filter((s) => ORDER_STATUS_META[s]).map((s) => ({
  value: s,
  fa: ORDER_STATUS_META[s].fa,
  cls: ORDER_STATUS_META[s].cls,
}))

export default function OrderStatusModal({ order, orderIds, onClose, onChanged }: Props) {
  const ids = order ? [order.id] : (orderIds ?? [])
  const target = order ? { id: order.id, label: '#' + faDigits(order.number) } : null
  const [selected, setSelected] = useState<string>(order?.status ?? '')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const apply = async () => {
    if (!selected || busy || ids.length === 0) return
    setBusy(true)
    setDone(false)
    setProgress({ done: 0, total: ids.length })
    setError(null)
    try {
      for (let i = 0; i < ids.length; i++) {
        await api.updateOrderStatus(ids[i], selected)
        setProgress({ done: i + 1, total: ids.length })
      }
      setDone(true)
      onChanged()
    } catch (e) {
      setError(`خطا پس از ${faNum(progress?.done ?? 0)} به‌روزرسانی: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="تغییر وضعیت سفارش">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconSwap size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">تغییر وضعیت سفارش</div>
              <div className="modal-sub">
                {target
                  ? `سفارش ${target.label} — وضعیت کنونی: ${ORDER_STATUS_META[order!.status]?.fa ?? order!.status}`
                  : `${faNum(ids.length)} سفارش انتخاب‌شده`}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="notice err">
              <IconAlert size={16} />
              <div>{error}</div>
            </div>
          )}
          {done && (
            <div className="notice ok fade-in">
              <IconCheck size={16} />
              <div>
                وضعیت {faNum(ids.length)} سفارش به «{ORDER_STATUS_META[selected]?.fa ?? selected}» تغییر کرد.
              </div>
            </div>
          )}

          <div className="pd-sec">
            <div className="pd-sec-title">وضعیت جدید</div>
            <div className="st-grid">
              {OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={'st-opt' + (selected === o.value ? ' active' : '')}
                  onClick={() => {
                    setSelected(o.value)
                    setError(null)
                  }}
                  disabled={busy}
                >
                  <span className={'pill ' + o.cls}>{o.fa}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="notice amber" style={{ marginTop: 0 }}>
            <IconAlert size={16} />
            <div>
              وضعیت سفارش‌ها مستقیماً در ووکامرس ذخیره می‌شود و نیازمند کلید API با دسترسی «خواندن/نوشتن» است.
            </div>
          </div>

          <div className="pd-actions">
            <span className="pd-note">
              {busy
                ? `در حال به‌روزرسانی ${faNum(progress?.done ?? 0)} از ${faNum(progress?.total ?? 0)}…`
                : done
                  ? 'به‌روزرسانی کامل شد.'
                  : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                بستن
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={apply}
                disabled={busy || !selected || ids.length === 0}
              >
                {busy ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                {busy
                  ? 'در حال اعمال…'
                  : ids.length > 1
                    ? `اعمال روی ${faNum(ids.length)} سفارش`
                    : 'اعمال وضعیت'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
