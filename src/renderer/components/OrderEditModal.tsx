import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Order, Product, ProductVariation } from '../../shared/types'
import { api } from '../api'
import { useCurrency } from '../lib/currency'
import { faDigits, faNum } from '../lib/format'
import { IconAlert, IconBox, IconCheck, IconLayers, IconPlus, IconRefresh, IconSearch, IconTrash, IconX } from './Icons'

interface Props {
  order: Order
  onClose: () => void
  onSaved: () => void
}

interface EditLine {
  /** Existing WooCommerce line-item id — kept so the update is in-place; deleted lines are sent with quantity 0. */
  id?: number
  product_id?: number
  variation_id?: number
  quantity: number
  name: string
  price: number
  removed?: boolean
}

interface AddrForm {
  first_name: string
  last_name: string
  phone: string
  state: string
  city: string
  address_1: string
  address_2: string
  postcode: string
}

const toForm = (a: Partial<Order['billing']> | undefined, fb?: Partial<AddrForm>): AddrForm => ({
  first_name: a?.first_name ?? fb?.first_name ?? '',
  last_name: a?.last_name ?? fb?.last_name ?? '',
  phone: a?.phone ?? fb?.phone ?? '',
  state: a?.state ?? fb?.state ?? '',
  city: a?.city ?? fb?.city ?? '',
  address_1: a?.address_1 ?? fb?.address_1 ?? '',
  address_2: a?.address_2 ?? fb?.address_2 ?? '',
  postcode: a?.postcode ?? fb?.postcode ?? '',
})

