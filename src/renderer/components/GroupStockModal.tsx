import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Product, ProductDetail, ProductPatch, VariationPatch } from '../../shared/types'
import { api } from '../api'
import { faNum, toLatin } from '../lib/format'
import { IconAlert, IconCheck, IconLayers, IconRefresh, IconX } from './Icons'

interface Props {
  products: Product[]
  onClose: () => void
  /** Called after a successful group update so the parent can refresh the list. */
  onChanged: () => void
}

type Mode = 'set' | 'inc' | 'dec'

const MODES: { value: Mode; fa: string; sub: string }[] = [
  { value: 'set', fa: 'ثبت موجودی مشخص', sub: 'همهٔ اهداف این عدد را می‌گیرند' },
  { value: 'inc', fa: 'افزودن به موجودی', sub: 'این عدد به موجودی فعلی همه اضافه می‌شود' },
  { value: 'dec', fa: 'کاستن از موجودی', sub: 'این عدد از موجودی فعلی همه کم می‌شود (حداقل صفر)' },
]

const STOCK_STATUSES = [
  { value: 'instock', fa: 'موجود' },
  { value: 'outofstock', fa: 'ناموجود' },
  { value: 'onbackorder', fa: 'در انتظار تأمین' },
]

/** One apply target: a simple product, or one combination of a variable product. */
interface Target {
  productId: number
  variationId?: number
  label: string
  oldQty: number | null
  manageStock: boolean
}

