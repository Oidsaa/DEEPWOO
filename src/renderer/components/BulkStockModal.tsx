import { useEffect, useMemo, useState } from 'react'
import type { Product, ProductDetail, ProductPatch, VariationPatch } from '../../shared/types'
import { api } from '../api'
import { faNum, toLatin } from '../lib/format'
import { IconAlert, IconCheck, IconLayers, IconRefresh, IconX } from './Icons'

interface Props {
  product: Product
  onClose: () => void
  /** Called after a successful bulk update so the parent can refresh the list. */
  onChanged: () => void
}

const STOCK_STATUSES = [
  { value: 'instock', fa: 'موجود' },
  { value: 'outofstock', fa: 'ناموجود' },
  { value: 'onbackorder', fa: 'در انتظار تأمین' },
]

export default function BulkStockModal({ product, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const [qty, setQty] = useState('')
  const [stockStatus, setStockStatus] = useState('instock')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setFormError(null)
    api
      .getProductDetail(product.id)
      .then((d) => {
        if (!cancelled) setDetail(d)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [product.id, loadCount])

  const isVariable = !!detail && detail.product.type === 'variable'

  /** Every variation (or the product itself) — the change applies to all of them. */
  const targets = useMemo(() => {
    if (!detail) return []
    return isVariable ? detail.variations : [detail.product]
  }, [detail, isVariable])

  /** Variations (or the simple product) that do NOT manage stock yet — they get it enabled. */
  const toEnable = useMemo(() => {
    if (!detail) return 0
    return isVariable
      ? detail.variations.filter((v) => !v.manage_stock).length
      : detail.product.manage_stock
        ? 0
        : 1
  }, [detail, isVariable])

  const totalTargets = targets.length

  const validate = (): string | null => {
    if (totalTargets === 0) return null
    const v = toLatin(qty)
    if (v === '') return 'موجودی را وارد کنید.'
    if (!/^\d+$/.test(v)) return 'موجودی باید عدد صحیح باشد.'
    return null
  }

  const apply = async () => {
    if (!detail) return
    const err = validate()
    setFormError(err)
    if (err || totalTargets === 0) return

    const qtyN = Number(toLatin(qty))
    setBusy(true)
    setDone(false)
    setProgress({ done: 0, total: totalTargets })
    try {
      let i = 0
      if (isVariable) {
        for (const v of detail.variations) {
          // Every variation gets the quantity; stock management is enabled
          // automatically on variations that did not have it.
          const patch: VariationPatch = { stock_quantity: qtyN, stock_status: stockStatus }
          if (!v.manage_stock) patch.manage_stock = true
          await api.updateProductVariation(product.id, v.id, patch)
          i += 1
          setProgress({ done: i, total: totalTargets })
        }
      } else {
        const patch: ProductPatch = { stock_quantity: qtyN, stock_status: stockStatus }
        if (!detail.product.manage_stock) patch.manage_stock = true
        await api.updateProduct(product.id, patch)
        setProgress({ done: 1, total: 1 })
      }
      setDone(true)
      onChanged()
    } catch (e) {
      setFormError(
        `خطا پس از ${faNum(progress?.done ?? 0)} به‌روزرسانی: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
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
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`تغییر کلی موجودی ${product.name}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconLayers size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">تغییر کلی موجودی</div>
              <div className="modal-sub" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {product.name}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          {loadError ? (
            <div className="empty" style={{ padding: '36px 20px' }}>
              <div className="empty-ic amber">
                <IconAlert size={26} />
              </div>
              <div className="empty-title">دریافت جزئیات محصول ناموفق بود</div>
              <div className="empty-sub">{loadError}</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
                  <IconRefresh size={15} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : loading || !detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="sk sk-line" style={{ height: 56, width: '100%' }} />
              <div className="sk sk-line" style={{ height: 120, width: '100%' }} />
            </div>
          ) : (
            <>
              {formError && (
                <div className="notice err">
                  <IconAlert size={16} />
                  <div>{formError}</div>
                </div>
              )}

              {done && (
                <div className="notice ok fade-in">
                  <IconCheck size={16} />
                  <div>
                    موجودی {faNum(totalTargets)} {isVariable ? 'ترکیب' : 'محصول'} به‌روزرسانی شد.
                  </div>
                </div>
              )}

              {totalTargets === 0 ? (
                <div className="empty" style={{ padding: '30px 20px' }}>
                  <div className="empty-ic">
                    <IconLayers size={24} />
                  </div>
                  <div className="empty-title">ترکیبی برای به‌روزرسانی وجود ندارد</div>
                  <div className="empty-sub">
                    {isVariable ? 'این محصول متغیر هنوز هیچ ترکیبی ندارد.' : 'محصولی برای به‌روزرسانی وجود ندارد.'}
                  </div>
                </div>
              ) : (
                <>
                  <div className="notice info">
                    <IconAlert size={16} />
                    <div>
                      این مقدار روی <b>همهٔ {faNum(totalTargets)} {isVariable ? 'ترکیب' : 'محصول'}</b> اعمال می‌شود
                      {isVariable ? ' (شامل هر رنگ و سایز)' : ''}.
                      {toEnable > 0 &&
                        (isVariable
                          ? ` مدیریت موجودیِ ${faNum(toEnable)} ترکیب بدون مدیریت، به‌صورت خودکار فعال می‌شود تا مقدار روی آن‌ها هم ثبت شود.`
                          : ' مدیریت موجودیِ این محصول به‌صورت خودکار فعال می‌شود.')}
                    </div>
                  </div>

                  <div className="pd-sec">
                    <div className="pd-sec-title">موجودی جدید (عدد)</div>
                    <div className="pd-inline">
                      <input
                        className="input ltr"
                        dir="ltr"
                        type="text"
                        inputMode="numeric"
                        placeholder="مثلاً 20"
                        value={qty}
                        onChange={(e) => setQty(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                        disabled={busy}
                        style={{ maxWidth: 200 }}
                      />
                    </div>
                  </div>

                  <div className="pd-sec">
                    <div className="pd-sec-title">وضعیت موجودی بعد از تغییر</div>
                    <select
                      className="sel"
                      style={{ minWidth: 180 }}
                      value={stockStatus}
                      onChange={(e) => setStockStatus(e.target.value)}
                      disabled={busy}
                    >
                      {STOCK_STATUSES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.fa}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="notice amber">
                    <IconAlert size={16} />
                    <div>
                      این تغییر مستقیم در ووکامرس ذخیره می‌شود و نیازمند کلید API با دسترسی «خواندن/نوشتن» است.
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
                      <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || totalTargets === 0}>
                        {busy ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                        {busy ? 'در حال اعمال…' : 'اعمال روی همهٔ ترکیبات'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}