export default function OrderEditModal({ order, onClose, onSaved }: Props) {
  const cur = useCurrency()
  const [lines, setLines] = useState<EditLine[]>(() =>
    order.line_items.map((item) => ({
      id: item.id,
      product_id: item.product_id,
      variation_id: item.variation_id,
      quantity: item.quantity,
      name: item.name,
      price: Number(item.price) || 0,
    })),
  )
  const billInit = toForm(order.billing)
  const shipInit = toForm(order.shipping ?? undefined, billInit)
  const [bill, setBill] = useState<AddrForm>(billInit)
  const [ship, setShip] = useState<AddrForm>(shipInit)
  /** Whether a separate shipping address is kept/edited for this order. */
  const [editShip, setEditShip] = useState(!!order.shipping?.address_1)
  const [addrTab, setAddrTab] = useState<'bill' | 'ship'>('bill')
  const [prodQuery, setProdQuery] = useState('')
  const [prodLoading, setProdLoading] = useState(false)
  const [prodResults, setProdResults] = useState<Product[]>([])
  const [picking, setPicking] = useState<Product | null>(null)
  const [detailVars, setDetailVars] = useState<ProductVariation[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /* Debounced product search. */
  useEffect(() => {
    const q = prodQuery.trim()
    if (q.length < 1) {
      setProdResults([])
      setProdLoading(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      setProdLoading(true)
      api
        .listProducts({ search: q, perPage: 12 })
        .then((r) => {
          if (!cancelled) setProdResults(r.products)
        })
        .catch(() => {
          if (!cancelled) setProdResults([])
        })
        .finally(() => {
          if (!cancelled) setProdLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [prodQuery])

  const openVariations = async (p: Product) => {
    setPicking(p)
    setProdResults([])
    setProdQuery('')
    setDetailLoading(true)
    setDetailVars([])
    try {
      const detail = await api.getProductDetail(p.id)
      setDetailVars(detail.variations)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPicking(null)
    } finally {
      setDetailLoading(false)
    }
  }

  const addLine = (p: Product, v?: ProductVariation, qty = 1) => {
    setError(null)
    const price = Number(v ? v.price : p.price) || 0
    setLines((prev) => {
      const hit = prev.find((l) => !l.removed && l.product_id === p.id && (l.variation_id ?? -1) === (v?.id ?? -1))
      if (hit) return prev.map((l) => (l === hit ? { ...l, quantity: l.quantity + qty } : l))
      return [...prev, { product_id: p.id, variation_id: v?.id, quantity: qty, name: p.name, price }]
    })
    if (p.type === 'variable') setPicking(null)
  }

  /** Existing (persisted) lines are flagged removed → sent with quantity 0; new lines just disappear. */
  const removeLine = (idx: number) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? (l.id ? { ...l, removed: true } : l) : l)).filter((l, i) => i !== idx || l.removed))

  const setQty = (idx: number, qty: number) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, Math.min(999, qty)) } : l)))

  const active = lines.filter((l) => !l.removed)
  const total = active.reduce((sum, l) => sum + l.price * l.quantity, 0)

  const submit = async () => {
    if (submitting) return
    setError(null)
    if (active.length === 0) {
      setError('حداقل یک قلم کالا باید در سفارش باشد.')
      return
    }
    setSubmitting(true)
    try {
      // WooCommerce semantics: existing line → id + quantity; deleted → id + quantity 0; new → no id.
      const line_items = [
        ...lines
          .filter((l) => !l.removed)
          .map((l) => ({
            id: l.id,
            ...(l.product_id !== undefined ? { product_id: l.product_id } : {}),
            ...(l.variation_id !== undefined ? { variation_id: l.variation_id } : {}),
            quantity: l.quantity,
          })),
        ...lines.filter((l) => l.removed && l.id).map((l) => ({ id: l.id!, quantity: 0 })),
      ]
      await api.updateOrder(order.id, {
        line_items,
        billing: {
          first_name: bill.first_name.trim() || undefined,
          last_name: bill.last_name.trim() || undefined,
          phone: bill.phone.trim() || undefined,
          state: bill.state.trim() || undefined,
          city: bill.city.trim() || undefined,
          address_1: bill.address_1.trim() || undefined,
          address_2: bill.address_2.trim() || undefined,
          postcode: bill.postcode.trim() || undefined,
        },
        ...(editShip
          ? {
              shipping: {
                first_name: ship.first_name.trim() || undefined,
                last_name: ship.last_name.trim() || undefined,
                state: ship.state.trim() || undefined,
                city: ship.city.trim() || undefined,
                address_1: ship.address_1.trim() || undefined,
                address_2: ship.address_2.trim() || undefined,
                postcode: ship.postcode.trim() || undefined,
              },
            }
          : {}),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const addrFields = (
    f: AddrForm,
    set: (v: AddrForm) => void,
    withPhone: boolean,
    pf: string,
  ) => (
    <div className="form-grid">
      <div className="field">
        <label className="lbl" htmlFor={pf + '-first'}>
          نام
        </label>
        <input id={pf + '-first'} className="input" value={f.first_name} onChange={(e) => set({ ...f, first_name: e.target.value })} />
      </div>
      <div className="field">
        <label className="lbl" htmlFor={pf + '-last'}>
          نام خانوادگی
        </label>
        <input id={pf + '-last'} className="input" value={f.last_name} onChange={(e) => set({ ...f, last_name: e.target.value })} />
      </div>
      {withPhone && (
        <div className="field">
          <label className="lbl" htmlFor={pf + '-phone'}>
            شمارهٔ موبایل
          </label>
          <input
            id={pf + '-phone'}
            className="input ltr"
            dir="ltr"
            value={f.phone}
            onChange={(e) => set({ ...f, phone: e.target.value })}
            placeholder="۰۹۱۲…"
          />
        </div>
      )}
      <div className="field">
        <label className="lbl" htmlFor={pf + '-state'}>
          استان
        </label>
        <input id={pf + '-state'} className="input" value={f.state} onChange={(e) => set({ ...f, state: e.target.value })} placeholder="مثلاً تهران" />
      </div>
      <div className="field">
        <label className="lbl" htmlFor={pf + '-city'}>
          شهر
        </label>
        <input id={pf + '-city'} className="input" value={f.city} onChange={(e) => set({ ...f, city: e.target.value })} placeholder="مثلاً تهران" />
      </div>
      <div className="field">
        <label className="lbl" htmlFor={pf + '-addr1'}>
          نشانی
        </label>
        <input
          id={pf + '-addr1'}
          className="input"
          value={f.address_1}
          onChange={(e) => set({ ...f, address_1: e.target.value })}
          placeholder="خیابان، کوچه، پلاک"
        />
      </div>
      <div className="field">
        <label className="lbl" htmlFor={pf + '-addr2'}>
          ادامهٔ آدرس
        </label>
        <input
          id={pf + '-addr2'}
          className="input"
          value={f.address_2}
          onChange={(e) => set({ ...f, address_2: e.target.value })}
          placeholder="واحد، طبقه (اختیاری)"
        />
      </div>
      <div className="field">
        <label className="lbl" htmlFor={pf + '-postcode'}>
          کدپستی
        </label>
        <input
          id={pf + '-postcode'}
          className="input ltr"
          dir="ltr"
          inputMode="numeric"
          value={f.postcode}
          onChange={(e) => set({ ...f, postcode: e.target.value })}
          placeholder="10 رقمی"
        />
      </div>
    </div>
  )

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal modal-xl" role="dialog" aria-modal="true" aria-label={`ویرایش سفارش ${order.number}`}>
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconBox size={19} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>ویرایش سفارش</span>
                <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                  #{faDigits(order.number)}
                </span>
              </div>
              <div className="modal-sub">اقلام و آدرس را ویرایش کنید — جمع مبلغ در فروشگاه خودکار بازمحاسبه می‌شود</div>
            </div>
          </div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="بستن">
            <IconX size={15} />
          </button>
        </div>

        <div className="modal-body" style={{ padding: '0 24px 24px' }}>
          {/* ----------------------------- اقلام ----------------------------- */}
          <div className="pd-sec">
            <div className="pd-sec-title">
              اقلام سفارش
              <span className="pd-count">{faNum(active.length)} مورد</span>
            </div>
            <div className="field" style={{ position: 'relative', marginBottom: 14 }}>
              <label className="lbl" htmlFor="edit-prod-search">
                افزودن محصول جدید
              </label>
              <div className="search">
                <span className="search-ic">
                  <IconSearch size={15} />
                </span>
                <input
                  id="edit-prod-search"
                  dir="rtl"
                  value={prodQuery}
                  onChange={(e) => {
                    setProdQuery(e.target.value)
                    setPicking(null)
                  }}
                  placeholder="نام یا کد محصول را جستجو کنید…"
                />
                {prodQuery && (
                  <button type="button" className="clear-btn" onClick={() => setProdQuery('')} aria-label="پاک‌کردن">
                    <IconX size={13} />
                  </button>
                )}
              </div>

              {prodQuery.trim().length > 0 && !picking && (
                <div className="qo-results fade-in" style={{ marginTop: 8 }}>
                  {prodLoading && (
                    <div className="qo-results-empty">
                      <IconRefresh size={15} className="spin" /> در حال جستجو…
                    </div>
                  )}
                  {!prodLoading && prodResults.length === 0 && <div className="qo-results-empty">محصولی با این نام پیدا نشد.</div>}
                  {!prodLoading &&
                    prodResults.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        className="qo-result"
                        onClick={() => (p.type === 'variable' ? void openVariations(p) : addLine(p))}
                      >
                        <span className="qo-result-ic">{p.type === 'variable' ? <IconLayers size={15} /> : <IconBox size={15} />}</span>
                        <span style={{ minWidth: 0 }}>
                          <span className="qo-match-name">{p.name}</span>
                          <span className="qo-match-sub">
                            {p.sku && <span dir="ltr">{p.sku}</span>}
                            {p.sku ? ' · ' : ''}
                            {p.type === 'variable' ? 'محصول متغیر' : p.categories[0]?.name ?? ''}
                          </span>
                        </span>
                        <span className="qo-result-price">{p.type === 'variable' ? '' : `${faNum(p.price)} ${cur}`}</span>
                        <span className="qo-add-txt">
                          <IconPlus size={14} /> افزودن
                        </span>
                      </button>
                    ))}
                </div>
              )}

              {picking && (
                <div className="qo-picking fade-in" style={{ marginTop: 8 }}>
                  <div className="qo-picking-head">
                    <div>
                      <div className="qo-match-name">{picking.name}</div>
                      <div className="qo-match-sub">ترکیب دلخواه را انتخاب کنید</div>
                    </div>
                    <button type="button" className="btn-icon" onClick={() => setPicking(null)} aria-label="بستن">
                      <IconX size={14} />
                    </button>
                  </div>
                  {detailLoading && (
                    <div className="qo-results-empty">
                      <IconRefresh size={15} className="spin" /> در حال دریافت ترکیب‌ها…
                    </div>
                  )}
                  {!detailLoading && detailVars.length === 0 && <div className="qo-results-empty">ترکیبی برای این محصول تعریف نشده است.</div>}
                  {!detailLoading && (
                    <div className="qo-vars">
                      {detailVars.map((v) => {
                        const out = v.stock_status === 'outofstock'
                        const price = Number(v.price) || 0
                        return (
                          <div key={v.id} className={'qo-var' + (out ? ' out' : '')}>
                            <span className="qo-var-combo">{v.attributes.map((a) => `${a.name}: ${a.option}`).join(' · ')}</span>
                            <span className="qo-var-meta">
                              <span className="qo-result-price">
                                {faNum(price)} {cur}
                              </span>
                              {out && <span className="chip">ناموجود</span>}
                            </span>
                            <button type="button" className="btn btn-soft btn-sm" disabled={out} onClick={() => addLine(picking, v)}>
                              <IconPlus size={14} /> افزودن
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {active.length > 0 ? (
              <div className="qo-lines">
                <div className="qo-line qo-line-head">
                  <span>کالا</span>
                  <span>قیمت واحد</span>
                  <span>تعداد</span>
                  <span>مبلغ</span>
                  <span />
                </div>
                {active.map((l) => {
                  const idx = lines.indexOf(l)
                  return (
                    <div className="qo-line" key={l.id ?? `${l.product_id}-${l.variation_id ?? 'x'}-${idx}`}>
                      <span style={{ minWidth: 0 }}>
                        <span className="qo-match-name">{l.name}</span>
                      </span>
                      <span className="num">{faNum(l.price)}</span>
                      <span className="qo-qty">
                        <button type="button" className="qo-qty-btn" onClick={() => setQty(idx, l.quantity - 1)} aria-label="کم‌کردن">
                          −
                        </button>
                        <input
                          className="qo-qty-input"
                          dir="ltr"
                          inputMode="numeric"
                          value={String(l.quantity)}
                          onChange={(e) => {
                            const n = Number(e.target.value.replace(/\D/g, ''))
                            if (!Number.isNaN(n)) setQty(idx, n)
                          }}
                        />
                        <button type="button" className="qo-qty-btn" onClick={() => setQty(idx, l.quantity + 1)} aria-label="افزودن">
                          +
                        </button>
                      </span>
                      <span className="num qo-line-total">{faNum(Math.round(l.price * l.quantity * 100) / 100)}</span>
                      <button type="button" className="btn-icon qo-remove" onClick={() => removeLine(idx)} aria-label="حذف قلم">
                        <IconTrash size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="qo-empty-items">
                <IconBox size={22} />
                هنوز کالایی به سفارش اضافه نشده — با جستجو شروع کنید.
              </div>
            )}
          </div>

          {/* ----------------------------- آدرس ------------------------------ */}
          <div className="pd-sec">
            <div className="pd-sec-title">آدرس</div>
            <div className="theme-seg" style={{ marginBottom: 14 }}>
              <button type="button" className={'theme-opt' + (addrTab === 'bill' ? ' active' : '')} onClick={() => setAddrTab('bill')}>
                صورتحساب
              </button>
              <button type="button" className={'theme-opt' + (addrTab === 'ship' ? ' active' : '')} onClick={() => setAddrTab('ship')}>
                ارسال
              </button>
            </div>

            {addrTab === 'bill' ? (
              addrFields(bill, setBill, true, 'oe-bill')
            ) : (
              <>
                <label className="chk-row" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={editShip} onChange={(e) => setEditShip(e.target.checked)} />
                  <span>آدرس ارسال جداگانه برای این سفارش ثبت شود</span>
                </label>
                {editShip && addrFields(ship, setShip, false, 'oe-ship')}
              </>
            )}
          </div>

          {/* جمع کل */}
          <div className="qo-sumbar" style={{ marginTop: 16 }}>
            <div className="qo-sumstats">
              <span>
                <b>{faNum(active.reduce((a, l) => a + l.quantity, 0))}</b> عدد کالا
              </span>
              <span>
                جمع اقلام: <b className="qo-sum-total">{faNum(total)}</b> {cur}
              </span>
            </div>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? (
                <>
                  <IconRefresh size={16} className="spin" /> در حال ذخیره…
                </>
              ) : (
                <>
                  <IconCheck size={16} /> ذخیره تغییرات
                </>
              )}
            </button>
          </div>

          <div className="f-hint" style={{ marginTop: 10 }}>
            مطابق جریان استاندارد ووکامرس، هنگام ذخیره وضعیت سفارش به «در انتظار پرداخت» برمی‌گردد، تغییرات اعمال می‌شود و سپس وضعیت
            قبلی دوباره برقرار می‌گردد.
          </div>

          {error && (
            <div className="notice err fade-in" style={{ marginTop: 12 }}>
              <IconAlert size={15} />
              <div>{error}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
