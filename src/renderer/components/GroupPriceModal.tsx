import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Product, ProductDetail } from '../../shared/types'
import { api } from '../api'
import { faNum, toLatin } from '../lib/format'
import { useCurrency } from '../lib/currency'
import { IconAlert, IconCheck, IconRefresh, IconTag, IconX } from './Icons'

interface Props {
  products: Product[]
  onClose: () => void
  /** Called after a successful group update so the parent can refresh the list. */
  onChanged: () => void
}

type Mode = 'pct-up' | 'pct-down' | 'fixed'

const MODES: { value: Mode; fa: string; sub: string }[] = [
  { value: 'pct-up', fa: 'افزایش درصدی', sub: 'قیمت همه به اندازهٔ درصد داده‌شده بیشتر می‌شود' },
  { value: 'pct-down', fa: 'کاهش درصدی', sub: 'قیمت همه به اندازهٔ درصد داده‌شده کمتر می‌شود' },
  { value: 'fixed', fa: 'ثبت قیمت ثابت', sub: 'یک قیمت مشخص برای همه ثبت می‌شود' },
]

const roundThousand = (n: number): number => Math.round(n / 1000) * 1000

function priceOf(p: { regular_price?: string; price?: string }): number {
  return Number(p.regular_price || p.price || 0) || 0
}

/** One apply target: a simple product, or one combination of a variable product. */
interface Target {
  productId: number
  variationId?: number
  label: string
  oldPrice: number
}

export default function GroupPriceModal({ products, onClose, onChanged }: Props) {
  // Snapshot on mount: selection stays stable even if the parent list refetches.
  const [items] = useState<Product[]>(products)
  const cur = useCurrency()
  const [details, setDetails] = useState<Map<number, ProductDetail>>(new Map())
  const [loadErrors, setLoadErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadCount, setLoadCount] = useState(0)
  const [mode, setMode] = useState<Mode>('pct-up')
  const [amount, setAmount] = useState('')
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
            oldPrice: priceOf(v),
          })
        }
      } else {
        list.push({ productId: p.id, label: p.name, oldPrice: priceOf(d.product) })
      }
    }
    return list
  }, [items, details])

  const newPriceOf = (oldPrice: number): number => {
    const v = Number(toLatin(amount))
    if (mode === 'pct-up') return roundThousand(oldPrice * (1 + v / 100))
    if (mode === 'pct-down') return roundThousand(oldPrice * (1 - v / 100))
    return v
  }

  const preview = useMemo(() => {
    if (toLatin(amount) === '') return []
    return targets.slice(0, 5).map((t) => ({ ...t, next: newPriceOf(t.oldPrice) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, amount, mode])

  const validate = (): string | null => {
    const v = toLatin(amount)
    if (!v) return mode === 'fixed' ? 'قیمت جدید را وارد کنید.' : 'درصد را وارد کنید.'
    if (!/^\d+(\.\d+)?$/.test(v)) return 'قالب ورودی معتبر نیست (فقط عدد).'
    if (Number(v) <= 0) return mode === 'fixed' ? 'قیمت جدید باید بزرگ‌تر از صفر باشد.' : 'درصد باید بزرگ‌تر از صفر باشد.'
    if (mode !== 'fixed' && Number(v) > 1000) return 'درصد نباید بیشتر از ۱۰۰۰ باشد.'
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
        const next = newPriceOf(t.oldPrice)
        if (t.variationId !== undefined) {
          await api.updateProductVariation(t.productId, t.variationId, { regular_price: String(next) })
        } else {
          await api.updateProduct(t.productId, { regular_price: String(next) })
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
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label="تغییر قیمت گروهی محصولات">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconTag size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">تغییر قیمت گروهی</div>
              <div className="modal-sub">
                {faNum(items.length)} محصول انتخاب‌شده
                {targets.length > 0
                  ? ` — ${faNum(targets.length)} هدف قیمتی${targets.some((t) => t.variationId !== undefined) ? ' (شامل ترکیب‌ها)' : ''}`
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
              <div>قیمت {faNum(targets.length)} هدف (محصول/ترکیب) به‌روزرسانی شد.</div>
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
                <IconTag size={24} />
              </div>
              <div className="empty-title">هدفی برای تغییر قیمت وجود ندارد</div>
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
                <div className="pd-sec-title">{mode === 'fixed' ? `قیمت جدید (${cur})` : 'درصد'}</div>
                <div className="pd-inline">
                  <input
                    className="input ltr"
                    dir="ltr"
                    type="text"
                    inputMode="decimal"
                    placeholder={mode === 'fixed' ? '1500000' : '10'}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy}
                    style={{ maxWidth: 200 }}
                  />
                  {mode !== 'fixed' && <span className="pd-note">٪</span>}
                </div>
                {mode !== 'fixed' && (
                  <div className="f-hint" style={{ marginTop: 6 }}>
                    در حالت درصدی، قیمت‌ها به نزدیک‌ترین ۱٬۰۰۰ {cur} گرد می‌شوند؛ قیمت حراج دست‌نخورده می‌ماند.
                  </div>
                )}
              </div>

              <div className="pd-sec">
                <div className="pd-sec-title">اعمال روی {faNum(targets.length)} هدف (محصول/ترکیب)</div>
                {preview.length > 0 ? (
                  <div className="bp-preview">
                    {preview.map((p, i) => (
                      <div className="bp-row" key={`${p.productId}-${p.variationId ?? 'p'}-${i}`}>
                        <span className="bp-label">{p.label}</span>
                        <span className="bp-old">{faNum(p.oldPrice)}</span>
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
                  این تغییر روی همهٔ اهداف اعمال و مستقیم در ووکامرس ذخیره می‌شود و نیازمند کلید API با دسترسی
                  «خواندن/نوشتن» است.
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
                    {busy ? 'در حال اعمال…' : 'اعمال تغییر قیمت'}
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
