import { useEffect, useState } from 'react'
import type { ProductDetail, ProductVariation, VariationPatch } from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum, toLatin } from '../lib/format'
import { IconAlert, IconBox, IconCheck, IconRefresh, IconX } from './Icons'

interface Props {
  productId: number
  productName: string
  onClose: () => void
  /** Called after any successful save so the parent can refresh the list. */
  onChanged: () => void
}

const PRODUCT_STATUS: Record<string, { fa: string; cls: string }> = {
  publish: { fa: 'منتشرشده', cls: 'pill-green' },
  private: { fa: 'خصوصی', cls: 'pill-amber' },
  draft: { fa: 'پیشنویس', cls: 'pill-dim' },
  pending: { fa: 'در انتظار بررسی', cls: 'pill-indigo' },
  future: { fa: 'زمان‌بندی‌شده', cls: 'pill-teal' },
}

const STOCK_STATUSES = [
  { value: 'instock', fa: 'موجود' },
  { value: 'outofstock', fa: 'ناموجود' },
  { value: 'onbackorder', fa: 'در انتظار تأمین' },
]

interface VarDraft {
  regular: string
  sale: string
  qty: string
  stockStatus: string
}

interface SimpleDraft extends VarDraft {
  status: string
}

function priceErr(s: string, required: boolean): string | null {
  const t = toLatin(s)
  if (!t) return required ? 'قیمت را وارد کنید.' : null
  if (!/^\d+(\.\d+)?$/.test(t)) return 'قالب قیمت معتبر نیست (فقط عدد).'
  return null
}

function qtyErr(s: string, manageStock: boolean): string | null {
  if (!manageStock) return null
  const t = toLatin(s)
  if (!t) return 'موجودی را وارد کنید.'
  if (!/^\d+$/.test(t)) return 'موجودی باید عدد صحیح باشد.'
  return null
}

