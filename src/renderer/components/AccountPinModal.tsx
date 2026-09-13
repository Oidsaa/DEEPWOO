import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconAlert, IconShield, IconX } from './Icons'

export type AccountPinMode = 'enter' | 'set' | 'change'

export interface AccountPinTarget {
  id: string
  label: string
  hasPin: boolean
}

export interface AccountPinSubmit {
  /** در حالت change — رمز فعلی؛ در بقیه حالت‌ها خالی. */
  current?: string
  pin: string
}

interface Props {
  target: AccountPinTarget
  mode: AccountPinMode
  busy: boolean
  error: string | null
  onSubmit: (payload: AccountPinSubmit) => void
  onClose: () => void
}

const TITLES: Record<AccountPinMode, string> = {
  enter: 'ورود به اکانت',
  set: 'تعیین رمز شخصی',
  change: 'تغییر رمز شخصی',
}

/**
 * رمز شخصی اکانت کارشناس — سه حالت:
 *  enter: اکانت رمز دارد؛ برای سوئیچ باید رمز را وارد کند.
 *  set:   اکانت رمز ندارد؛ اولین ورود = تعیین رمز (دو بار).
 *  change: تغییر رمز اکانتِ فعال (رمز فعلی + رمز جدید دو بار).
 */
export default function AccountPinModal({ target, mode, busy, error, onSubmit, onClose }: Props) {
  const [current, setCurrent] = useState('')
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const submit = () => {
    if (busy) return
    if (pin.trim().length < 4) return onSubmit({ current: current.trim(), pin: pin.trim() })
    // اعتبار حداقل طول در main چک می‌شود — فقط تناظر تکرار اینجا.
    if ((mode === 'set' || mode === 'change') && pin.trim() !== confirm.trim()) return
    onSubmit({ current: mode === 'change' ? current.trim() : undefined, pin: pin.trim() })
  }

  const confirmMismatch = (mode === 'set' || mode === 'change') && confirm.length > 0 && confirm !== pin

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <form
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-label={TITLES[mode]}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconShield size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">{TITLES[mode]}</div>
              <div className="modal-sub">
                اکانت «{target.label}» — {mode === 'change' ? 'رمز فعلی و رمز جدید را وارد کنید' : 'رمز شخصی این کارشناس'}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          {mode === 'enter' && (
            <div className="field">
              <label className="lbl" htmlFor="pin-cur">
                رمز شخصی
              </label>
              <input
                id="pin-cur"
                ref={firstRef}
                className="input ltr"
                type="password"
                dir="ltr"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                disabled={busy}
                placeholder="••••"
              />
            </div>
          )}

          {mode === 'change' && (
            <div className="field">
              <label className="lbl" htmlFor="pin-old">
                رمز فعلی
              </label>
              <input
                id="pin-old"
                ref={firstRef}
                className="input ltr"
                type="password"
                dir="ltr"
                autoComplete="off"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                disabled={busy || !target.hasPin}
                placeholder={target.hasPin ? '••••' : 'رمزی تعیین نشده بود'}
              />
            </div>
          )}

          {mode !== 'enter' && (
            <div className="field">
              <label className="lbl" htmlFor="pin-new">
                رمز جدید
              </label>
              <input
                id="pin-new"
                ref={mode !== 'change' ? firstRef : undefined}
                className="input ltr"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                disabled={busy}
                placeholder="حداقل ۴ کاراکتر"
              />
            </div>
          )}

          {mode !== 'enter' && (
            <div className="field">
              <label className="lbl" htmlFor="pin-confirm">
                تکرار رمز جدید
              </label>
              <input
                id="pin-confirm"
                className="input ltr"
                type="password"
                dir="ltr"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
                style={confirmMismatch ? { borderColor: 'var(--red, #ef4444)' } : undefined}
              />
              {confirmMismatch && (
                <span className="f-hint" style={{ color: 'var(--red, #ef4444)' }}>
                  تکرار با رمز جدید یکسان نیست.
                </span>
              )}
            </div>
          )}

          {error && (
            <div className="notice err" style={{ marginTop: 0 }}>
              <IconAlert size={15} />
              <div>{error}</div>
            </div>
          )}

          <div className="pd-actions" style={{ marginTop: 0 }}>
            <span className="pd-note">
              {mode === 'set'
                ? 'از این پس ورود به این اکانت فقط با همین رمز ممکن است.'
                : mode === 'enter'
                  ? 'این رمز را صاحب اکانت تعیین کرده است.'
                  : 'تغییر رمز فعلی فقط با دانستن رمز قبلی ممکن است.'}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                انصراف
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                <IconShield size={15} />
                {busy ? 'در حال بررسی…' : mode === 'enter' ? 'ورود' : mode === 'set' ? 'تعیین رمز و ورود' : 'ذخیرهٔ رمز'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  )

  return createPortal(modal, document.body)
}
