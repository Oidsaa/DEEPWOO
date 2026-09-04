import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { FormEvent } from 'react'
import type { Order, OrderNote } from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum, faTime, orderStatusMeta } from '../lib/format'
import { IconAlert, IconBag, IconNote, IconRefresh, IconX } from './Icons'

interface Props {
  order: Order
  onClose: () => void
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Human label for a shipping/coupon line when its total is zero. */
const amount = (v?: string | number | null): string => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? faNum(n) : '—'
}

/** Kind of an order note for display purposes. */
function noteKind(n: OrderNote): { fa: string; cls: string } {
  if (n.customer_note) return { fa: 'مشتری', cls: 'pill-teal' }
  if (n.added_by_user) return { fa: 'خصوصی', cls: 'pill-amber' }
  return { fa: 'سیستم', cls: 'pill-dim' }
}

export default function OrderDetailModal({ order, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const meta = orderStatusMeta(order.status)
  const items = order.line_items
  const itemsTotal = round2(items.reduce((a, l) => a + (Number(l.total) || 0), 0))
  const discount = Number(order.discount_total) || 0
  const shipping = Number(order.shipping_total) || 0
  const dt = new Date(order.date_created)
  const bill = order.billing ?? {}
  const ship = order.shipping
  // Show the delivery address only when it differs from the billing one.
  const addr = ship && JSON.stringify(ship) !== JSON.stringify({
    first_name: bill.first_name, last_name: bill.last_name, address_1: bill.address_1,
    address_2: bill.address_2, city: bill.city, state: bill.state, postcode: bill.postcode, country: bill.country,
  }) ? ship : bill

  const name =
    order.customer_name || [bill.first_name, bill.last_name].filter(Boolean).join(' ').trim() || `مشتری #${order.customer_id || '?'}`
  const unitOf = (l: (typeof items)[number]): string => {
    if (l.price !== undefined && l.price !== '') return faNum(l.price)
    const q = Number(l.quantity) || 0
    return q > 0 ? faNum(round2((Number(l.total) || 0) / q)) : '—'
  }

  /* ------------------------- order notes ------------------------- */
  const [notes, setNotes] = useState<OrderNote[] | null>(null)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')
  const [noteAsCustomer, setNoteAsCustomer] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setNotes(null)
    setNotesError(null)
    api
      .listOrderNotes(order.id)
      .then((list) => {
        if (!cancelled) setNotes(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setNotesError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [order.id])

  const submitNote = async (e: FormEvent) => {
    e.preventDefault()
    const text = noteText.trim()
    if (!text || adding) return
    setAdding(true)
    setAddError(null)
    try {
      const created = await api.createOrderNote(order.id, {
        note: text,
        customer_note: noteAsCustomer || undefined,
      })
      setNotes((prev) => [created, ...(prev ?? [])])
      setNoteText('')
      setNoteAsCustomer(false)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    } finally {
      setAdding(false)
    }
  }

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`جزئیات سفارش ${order.number}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconBag size={19} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                  #{faDigits(order.number)}
                </span>
                <span className={'pill ' + meta.cls}>{meta.fa}</span>
              </div>
              <div className="modal-sub">
                {faDate(order.date_created)} — {faTime(dt)}
                {order.payment_method_title ? ` • ${order.payment_method_title}` : ''}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="order-summary">
            <div className="order-summary-item">
              <span className="stat-label">مجموع اقلام سفارش</span>
              <span className="order-summary-val">{itemsTotal > 0 ? faNum(itemsTotal) : '—'}</span>
            </div>
            {discount > 0 && (
              <div className="order-summary-item">
                <span className="stat-label">تخفیف</span>
                <span className="order-summary-val od-discount">{faNum(discount)}</span>
              </div>
            )}
            {shipping > 0 && (
              <div className="order-summary-item">
                <span className="stat-label">هزینهٔ ارسال</span>
                <span className="order-summary-val">{faNum(shipping)}</span>
              </div>
            )}
            <div className="order-summary-item">
              <span className="stat-label">مبلغ نهایی سفارش</span>
              <span className="order-summary-val od-total">{faNum(order.total)}</span>
            </div>
          </div>

          <div className="pd-sec">
            <div className="pd-sec-title">
              اقلام سفارش
              <span className="pd-count">{faNum(items.length)} مورد</span>
            </div>
            {items.length === 0 ? (
              <div className="pd-empty">اقلامی برای این سفارش ثبت نشده است.</div>
            ) : (
              <div className="od-items">
                {items.map((l, i) => (
                  <div className="od-item" key={i}>
                    <div className="od-item-main">
                      <div className="od-item-name">{l.name || '—'}</div>
                      <div className="od-item-unit">
                        {faNum(l.quantity)} عدد × {unitOf(l)}
                      </div>
                      {(l.meta_data ?? []).length > 0 && (
                        <div className="od-item-meta">
                          {l.meta_data!.filter((m) => !String(m.key ?? '').startsWith('_')).map((m, j) => (
                            <span key={j} className="meta-chip">
                              {m.display_key || m.key}: {m.display_value || m.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="od-item-total">{faNum(l.total)}</div>
                  </div>
                ))}
                {(order.coupon_lines ?? []).length > 0 && (
                  <div className="od-item od-item-side">
                    <div className="od-item-main">
                      <div className="od-item-name">کد تخفیف</div>
                      {order.coupon_lines!.map((c, i) => (
                        <div className="od-item-unit" key={i} dir="ltr" style={{ textAlign: 'right' }}>
                          {c.code}
                        </div>
                      ))}
                    </div>
                    <div className="od-item-total od-discount">−{faNum(order.coupon_lines!.reduce((a, c) => a + (Number(c.discount) || 0), 0))}</div>
                  </div>
                )}
                {(order.shipping_lines ?? []).length > 0 && (
                  <div className="od-item od-item-side">
                    <div className="od-item-main">
                      <div className="od-item-name">حمل و نقل</div>
                      <div className="od-item-unit">
                        {order.shipping_lines!.map((s) => s.method_title).filter(Boolean).join('، ') || '—'}
                      </div>
                    </div>
                    <div className="od-item-total">
                      {shipping > 0 ? amount(order.shipping_lines!.map((s) => s.total).find((t) => Number(t) > 0)) : 'رایگان'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pd-sec">
            <div className="pd-sec-title">مشتری</div>
            <div className="pd-meta">
              <div className="pd-meta-item">
                <span className="stat-label">نام</span>
                <span className="pd-meta-val">{name}</span>
              </div>
              <div className="pd-meta-item">
                <span className="stat-label">موبایل</span>
                <span className="pd-meta-val" dir="ltr" style={{ textAlign: 'right' }}>
                  {bill.phone ? faDigits(bill.phone) : '—'}
                </span>
              </div>
              <div className="pd-meta-item">
                <span className="stat-label">ایمیل</span>
                <span className="pd-meta-val" dir="ltr" style={{ textAlign: 'right' }}>
                  {bill.email || '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="pd-sec">
            <div className="pd-sec-title">{ship && addr === ship ? 'آدرس تحویل' : 'آدرس'}</div>
            {addr && (addr.address_1 || addr.city || addr.state || addr.postcode) ? (
              <div className="od-addr">
                <div>
                  {addr.address_1 || '—'}
                  {addr.address_2 ? `، ${addr.address_2}` : ''}
                </div>
                <div className="od-addr-sub">
                  {[addr.state, addr.city].filter(Boolean).join('، ') || '—'}
                  {addr.postcode ? ` — کدپستی ${faDigits(addr.postcode)}` : ''}
                </div>
              </div>
            ) : (
              <div className="pd-empty">آدرسی برای این سفارش ثبت نشده است.</div>
            )}
          </div>

          <div className="pd-sec">
            <div className="pd-sec-title">
              <IconNote size={14} />
              یادداشت‌های سفارش
              {notes ? <span className="pd-count">{faNum(notes.length)} یادداشت</span> : null}
            </div>

            {notesError ? (
              <div className="notice err" style={{ marginTop: 2 }}>
                <IconAlert size={15} />
                <div style={{ flex: 1 }}>{notesError}</div>
              </div>
            ) : notes === null ? (
              <div className="od-notes-skel">
                <div className="sk sk-line" style={{ height: 46, width: '100%' }} />
                <div className="sk sk-line" style={{ height: 46, width: '86%' }} />
              </div>
            ) : notes.length === 0 ? (
              <div className="pd-empty">هنوز یادداشتی برای این سفارش ثبت نشده است.</div>
            ) : (
              <div className="od-notes">
                {notes.map((n) => {
                  const kind = noteKind(n)
                  return (
                    <div className="od-note-item" key={n.id}>
                      <div className="od-note-head">
                        <b>{n.author || '—'}</b>
                        <span className="od-note-date">
                          {faDate(n.date_created)} — {faTime(new Date(n.date_created))}
                        </span>
                        <span className={'pill ' + kind.cls} style={{ padding: '1px 8px', fontSize: 10 }}>
                          {kind.fa}
                        </span>
                      </div>
                      <div className="od-note-body">{n.note}</div>
                    </div>
                  )
                })}
              </div>
            )}

            <form className="od-note-add" onSubmit={submitNote}>
              <textarea
                className="input"
                rows={2}
                placeholder="متن یادداشت جدید… (برای خودتان یا برای مشتری)"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                disabled={adding}
              />
              <div className="od-note-add-row">
                <label className="chk-inline">
                  <input
                    type="checkbox"
                    checked={noteAsCustomer}
                    onChange={(e) => setNoteAsCustomer(e.target.checked)}
                    disabled={adding}
                  />
                  <span>یادداشت برای مشتری (ارسال در ایمیل)</span>
                </label>
                <button type="submit" className="btn btn-sm btn-primary" disabled={adding || !noteText.trim()}>
                  {adding ? <IconRefresh size={14} className="spin" /> : <IconNote size={14} />}
                  {adding ? 'در حال ثبت…' : 'ثبت یادداشت'}
                </button>
              </div>
              {addError && (
                <div className="notice err">
                  <IconAlert size={15} />
                  <div>{addError}</div>
                </div>
              )}
            </form>
          </div>

          {order.date_modified ? (
            <div className="f-hint" style={{ padding: '2px 4px 0', fontSize: 11 }}>
              آخرین به‌روزرسانی: {faDate(order.date_modified)} — {faTime(new Date(order.date_modified))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
