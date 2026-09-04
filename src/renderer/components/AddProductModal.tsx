import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProductPayload } from '../../shared/types'
import { api } from '../api'
import { toLatin } from '../lib/format'
import { IconAlert, IconCheck, IconPlus, IconRefresh, IconX } from './Icons'

interface Props {
  onClose: () => void
  onCreated: (name: string) => void
}

const STATUS_OPTIONS = [
  { value: 'publish', fa: 'منتشرشده (قابل مشاهده در فروشگاه)' },
  { value: 'private', fa: 'خصوصی' },
  { value: 'draft', fa: 'پیش‌نویس' },
  { value: 'pending', fa: 'در انتظار بررسی' },
]

const FORM_EMPTY = { name: '', type: 'simple', status: 'publish', price: '', sale: '', qty: '' }

export default function AddProductModal({ onClose, onCreated }: Props) {
  const [form, setForm] = useState(FORM_EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const isVariable = form.type === 'variable'

  const set = (key: keyof typeof FORM_EMPTY, value: string) => setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    if (!form.name.trim()) return 'نام محصول را وارد کنید.'
    if (!isVariable) {
      const price = toLatin(form.price)
      if (!price) return 'قیمت محصول را وارد کنید.'
      if (!/^\d+(\.\d+)?$/.test(price)) return 'قالب قیمت معتبر نیست (فقط عدد).'
      if (form.sale.trim()) {
        const sale = toLatin(form.sale)
        if (!/^\d+(\.\d+)?$/.test(sale)) return 'قالب قیمت حراج معتبر نیست (فقط عدد).'
      }
      if (form.qty.trim() && !/^\d+$/.test(toLatin(form.qty))) return 'موجودی باید عدد صحیح باشد.'
    }
    return null
  }

  const handleSubmit = async () => {
    const err = validate()
    setError(err)
    if (err) return

    const price = toLatin(form.price)
    const sale = toLatin(form.sale)
    const qtyRaw = toLatin(form.qty)
    const qty = qtyRaw !== '' ? Number(qtyRaw) : null

    const payload: ProductPayload = {
      name: form.name.trim(),
      type: isVariable ? 'variable' : 'simple',
      status: form.status,
      ...(!isVariable
        ? {
            regular_price: price,
            sale_price: sale || '',
            stock_status: qty !== null ? (qty > 0 ? 'instock' : 'outofstock') : 'instock',
            ...(qty !== null ? { stock_quantity: qty } : {}),
          }
        : {}),
    }

    setBusy(true)
    try {
      await api.createProduct(payload)
      onCreated(form.name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return createPortal(
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
        aria-label="افزودن محصول جدید"
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
              <IconPlus size={18} />
            </div>
            <div>
              <div className="modal-title">افزودن محصول جدید</div>
              <div className="modal-sub">محصول مستقیماً در ووکامرس ثبت می‌شود</div>
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
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label className="lbl" htmlFor="ap-name">
                نام محصول <span className="req">*</span>
              </label>
              <input
                id="ap-name"
                ref={nameRef}
                className="input"
                type="text"
                placeholder="مثلاً کفش راحتی چرم"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="ap-type">
                نوع محصول
              </label>
              <select id="ap-type" className="sel" style={{ width: '100%' }} value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="simple">ساده</option>
                <option value="variable">متغیر (با ترکیبات)</option>
              </select>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="ap-status">
                وضعیت انتشار
              </label>
              <select id="ap-status" className="sel" style={{ width: '100%' }} value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.fa}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isVariable ? (
            <div className="form-sec">قیمت و موجودی</div>
          ) : (
            <div className="notice info">
              <IconAlert size={16} />
              <div>
                برای محصول متغیر، قیمت و موجودی هر ترکیب بعد از ساخت، از دکمهٔ «جزئیات محصول» در همان ردیف تنظیم می‌شود
                (برای هر ترکیب می‌توانید رنگ/سایز و قیمت/موجودی را تعیین کنید).
              </div>
            </div>
          )}

          {!isVariable && (
            <div className="form-grid">
              <div className="field">
                <label className="lbl" htmlFor="ap-price">
                  قیمت (تومان) <span className="req">*</span>
                </label>
                <input
                  id="ap-price"
                  className="input ltr"
                  type="text"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="1500000"
                  value={form.price}
                  onChange={(e) => set('price', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lbl" htmlFor="ap-sale">
                  قیمت حراج (اختیاری)
                </label>
                <input
                  id="ap-sale"
                  className="input ltr"
                  type="text"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder="1200000"
                  value={form.sale}
                  onChange={(e) => set('sale', e.target.value)}
                />
              </div>
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <label className="lbl" htmlFor="ap-qty">
                  موجودی اولیه (عدد)
                </label>
                <input
                  id="ap-qty"
                  className="input ltr"
                  type="text"
                  dir="ltr"
                  inputMode="numeric"
                  placeholder="اگر خالی بماند، مدیریت موجودی خاموش است"
                  value={form.qty}
                  onChange={(e) => set('qty', e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                />
              </div>
            </div>
          )}

          <div className="notice info">
            <IconAlert size={16} />
            <div>
              برای افزودن محصول، کلید API باید دسترسی «خواندن/نوشتن» (Read/Write) داشته باشد. اگر نام محصول تکراری
              باشد، ووکامرس به‌طور خودکار یک شناسهٔ یکتا به اسلاگ اضافه می‌کند.
            </div>
          </div>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={busy}>
            {busy ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
            {busy ? 'در حال ثبت…' : 'افزودن محصول'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
