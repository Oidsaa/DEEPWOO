import { useEffect, useRef, useState } from 'react'
import type { CustomerPayload } from '../../shared/types'
import { api } from '../api'
import { faDigits, phoneDigits } from '../lib/format'
import { IconAlert, IconCheck, IconRefresh, IconUserPlus, IconX } from './Icons'

interface Props {
  onClose: () => void
  onCreated: (customerName: string) => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  state: '',
  city: '',
  address1: '',
  postcode: '',
}

export default function AddCustomerModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstNameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    firstNameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const set = (key: keyof typeof EMPTY_FORM, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    const digits = phoneDigits(form.phone)
    if (!digits) return 'شماره موبایل را وارد کنید.'
    if (digits.length < 10 || digits.length > 15) {
      return 'شماره موبایل معتبر نیست — باید بین ۱۰ تا ۱۵ رقم باشد.'
    }
    const email = form.email.trim()
    if (email && !EMAIL_RE.test(email)) return 'قالب ایمیل معتبر نیست.'
    return null
  }

  const handleSubmit = async () => {
    const err = validate()
    setError(err)
    if (err) return

    const digits = phoneDigits(form.phone)
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    const email = form.email.trim()

    setBusy(true)
    const payload: CustomerPayload = {
      // Username is always the customer's mobile number (digits only).
      username: digits,
      ...(email ? { email } : {}),
      first_name: firstName,
      last_name: lastName,
      billing: {
        first_name: firstName,
        last_name: lastName,
        phone: form.phone.trim(),
        state: form.state.trim(),
        city: form.city.trim(),
        address_1: form.address1.trim(),
        postcode: form.postcode.trim(),
      },
    }
    try {
      await api.createCustomer(payload)
      const name = [firstName, lastName].filter(Boolean).join(' ') || faDigits(digits)
      onCreated(name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="افزودن مشتری جدید"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconUserPlus size={18} />
            </div>
            <div>
              <div className="modal-title">افزودن مشتری جدید</div>
              <div className="modal-sub">اطلاعات مشتری مستقیماً در ووکامرس ثبت می‌شود</div>
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

          <div className="form-grid">
            <div className="field">
              <label className="lbl" htmlFor="ac-first">
                نام
              </label>
              <input
                id="ac-first"
                ref={firstNameRef}
                className="input"
                type="text"
                placeholder="مثلاً علی"
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="ac-last">
                نام خانوادگی
              </label>
              <input
                id="ac-last"
                className="input"
                type="text"
                placeholder="مثلاً محمدی"
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label className="lbl" htmlFor="ac-phone">
                شماره موبایل <span className="req">*</span>
              </label>
              <input
                id="ac-phone"
                className="input ltr"
                type="tel"
                dir="ltr"
                autoComplete="off"
                placeholder="0912 345 6789"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
              <span className="f-hint">
                نام کاربری مشتری در ووکامرس، همین شماره موبایل خواهد بود. نمونه: {faDigits('0912 345 6789')}
              </span>
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label className="lbl" htmlFor="ac-email">
                ایمیل
              </label>
              <input
                id="ac-email"
                className="input ltr"
                type="email"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                placeholder="customer@example.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
              <span className="f-hint">اگر خالی بماند، حساب فقط با نام کاربری (موبایل) ساخته می‌شود.</span>
            </div>
          </div>

          <div className="form-sec">آدرس</div>

          <div className="form-grid">
            <div className="field">
              <label className="lbl" htmlFor="ac-state">
                استان
              </label>
              <input
                id="ac-state"
                className="input"
                type="text"
                placeholder="مثلاً تهران"
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="ac-city">
                شهر
              </label>
              <input
                id="ac-city"
                className="input"
                type="text"
                placeholder="مثلاً تهران"
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label className="lbl" htmlFor="ac-address">
                ادامهٔ آدرس
              </label>
              <input
                id="ac-address"
                className="input"
                type="text"
                placeholder="خیابان، کوچه، پلاک…"
                value={form.address1}
                onChange={(e) => set('address1', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lbl" htmlFor="ac-postcode">
                کدپستی
              </label>
              <input
                id="ac-postcode"
                className="input ltr"
                type="text"
                dir="ltr"
                autoComplete="off"
                inputMode="numeric"
                placeholder="1234567890"
                value={form.postcode}
                onChange={(e) => set('postcode', e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
          </div>

          <div className="notice info">
            <IconAlert size={16} />
            <div>
              برای افزودن مشتری، کلید API باید دسترسی «خواندن/نوشتن» (Read/Write) داشته باشد. اگر ایمیل تکراری باشد
              یا این شمارهٔ موبایل قبلاً به‌عنوان نام کاربری ثبت شده باشد، ووکامرس از ثبت مشتری جلوگیری می‌کند.
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
            {busy ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
            {busy ? 'در حال ثبت…' : 'افزودن مشتری'}
          </button>
        </div>
      </div>
    </div>
  )
}
