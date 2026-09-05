import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, isMock } from '../api'
import { faNum } from '../lib/format'
import { RECEIPT_KINDS, type BulkReceiptDoc } from '../lib/print'
import { IconAlert, IconBag, IconCheck, IconPrint, IconX } from './Icons'

const PX_MM = 96 / 25.4

interface Props {
  doc: BulkReceiptDoc
  onClose: () => void
}

/**
 * پیش‌نمایش چاپ گروهی — the full multi-order document (roll / stacked A4
 * sheets) rendered true-to-scale in an iframe. Printing happens ONLY when
 * the user presses «چاپ گروهی»; nothing is sent automatically.
 */
export default function BulkPrintModal({ doc, onClose }: Props) {
  const kind = RECEIPT_KINDS.find((k) => k.type === doc.type)!
  const [stage, setStage] = useState({ w: 0, h: 0 })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)

  // True-to-scale fit of the whole document inside the preview stage.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const natW = doc.widthMm * PX_MM
  const natH = doc.heightMm * PX_MM
  // Small documents fit at 1:1; big ones scale down to the stage.
  const scale = stage.w > 0 ? Math.min(1, stage.w / natW, stage.h / natH) : 0.2

  const print = async () => {
    if (busy || isMock) return
    setBusy(true)
    setDone(false)
    setError(null)
    try {
      const res = await api.printBulk({
        type: doc.type,
        widthMm: doc.widthMm,
        heightMm: doc.heightMm,
        landscape: doc.landscape,
        html: doc.html,
      })
      if (res.ok) setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pagesLabel = useMemo(
    () => (doc.type === 'store' ? `${faNum(doc.pages)} رسید پشت سر هم` : `${faNum(doc.pages)} برگهٔ A4`),
    [doc],
  )

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-xl rc-modal" role="dialog" aria-modal="true" aria-label="چاپ گروهی">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconPrint size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">پیش‌نمایش چاپ گروهی — {kind.fa}</div>
              <div className="modal-sub">
                {faNum(doc.count)} سفارش — {pagesLabel}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          <div className="rc-note">
            <IconBag size={14} />
            <span>
              {kind.fa} —{' '}
              {doc.type === 'store'
                ? 'عرض ۸ سانتی‌متر (ارتفاع آزاد، برش پشت سر هم)'
                : `${doc.widthMm} × ${doc.heightMm} میلی‌متر`}{' '}
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
                  background: '#fff',
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
                    title={`پیش‌نمایش ${kind.fa} گروهی`}
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
              <div>درخواست چاپ گروهی به سیستم ارسال شد — در پنجرهٔ چاپ، اندازهٔ کاغذ را انتخاب کنید.</div>
            </div>
          )}

          {isMock && (
            <div className="notice amber" style={{ marginTop: 0 }}>
              <IconAlert size={15} />
              <div>
                این پیش‌نمایش با دادهٔ آزمایشی ساخته شده است؛ چاپ واقعی در نسخهٔ دسکتاپ و پس از اتصال به فروشگاه در
                دسترس است.
              </div>
            </div>
          )}

          <div className="pd-actions">
            <span className="pd-note">
              ابعاد کاغذ: {faNum(doc.widthMm)} × {faNum(doc.heightMm)} میلی‌متر
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                بستن
              </button>
              <button type="button" className="btn btn-primary" onClick={print} disabled={busy || isMock}>
                <IconPrint size={15} />
                {busy ? 'در حال ارسال…' : 'چاپ گروهی'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
