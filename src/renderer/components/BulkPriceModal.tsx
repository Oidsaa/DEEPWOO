import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Product, ProductDetail } from '../../shared/types'
import { api } from '../api'
import { faNum, toLatin } from '../lib/format'
import { IconAlert, IconCheck, IconRefresh, IconTag, IconX } from './Icons'

interface Props {
  product: Product
  onClose: () => void
  /** Called after a successful bulk update so the parent can refresh the list. */
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

export default function BulkPriceModal({ product, onClose, onChanged }: Props) {
  const [detail, setDetail] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
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
  const targets = useMemo(() => {
    if (!detail) return []
    return isVariable ? detail.variations : [detail.product]
  }, [detail, isVariable])

  const newPriceOf = (oldPrice: number): number => {
    const v = Number(toLatin(amount))
    if (mode === 'pct-up') return roundThousand(oldPrice * (1 + v / 100))
    if (mode === 'pct-down') return roundThousand(oldPrice * (1 - v / 100))
    return v
  }

  const preview = useMemo(() => {
    if (!detail || amount === '') return []
    return targets.slice(0, 5).map((t) => ({
      label: isVariable && 'attributes' in t ? t.attributes.map((a) => `${a.name}: ${a.option}`).join('، ') : product.name,
      old: priceOf(t),
      next: newPriceOf(priceOf(t)),
    }))
  }, [detail, targets, amount, mode, isVariable, product.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): string | null => {
    const v = toLatin(amount)
    if (!v) return mode === 'fixed' ? 'قیمت جدید را وارد کنید.' : 'درصد را وارد کنید.'
    if (mode === 'fixed') {
      if (!/^\d+(\.\d+)?$/.test(v)) return 'قالب قیمت معتبر نیست (فقط عدد).'
      if (Number(v) <= 0) return 'قیمت جدید باید بزرگ‌تر از صفر باشد.'
    } else {
      if (!/^\d+(\.\d+)?$/.test(v)) return 'قالب درصد معتبر نیست (فقط عدد).'
      if (Number(v) <= 0) return 'درصد باید بزرگ‌تر از صفر باشد.'
      if (Number(v) > 1000) return 'درصد نباید بیشتر از ۱۰۰۰ باشد.'
    }
    return null
  }

  const apply = async () => {
    if (!detail) return
    const err = validate()
    setFormError(err)
    if (err || targets.length === 0) return

    setBusy(true)
    setDone(false)
    setProgress({ done: 0, total: targets.length })
    try {
      let i = 0
      for (const t of targets) {
        const next = newPriceOf(priceOf(t))
        if (isVariable && 'attributes' in t) {
          await api.updateProductVariation(product.id, t.id, { regular_price: String(next) })
        } else {
          await api.updateProduct(product.id, { regular_price: String(next) })
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

  const targetWord = isVariable ? 'ترکیب' : 'محصول'

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`تغییر کلی قیمت ${product.name}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconTag size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">تغییر کلی قیمت</div>
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
                    قیمت {faNum(targets.length)} {targetWord} به‌روزرسانی شد.
                  </div>
                </div>
              )}

              {isVariable && targets.length === 0 ? (
                <div className="empty" style={{ padding: '30px 20px' }}>
                  <div className="empty-ic">
                    <IconTag size={24} />
                  </div>
                  <div className="empty-title">هنوز ترکیبی تعریف نشده است</div>
                  <div className="empty-sub">
                    این محصول متغیر هنوز هیچ ترکیبی ندارد؛ ابتدا از بخش «جزئیات محصول» ترکیب بسازید.
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
                    <div className="pd-sec-title">{mode === 'fixed' ? 'قیمت جدید (تومان)' : 'درصد'}</div>
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
                        در حالت درصدی، قیمت‌ها به نزدیک‌ترین ۱٬۰۰۰ تومان گرد می‌شوند؛ قیمت حراج دست‌نخورده می‌ماند.
                      </div>
                    )}
                  </div>

                  <div className="pd-sec">
                    <div className="pd-sec-title">
                      اعمال روی {faNum(targets.length)} {targetWord}
                      {isVariable ? ' (همهٔ ترکیبات)' : ''}
                    </div>
                    {preview.length > 0 ? (
                      <div className="bp-preview">
                        {preview.map((p, i) => (
                          <div className="bp-row" key={i}>
                            <span className="bp-label">{p.label}</span>
                            <span className="bp-old">{faNum(p.old)}</span>
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
                      این تغییر روی همهٔ قیمت‌ها اعمال و مستقیم در ووکامرس ذخیره می‌شود و نیازمند کلید API با دسترسی
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
                      <button type="button" className="btn btn-primary" onClick={apply} disabled={busy || targets.length === 0}>
                        {busy ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                        {busy ? 'در حال اعمال…' : 'اعمال تغییر قیمت'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}