export default function ProductDetailModal({ productId, productName, onClose, onChanged }: Props) {
  const [result, setResult] = useState<ProductDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)

  const [simpleDraft, setSimpleDraft] = useState<SimpleDraft | null>(null)
  const [varDrafts, setVarDrafts] = useState<Record<number, VarDraft>>({})
  const [pubStatus, setPubStatus] = useState('publish')

  const [saving, setSaving] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 2600)
    return () => window.clearTimeout(t)
  }, [flash])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setFormError(null)
    api
      .getProductDetail(productId)
      .then((d) => {
        if (cancelled) return
        setResult(d)
        const isVar = d.product.type === 'variable'
        setPubStatus(d.product.status || 'publish')
        if (isVar) {
          const drafts: Record<number, VarDraft> = {}
          for (const v of d.variations) {
            drafts[v.id] = {
              regular: v.regular_price || '',
              sale: v.sale_price || '',
              qty: v.stock_quantity !== null && v.stock_quantity !== undefined ? String(v.stock_quantity) : '',
              stockStatus: v.stock_status,
            }
          }
          setVarDrafts(drafts)
        } else {
          const p = d.product
          setSimpleDraft({
            regular: p.regular_price || '',
            sale: p.sale_price || '',
            qty: p.stock_quantity !== null && p.stock_quantity !== undefined ? String(p.stock_quantity) : '',
            stockStatus: p.stock_status,
            status: p.status || 'publish',
          })
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [productId, loadCount])

  const patchVarDraft = (id: number, patch: Partial<VarDraft>) =>
    setVarDrafts((m) => ({ ...m, [id]: { ...m[id], ...patch } }))

  const isVariable = !!result && result.product.type === 'variable'

  const saveProduct = async () => {
    if (!result) return
    const p = result.product
    if (!isVariable && simpleDraft) {
      const err =
        priceErr(simpleDraft.regular, true) ||
        priceErr(simpleDraft.sale, false) ||
        qtyErr(simpleDraft.qty, p.manage_stock)
      setFormError(err)
      if (err) return
      const regular = toLatin(simpleDraft.regular)
      const sale = toLatin(simpleDraft.sale)
      setSaving('product')
      try {
        const updated = await api.updateProduct(productId, {
          status: simpleDraft.status,
          regular_price: regular,
          sale_price: sale,
          stock_status: simpleDraft.stockStatus,
          ...(p.manage_stock ? { stock_quantity: Number(toLatin(simpleDraft.qty)) } : {}),
        })
        setResult((r) => (r ? { ...r, product: updated } : r))
        setFlash('product')
        onChanged()
      } catch (e) {
        setFormError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(null)
      }
      return
    }
    // Variable product — product level: publication status only.
    setSaving('product')
    try {
      const updated = await api.updateProduct(productId, { status: pubStatus })
      setResult((r) => (r ? { ...r, product: updated } : r))
      setFlash('product')
      onChanged()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const saveVariation = async (v: ProductVariation) => {
    const draft = varDrafts[v.id]
    if (!draft) return
    const err = priceErr(draft.regular, true) || priceErr(draft.sale, false) || qtyErr(draft.qty, v.manage_stock)
    setFormError(err)
    if (err) return
    const key = 'v:' + v.id
    setSaving(key)
    try {
      const patch: VariationPatch = {
        regular_price: toLatin(draft.regular),
        sale_price: toLatin(draft.sale),
        stock_status: draft.stockStatus,
        ...(v.manage_stock ? { stock_quantity: Number(toLatin(draft.qty)) } : {}),
      }
      const updated = await api.updateProductVariation(productId, v.id, patch)
      setResult((r) =>
        r ? { ...r, variations: r.variations.map((x) => (x.id === v.id ? updated : x)) } : r,
      )
      setFlash(key)
      onChanged()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  const product = result?.product

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`جزئیات محصول ${productName}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconBox size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                جزئیات محصول
              </div>
              <div className="modal-sub">{productName}</div>
            </div>
          </div>
          <button type="button" className="btn-icon" aria-label="بستن" onClick={onClose} disabled={!!saving}>
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body">
          {error ? (
            <div className="empty" style={{ padding: '36px 20px' }}>
              <div className="empty-ic amber">
                <IconAlert size={26} />
              </div>
              <div className="empty-title">دریافت جزئیات محصول ناموفق بود</div>
              <div className="empty-sub">{error}</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
                  <IconRefresh size={15} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : loading || !product ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="sk sk-line" style={{ height: 64, width: '100%' }} />
              <div className="sk sk-line" style={{ height: 150, width: '100%' }} />
            </div>
          ) : (
            <>
              {formError && (
                <div className="notice err">
                  <IconAlert size={16} />
                  <div>{formError}</div>
                </div>
              )}

              <div className="pd-head">
                {product.images[0]?.src ? (
                  <img className="p-thumb" style={{ width: 52, height: 52 }} src={product.images[0].src} alt="" />
                ) : (
                  <div className="pd-ic">
                    <IconBox size={22} />
                  </div>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pd-name">{product.name}</div>
                  <div className="pd-sub" dir="ltr" style={{ textAlign: 'right' }}>
                    {product.sku ? <span dir="ltr">{faDigits(product.sku)}</span> : null}
                    {product.type !== 'simple' ? ` • ${product.type === 'variable' ? 'محصول متغیر' : product.type}` : ''}
                    {' • '}کد محصول: <span dir="ltr">{faNum(product.id)}</span>
                  </div>
                </div>
                <span className={'pill ' + (PRODUCT_STATUS[product.status]?.cls ?? 'pill-dim')}>
                  {PRODUCT_STATUS[product.status]?.fa ?? product.status}
                </span>
              </div>

              <div className="pd-meta">
                <div className="pd-meta-item">
                  <span className="stat-label">دسته‌بندی</span>
                  <span className="pd-meta-val">{product.categories.map((c) => c.name).join('، ') || '—'}</span>
                </div>
                <div className="pd-meta-item">
                  <span className="stat-label">فروش کل</span>
                  <span className="pd-meta-val num">{faNum(product.total_sales)} عدد</span>
                </div>
                <div className="pd-meta-item">
                  <span className="stat-label">تاریخ افزوده‌شده</span>
                  <span className="pd-meta-val">{faDate(product.date_created)}</span>
                </div>
              </div>

              {isVariable ? (
                <>
                  <div className="pd-sec">
                    <div className="pd-sec-title">وضعیت انتشار محصول</div>
                    <div className="pd-inline">
                      <select
                        className="sel"
                        style={{ minWidth: 170 }}
                        value={pubStatus}
                        onChange={(e) => setPubStatus(e.target.value)}
                        disabled={!!saving}
                      >
                        {Object.entries(PRODUCT_STATUS)
                          .filter(([k]) => k !== 'future')
                          .map(([k, m]) => (
                            <option key={k} value={k}>
                              {m.fa}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-sm btn-soft"
                        onClick={saveProduct}
                        disabled={!!saving || pubStatus === product.status}
                      >
                        {saving === 'product' ? <IconRefresh size={14} className="spin" /> : <IconCheck size={14} />}
                        ذخیرهٔ وضعیت
                      </button>
                      {flash === 'product' && <span className="save-msg">ذخیره شد</span>}
                    </div>
                  </div>

                  <div className="pd-sec">
                    <div className="pd-sec-title">
                      ترکیبات و متغیرها
                      <span className="pd-count">{faNum(result.variations.length)} ترکیب</span>
                    </div>
                    {result.variations.length === 0 ? (
                      <div className="pd-empty">هنوز ترکیبی برای این محصول تعریف نشده است.</div>
                    ) : (
                      <div className="v-list">
                        {result.variations.map((v) => (
                          <VariationCard
                            key={v.id}
                            variation={v}
                            draft={varDrafts[v.id]}
                            saving={saving}
                            flash={flash}
                            onDraft={(patch) => patchVarDraft(v.id, patch)}
                            onSave={() => void saveVariation(v)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="pd-sec">
                  <div className="pd-sec-title">ویرایش محصول</div>
                  <div className="v-edit" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                    <label className="field">
                      <span className="lbl">قیمت (تومان)</span>
                      <input
                        className="input input-sm ltr"
                        dir="ltr"
                        type="text"
                        inputMode="decimal"
                        value={simpleDraft?.regular ?? ''}
                        onChange={(e) => setSimpleDraft((d) => (d ? { ...d, regular: e.target.value } : d))}
                      />
                    </label>
                    <label className="field">
                      <span className="lbl">قیمت حراج (اختیاری)</span>
                      <input
                        className="input input-sm ltr"
                        dir="ltr"
                        type="text"
                        inputMode="decimal"
                        value={simpleDraft?.sale ?? ''}
                        onChange={(e) => setSimpleDraft((d) => (d ? { ...d, sale: e.target.value } : d))}
                      />
                    </label>
                    {product.manage_stock && (
                      <label className="field">
                        <span className="lbl">موجودی (عدد)</span>
                        <input
                          className="input input-sm ltr"
                          dir="ltr"
                          type="text"
                          inputMode="numeric"
                          value={simpleDraft?.qty ?? ''}
                          onChange={(e) =>
                            setSimpleDraft((d) => (d ? { ...d, qty: e.target.value.replace(/[^0-9۰-۹]/g, '') } : d))
                          }
                        />
                      </label>
                    )}
                    <label className="field">
                      <span className="lbl">وضعیت موجودی</span>
                      <select
                        className="sel sel-sm"
                        value={simpleDraft?.stockStatus ?? 'instock'}
                        onChange={(e) => setSimpleDraft((d) => (d ? { ...d, stockStatus: e.target.value } : d))}
                      >
                        {STOCK_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.fa}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="lbl">وضعیت انتشار</span>
                      <select
                        className="sel sel-sm"
                        value={simpleDraft?.status ?? 'publish'}
                        onChange={(e) => setSimpleDraft((d) => (d ? { ...d, status: e.target.value } : d))}
                      >
                        {Object.entries(PRODUCT_STATUS)
                          .filter(([k]) => k !== 'future')
                          .map(([k, m]) => (
                            <option key={k} value={k}>
                              {m.fa}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="pd-actions">
                    <span className="pd-note">
                      ویرایش‌ها مستقیماً در ووکامرس ذخیره می‌شوند و به تغییرات نیازمند کلید API با دسترسی «خواندن/نوشتن»
                      است.
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {flash === 'product' && <span className="save-msg">ذخیره شد</span>}
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={saveProduct}
                        disabled={!!saving}
                      >
                        {saving === 'product' ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                        {saving === 'product' ? 'در حال ذخیره…' : 'ذخیرهٔ تغییرات'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function VariationCard({
  variation: v,
  draft,
  saving,
  flash,
  onDraft,
  onSave,
}: {
  variation: ProductVariation
  draft?: VarDraft
  saving: string | null
  flash: string | null
  onDraft: (patch: Partial<VarDraft>) => void
  onSave: () => void
}) {
  const key = 'v:' + v.id
  const busy = saving === key
  const combo = v.attributes.map((a) => `${a.name}: ${a.option}`).join('، ')
  return (
    <div className="v-card">
      <div className="v-card-head">
        <div className="v-combo">{combo || 'ترکیب پایه'}</div>
        <div className="v-head-left">
          {v.sku && (
            <span className="v-sku" dir="ltr">
              {faDigits(v.sku)}
            </span>
          )}
          <span
            className={
              'pill ' + (v.stock_status === 'instock' ? 'pill-green' : v.stock_status === 'outofstock' ? 'pill-red' : 'pill-amber')
            }
          >
            {v.stock_status === 'instock' ? 'موجود' : v.stock_status === 'outofstock' ? 'ناموجود' : 'در انتظار تأمین'}
          </span>
          {v.on_sale && <span className="pill pill-teal">حراج</span>}
        </div>
      </div>

      <div className="v-edit" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
        <label className="field">
          <span className="lbl">قیمت</span>
          <input
            className="input input-sm ltr"
            dir="ltr"
            type="text"
            inputMode="decimal"
            value={draft?.regular ?? ''}
            onChange={(e) => onDraft({ regular: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="lbl">قیمت حراج</span>
          <input
            className="input input-sm ltr"
            dir="ltr"
            type="text"
            inputMode="decimal"
            value={draft?.sale ?? ''}
            onChange={(e) => onDraft({ sale: e.target.value })}
          />
        </label>
        {v.manage_stock && (
          <label className="field">
            <span className="lbl">موجودی</span>
            <input
              className="input input-sm ltr"
              dir="ltr"
              type="text"
              inputMode="numeric"
              value={draft?.qty ?? ''}
              onChange={(e) => onDraft({ qty: e.target.value.replace(/[^0-9۰-۹]/g, '') })}
            />
          </label>
        )}
        <label className="field">
          <span className="lbl">وضعیت</span>
          <select
            className="sel sel-sm"
            value={draft?.stockStatus ?? 'instock'}
            onChange={(e) => onDraft({ stockStatus: e.target.value })}
          >
            {STOCK_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.fa}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="v-card-foot">
        {v.manage_stock && draft?.qty !== '' && v.stock_quantity !== null && (
          <span className="v-old-qty">
            موجودی فعلی در ووکامرس: <b>{faNum(v.stock_quantity ?? 0)}</b>
          </span>
        )}
        {v.price ? (
          <span className="v-cur-price">
            {v.on_sale && v.regular_price ? <s>{faNum(v.regular_price)}</s> : null}{' '}
            <b>{faNum(draft?.regular !== undefined && draft?.regular !== '' ? toLatin(draft.regular) : v.regular_price)}</b>
          </span>
        ) : null}
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {flash === key && <span className="save-msg">ذخیره شد</span>}
          <button type="button" className="btn btn-sm btn-soft" onClick={onSave} disabled={!!saving}>
            {busy ? <IconRefresh size={13} className="spin" /> : <IconCheck size={13} />}
            {busy ? 'در حال ذخیره…' : 'ذخیره'}
          </button>
        </div>
      </div>
    </div>
  )
}