export default function GroupStockModal({ products, onClose, onChanged }: Props) {
  // Snapshot on mount: selection stays stable even if the parent list refetches.
  const [items] = useState<Product[]>(products)
  const [details, setDetails] = useState<Map<number, ProductDetail>>(new Map())
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadCount, setLoadCount] = useState(0)
  const [mode, setMode] = useState<Mode>('set')
  const [amount, setAmount] = useState('')
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
    setLoadErrors([])
    setFormError(null)
    setDone(false)
    Promise.all(
      items.map((p) =>
        api
          .getProductDetail(p.id)
          .then((d) => [p.id, d] as const)
          .catch((e: unknown) => {
            setLoadErrors((prev) =>
              prev.includes(p.name) ? prev : [...prev, `${p.name} (${e instanceof Error ? e.message : String(e)})`],
            )
            return [p.id, null] as const
          }),
      ),
    ).then((pairs) => {
      if (cancelled) return
      const map = new Map<number, ProductDetail>()
      for (const [id, d] of pairs) if (d) map.set(id, d)
      setDetails(map)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [items, loadCount])

  const targets = useMemo<Target[]>(() => {
    const list: Target[] = []
    for (const p of items) {
      const d = details.get(p.id)
      if (!d) continue
      if (d.product.type === 'variable') {
        for (const v of d.variations) {
          list.push({
            productId: p.id,
            variationId: v.id,
            label: v.attributes.length
              ? `${p.name} — ${v.attributes.map((a) => `${a.name}: ${a.option}`).join('، ')}`
              : p.name,
            oldQty: v.manage_stock ? (v.stock_quantity ?? null) : null,
            manageStock: v.manage_stock,
          })
        }
      } else {
        list.push({
          productId: p.id,
          label: p.name,
          oldQty: d.product.manage_stock ? (d.product.stock_quantity ?? null) : null,
          manageStock: d.product.manage_stock,
        })
      }
    }
    return list
  }, [items, details])

  const toEnable = targets.filter((t) => !t.manageStock).length
  const hasVariations = targets.some((t) => t.variationId !== undefined)

  const newQtyOf = (oldQty: number | null): number => {
    const v = Number(toLatin(amount))
    if (mode === 'set') return v
    const cur = oldQty ?? 0
    return mode === 'inc' ? cur + v : Math.max(0, cur - v)
  }

  const preview = useMemo(() => {
    if (toLatin(amount) === '') return []
    return targets.slice(0, 5).map((t) => ({ ...t, next: newQtyOf(t.oldQty) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, amount, mode])

  const validate = (): string | null => {
    const v = toLatin(amount)
    if (v === '') return mode === 'set' ? 'موجودی جدید را وارد کنید.' : 'مقدار را وارد کنید.'
    if (!/^\d+$/.test(v)) return 'مقدار باید عدد صحیح باشد.'
    if (mode !== 'set' && Number(v) === 0)
      return mode === 'inc' ? 'مقدار افزودن باید بزرگ‌تر از صفر باشد.' : 'مقدار کاستن باید بزرگ‌تر از صفر باشد.'
    return null
  }

  const apply = async () => {
    const err = validate()
    setFormError(err)
    if (err || targets.length === 0) return

    setBusy(true)
    setDone(false)
    setProgress({ done: 0, total: targets.length })
    try {
      let i = 0
      for (const t of targets) {
        const next = newQtyOf(t.oldQty)
        if (t.variationId !== undefined) {
          const patch: VariationPatch = { stock_quantity: next, stock_status: stockStatus }
          if (!t.manageStock) patch.manage_stock = true
          await api.updateProductVariation(t.productId, t.variationId, patch)
        } else {
          const patch: ProductPatch = { stock_quantity: next, stock_status: stockStatus }
          if (!t.manageStock) patch.manage_stock = true
          await api.updateProduct(t.productId, patch)
        }
        i += 1
        setProgress({ done: i, total: targets.length })
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

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label="تغییر موجودی گروهی محصولات">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconLayers size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">تغییر موجودی گروهی</div>
              <div className="modal-sub">
                {faNum(items.length)} محصول انتخاب‌شده
                {targets.length > 0
                  ? ` — ${faNum(targets.length)} هدف موجودی${hasVariations ? ' (شامل ترکیب‌ها)' : ''}`
                  : ''}
              </div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={busy}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          {loadErrors.length > 0 && (
            <div className="notice amber">
              <IconAlert size={16} />
              <div>
                جزئیات {faNum(loadErrors.length)} محصول خوانده نشد و از تغییر کنار گذاشته شد: {loadErrors.join('، ')}
              </div>
            </div>
          )}
          {formError && (
            <div className="notice err">
              <IconAlert size={16} />
              <div>{formError}</div>
            </div>
          )}
          {done && (
            <div className="notice ok fade-in">
              <IconCheck size={16} />
              <div>موجودی {faNum(targets.length)} هدف (محصول/ترکیب) به‌روزرسانی شد.</div>
            </div>
          )}

          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="sk sk-line" style={{ height: 56, width: '100%' }} />
              <div className="sk sk-line" style={{ height: 120, width: '100%' }} />
            </div>
          ) : targets.length === 0 ? (
            <div className="empty" style={{ padding: '30px 20px' }}>
              <div className="empty-ic">
                <IconLayers size={24} />
              </div>
              <div className="empty-title">هدفی برای تغییر موجودی وجود ندارد</div>
              <div className="empty-sub">جزئیات هیچ‌کدام از محصولات انتخاب‌شده خوانده نشد.</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
                  <IconRefresh size={15} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="notice info">
                <IconAlert size={16} />
                <div>
                  این تغییر روی <b>همهٔ {faNum(targets.length)} هدف</b>
                  {hasVariations ? ' (شامل هر رنگ و سایز)' : ''} اعمال می‌شود.
                  {toEnable > 0 &&
                    ` مدیریت موجودیِ ${faNum(toEnable)} هدفِ بدون مدیریت، به‌صورت خودکار فعال می‌شود تا مقدار روی آن‌ها هم ثبت شود.`}
                </div>
              </div>

              <div className="pd-sec">
                <div className="pd-sec-title">نوع تغییر</div>
                <div className="mode-row">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      className={'mode-card' + (mode === m.value ? ' active' : '')}
                      onClick={() => {
                        setMode(m.value)
                        setAmount('')
                        setFormError(null)
                      }}
                      disabled={busy}
                    >
                      <b>{m.fa}</b>
                      <span>{m.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pd-sec">
                <div className="pd-sec-title">{mode === 'set' ? 'موجودی جدید (عدد)' : 'مقدار (عدد)'}</div>
                <div className="pd-inline">
                  <input
                    className="input ltr"
                    dir="ltr"
                    type="text"
                    inputMode="numeric"
                    placeholder={mode === 'set' ? 'مثلاً 20' : 'مثلاً 5'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9۰-۹]/g, ''))}
                    disabled={busy}
                    style={{ maxWidth: 200 }}
                  />
                </div>
                {mode !== 'set' && (
                  <div className="f-hint" style={{ marginTop: 6 }}>
                    مبنای محاسبه، موجودی فعلیِ هر محصول/ترکیب است؛ اهدافی که مدیریت موجودی‌شان خاموش است صفر فرض می‌شوند.
                  </div>
                )}
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

              <div className="pd-sec">
                <div className="pd-sec-title">اعمال روی {faNum(targets.length)} هدف (محصول/ترکیب)</div>
                {preview.length > 0 ? (
                  <div className="bp-preview">
                    {preview.map((p, i) => (
                      <div className="bp-row" key={`${p.productId}-${p.variationId ?? 'p'}-${i}`}>
                        <span className="bp-label">{p.label}</span>
                        <span className="bp-old">{p.oldQty === null ? '—' : faNum(p.oldQty)}</span>
                        <span className="bp-arrow">←</span>
                        <span className="bp-new">{faNum(p.next)}</span>
                      </div>
                    ))}
                    {targets.length > preview.length && (
                      <div className="f-hint">…و {faNum(targets.length - preview.length)} مورد دیگر</div>
                    )}
                  </div>
                ) : (
                  <div className="f-hint">برای مشاهدهٔ پیش‌نمایش، مقدار را وارد کنید.</div>
                )}
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={apply}
                    disabled={busy || targets.length === 0}
                  >
                    {busy ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                    {busy ? 'در حال اعمال…' : 'اعمال تغییر موجودی'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
