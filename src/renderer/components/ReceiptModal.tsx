import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Order, OrderNote, ReceiptType } from '../../shared/types'
import { api, isMock } from '../api'
import { faDate, faDigits, faNum, faTime } from '../lib/format'
import { buildReceiptDoc, RECEIPT_KINDS, type ReceiptDoc, type ReceiptShop } from '../lib/print'
import { IconAlert, IconBag, IconCheck, IconPrint, IconX } from './Icons'

const PX_MM = 96 / 25.4

interface Props {
  order: Order
  initialType?: ReceiptType
  onClose: () => void
}

export default function ReceiptModal({ order, initialType = 'store', onClose }: Props) {
  const [type, setType] = useState<ReceiptType>(initialType)
  const [shop, setShop] = useState<ReceiptShop>({ name: '', domain: '' })
  const [notes, setNotes] = useState<OrderNote[]>([])
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  // Shop label for the receipt header (from the configured site URL + settings).
  useEffect(() => {
    let cancelled = false
    api
      .getSettings()
      .then((s) => {
        if (cancelled) return
        let host = ''
        try {
          host = new URL(s.siteUrl || '').hostname.replace(/^www\./, '')
        } catch {
          host = ''
        }
        const fallback = isMock ? 'فروشگاه آزمایشی' : ''
        setShop({
          name: s.storeName || host || fallback,
          domain: host,
          address: s.storeAddress,
          postcode: s.storePostcode,
          phone: s.storePhone,
          logo: s.storeLogo,
        })
      })
      .catch(() => {
        if (!cancelled) setShop({ name: '', domain: '' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Order notes back the warehouse receipt's note sections (demo + real).
  useEffect(() => {
    let cancelled = false
    api
      .listOrderNotes(order.id)
      .then((n) => {
        if (!cancelled) setNotes(n)
      })
      .catch(() => {
        if (!cancelled) setNotes([])
      })
    return () => {
      cancelled = true
    }
  }, [order.id])

  // Measure the preview stage so the mm-true sheet scales to fit.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const doc: ReceiptDoc = useMemo(() => buildReceiptDoc(order, type, shop, notes), [order, type, shop, notes])

  const natW = doc.widthMm * PX_MM
  const natH = doc.heightMm * PX_MM
  const scale = stage.w > 0 ? Math.min(1, stage.w / natW, stage.h / natH) : 0.2

  const print = async () => {
    if (busy) return
    setBusy(true)
    setDone(false)
    setError(null)
    try {
      const res = await api.printReceipt({ type: doc.type, widthMm: doc.widthMm, landscape: doc.landscape, html: doc.html })
      if (res.ok) setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const kind = RECEIPT_KINDS.find((k) => k.type === type)!

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-xl rc-modal" role="dialog" aria-modal="true" aria-label="چاپ رسید">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconPrint size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">چاپ رسید</div>
              <div className="modal-sub">
                سفارش <span dir="ltr">#{faDigits(order.number)}</span> — {faDate(order.date_created)} —{' '}
                {faTime(new Date(order.date_created))}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="rc-types">
            {RECEIPT_KINDS.map((k) => (
              <button
                key={k.type}
                type="button"
                className={'rc-type' + (type === k.type ? ' active' : '')}
                onClick={() => {
                  setType(k.type)
                  setDone(false)
                  setError(null)
                }}
                disabled={busy}
              >
                <b>{k.fa}</b>
                <span>{k.sub}</span>
              </button>
            ))}
          </div>

          <div className="rc-note">
            <IconBag size={14} />
            <span>
              {kind.fa} — {kind.widthMm === 80 ? 'عرض ۸ سانتی‌متر (ارتفاع آزاد)' : `${doc.widthMm} × ${doc.heightMm} میلی‌متر`}{' '}
              {doc.heightMm > 42 && type === 'warehouse'
                ? `(به‌دلیل ${faNum(doc.itemCount)} اقلام و یادداشت‌ها، ارتفاع از ۴۲ میلی‌متر بیشتر شده)`
                : ''}
            </span>
          </div>

          <div className="rc-stage" ref={stageRef}>
            {stage.w === 0 ? null : (
              <div
                style={{
                  width: natW * scale,
                  height: natH * scale,
                  position: 'relative',
                  boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: natW,
                    height: natH,
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                  }}
                >
                  <iframe
                    title={`پیش‌نمایش ${kind.fa}`}
                    srcDoc={doc.html}
                    style={{ width: natW, height: natH, border: 'none', display: 'block' }}
                    sandbox="allow-same-origin"
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="notice err">
              <IconAlert size={15} />
              <div>{error}</div>
            </div>
          )}
          {done && (
            <div className="notice ok fade-in">
              <IconCheck size={15} />
              <div>درخواست چاپ به سیستم ارسال شد — در پنجرهٔ چاپ، چاپگر رسید را انتخاب کنید.</div>
            </div>
          )}

          {isMock && (
            <div className="notice amber" style={{ marginTop: 0 }}>
              <IconAlert size={15} />
              <div>
                این پیش‌نمایش فقط دادهٔ آزمایشی است؛ چاپ واقعی در نسخهٔ دسکتاپ برنامه و بعد از اتصال به فروشگاه
                در دسترس است. برای تنظیم اندازهٔ کاغذ، در پنجرهٔ چاپ اندازهٔ منطبق با رسید را انتخاب کنید.
              </div>
            </div>
          )}

          <div className="pd-actions">
            <span className="pd-note">ابعاد کاغذ: {faNum(doc.widthMm)} × {faNum(doc.heightMm)} میلی‌متر</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                بستن
              </button>
              <button type="button" className="btn btn-primary" onClick={print} disabled={busy || isMock}>
                <IconPrint size={15} />
                {busy ? 'در حال ارسال…' : 'چاپ رسید'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
