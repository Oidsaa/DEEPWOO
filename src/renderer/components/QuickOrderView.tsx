import { useEffect, useRef, useState } from 'react'
import type { ConnState, Coupon, Customer, Order, Product, ProductVariation } from '../../shared/types'
import { IR_PROVINCES } from '../../shared/iran'
import { api, isMock } from '../api'
import { normalizePhone } from '../../shared/phone'
import { avatarPalette, faDate, faDigits, faNum, orderStatusMeta } from '../lib/format'
import { useCurrency } from '../lib/currency'
import ReceiptModal from './ReceiptModal'
import {
  IconAlert,
  IconBag,
  IconBox,
  IconCheck,
  IconLayers,
  IconPlus,
  IconPrint,
  IconRefresh,
  IconSearch,
  IconStore,
  IconSwap,
  IconTrash,
  IconUserPlus,
  IconUsers,
  IconWallet,
  IconX,
} from './Icons'

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

interface QLine {
  key: number
  product: Product
  variation?: ProductVariation
  qty: number
}

type DeliveryMode = 'inperson' | 'shipped'
type PayMode = 'cash' | 'card' | 'snappay'

/** One picked order line, ready for the order payload. */
interface LinePick {
  product_id: number
  variation_id?: number
  quantity: number
}

const PAY_OPTIONS: Array<{ id: PayMode; fa: string; sub: string }> = [
  { id: 'cash', fa: 'نقدی', sub: 'پرداخت در محل فروشگاه' },
  { id: 'card', fa: 'کارت به کارت', sub: 'انتقال وجه کارت به کارت' },
  { id: 'snappay', fa: 'اقساطی (اسنپ‌پی)', sub: 'خرید اقساطی اسنپ‌پی' },
]

let keySeq = 1
const nextKey = () => keySeq++

export default function QuickOrderView({ configured, conn, storeName, onGoSettings }: Props) {
  const cur = useCurrency()
  /* ------------------------------ customer ------------------------------ */
  const [phone, setPhone] = useState('')
  const [custLoading, setCustLoading] = useState(false)
  const [custMatches, setCustMatches] = useState<Customer[] | null>(null) // null = lookup not done
  const [selectedCust, setSelectedCust] = useState<Customer | null>(null)
  const [newName, setNewName] = useState({ first: '', last: '' })
  const [showNewForm, setShowNewForm] = useState(false)

  /* ------------------------------- items -------------------------------- */
  const [prodQuery, setProdQuery] = useState('')
  const [prodLoading, setProdLoading] = useState(false)
  const [prodResults, setProdResults] = useState<Product[]>([])
  const [picking, setPicking] = useState<Product | null>(null) // variable product whose combos are shown
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailVars, setDetailVars] = useState<ProductVariation[]>([])
  const [lines, setLines] = useState<QLine[]>([])

  /* ---------------------------- delivery / pay -------------------------- */
  const [delivery, setDelivery] = useState<DeliveryMode>('inperson')
  const [addr, setAddr] = useState({ state: '', city: '', address1: '', address2: '', postcode: '' })
  const [pay, setPay] = useState<PayMode>('cash')
  const [coupon, setCoupon] = useState('')
  const [shipInput, setShipInput] = useState('')
  const [shipApplied, setShipApplied] = useState<number | null>(null)
  const [couponApplied, setCouponApplied] = useState<Coupon | null>(null)
  const [couponBusy, setCouponBusy] = useState(false)
  const [couponMsg, setCouponMsg] = useState<string | null>(null)

  /* ------------------------------- submit ------------------------------- */
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Order | null>(null)
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null)

  const phoneRef = useRef<HTMLInputElement | null>(null)
  const prodInputRef = useRef<HTMLInputElement | null>(null)

  const normPhone = normalizePhone(phone)
  const phoneReady = normPhone.length >= 10

  /* Debounced customer lookup by mobile. */
  useEffect(() => {
    if (!configured) return
    if (!phoneReady) {
      setCustMatches(null)
      setCustLoading(false)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      setCustLoading(true)
      api
        .listCustomers({ phone: normPhone })
        .then((r) => {
          if (cancelled) return
          setCustMatches(r.customers)
          // از مشتریان سایت بود؟ اگر فقط یک نفر با این شماره هست، همان را انتخاب کن.
          if (r.customers.length === 1) setSelectedCust(r.customers[0])
          setShowNewForm(false)
        })
        .catch(() => {
          if (cancelled) return
          setCustMatches([])
          setShowNewForm(true)
        })
        .finally(() => {
          if (!cancelled) setCustLoading(false)
        })
    }, 420)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, phoneReady, configured])

  /* Debounced product search. */
  useEffect(() => {
    const q = prodQuery.trim()
    if (!configured) return
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prodQuery, configured])

  /* Open the variation picker for a variable product (fetch its combinations). */
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

  /* -------------------------------- line ops ---------------------------- */
  const unitPrice = (p: Product, v?: ProductVariation): number =>
    Math.round((Number(v ? v.price : p.price) || 0) * 100) / 100

  const addLine = (p: Product, v?: ProductVariation, qty = 1) => {
    setError(null)
    setLines((prev) => {
      const hit = prev.find((l) => l.product.id === p.id && (l.variation?.id ?? -1) === (v?.id ?? -1))
      if (hit) return prev.map((l) => (l === hit ? { ...l, qty: l.qty + qty } : l))
      return [...prev, { key: nextKey(), product: p, variation: v, qty }]
    })
    if (p.type === 'variable') setPicking(null)
  }

  const setQty = (key: number, qty: number) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(999, qty)) } : l)))
  const removeLine = (key: number) => setLines((prev) => prev.filter((l) => l.key !== key))

  const lineCount = lines.reduce((a, l) => a + l.qty, 0)
  const total = Math.round(lines.reduce((a, l) => a + unitPrice(l.product, l.variation) * l.qty, 0) * 100) / 100

  /* ---------------------- shipping cost / coupon apply ------------------ */
  /** Local estimate of a coupon's discount — WooCommerce does the final math. */
  const couponDiscount = (c: Coupon, items: number, count: number): number => {
    const a = Number(c.amount) || 0
    const d = c.discount_type === 'percent' ? (items * a) / 100 : c.discount_type === 'fixed_product' ? a * count : a
    return Math.min(Math.round(d * 100) / 100, items)
  }

  const shipAmount = delivery === 'shipped' && shipApplied ? shipApplied : 0
  const discountAmount = couponApplied ? couponDiscount(couponApplied, total, lineCount) : 0
  const grandTotal = Math.max(0, Math.round((total - discountAmount + shipAmount) * 100) / 100)

  const applyShip = () => {
    const n = Math.round((Number(shipInput.replace(/[^\d.]/g, '')) || 0) * 100) / 100
    setShipApplied(n > 0 ? n : null)
  }

  const applyCoupon = async () => {
    const code = coupon.trim()
    if (!code || couponBusy) return
    setCouponBusy(true)
    setCouponMsg(null)
    try {
      const c = await api.findCoupon(code)
      setCouponApplied(c)
      if (!c) setCouponMsg(`کد تخفیف «${code}» در فروشگاه پیدا نشد.`)
    } catch (e) {
      setCouponApplied(null)
      setCouponMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setCouponBusy(false)
    }
  }

  const clearCoupon = () => {
    setCoupon('')
    setCouponApplied(null)
    setCouponMsg(null)
  }

  /* ----------------------------- customer pick -------------------------- */
  const pickCustomer = (c: Customer) => {
    setSelectedCust(c)
    setCustMatches(null)
    setShowNewForm(false)
    phoneRef.current?.focus()
  }

  const clearCustomer = () => {
    setSelectedCust(null)
    setCustMatches(null)
    setShowNewForm(false)
    setPhone('')
    phoneRef.current?.focus()
  }

  const custName = (c: Customer): string =>
    [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.username || c.email || `مشتری #${c.id}`
  const custPhone = (c: Customer): string => c.billing?.phone?.trim() || c.username || ''

  const initialsOf = (c: Customer): string => {
    const a = (c.first_name || c.username || '?').trim().charAt(0)
    const b = (c.last_name || '').trim().charAt(0)
    return (a + b).trim() || '؟'
  }

  /* -------------------------------- submit ------------------------------ */
  const lookupDoneNoMatch = phoneReady && custMatches !== null && custMatches.length === 0 && !custLoading

  const resetAll = () => {
    setPhone('')
    setSelectedCust(null)
    setCustMatches(null)
    setShowNewForm(false)
    setNewName({ first: '', last: '' })
    setLines([])
    setProdQuery('')
    setProdResults([])
    setPicking(null)
    setDelivery('inperson')
    setAddr({ state: '', city: '', address1: '', address2: '', postcode: '' })
    setPay('cash')
    setCoupon('')
    setCouponApplied(null)
    setCouponMsg(null)
    setShipInput('')
    setShipApplied(null)
    setError(null)
    setCreated(null)
    setReceiptOrder(null)
  }

  const submit = async () => {
    if (submitting) return
    setError(null)

    // Validation
    if (!phoneReady) {
      setError('شماره موبایل مشتری را کامل وارد کنید (حداقل ۱۰ رقم).')
      phoneRef.current?.focus()
      return
    }
    if (!selectedCust) {
      if (!newName.first.trim() || !newName.last.trim()) {
        setError('برای مشتری جدید، نام و نام خانوادگی را وارد کنید.')
        return
      }
    }
    if (lines.length === 0) {
      setError('حداقل یک قلم کالا به سفارش اضافه کنید.')
      return
    }
    if (delivery === 'shipped') {
      if (!addr.state || !addr.city.trim() || !addr.address1.trim()) {
        setError('برای سفارش ارسالی، استان، شهر و نشانی الزامی است.')
        return
      }
    }

    setSubmitting(true)
    try {
      let customer = selectedCust
      if (!customer) {
        // مشتری جدید — نام‌کاربری همان شمارهٔ موبایل است (بدون ایمیل قابل ساخت است).
        const first = newName.first.trim()
        const last = newName.last.trim()
        try {
          customer = await api.createCustomer({
            first_name: first,
            last_name: last,
            username: normPhone,
            billing: { first_name: first, last_name: last, phone: normPhone },
          })
        } catch (err) {
          // تلاش قبلی ممکن است مشتری را ساخته و وسط راه خطا داده باشد —
          // در این حالت همان حساب موجود از سایت بازیابی می‌شود.
          const msg = err instanceof Error ? err.message : String(err)
          if (/قبلا|ثبت شده|already|exist/i.test(msg)) {
            const r = await api.listCustomers({ phone: normPhone })
            if (!r.customers.length) throw err
            customer = r.customers[0]
          } else {
            throw err
          }
        }
        // همین‌جا انتخاب شود تا تلاش مجددِ ثبت سفارش، مشتری تکراری نسازد.
        setSelectedCust(customer)
        setCustMatches(null)
        setShowNewForm(false)
      }

      const bPhone = customer.billing?.phone?.trim() || normPhone
      const addrBlock = {
        state: addr.state,
        address_1: addr.address1.trim(),
        address_2: addr.address2.trim(),
        city: addr.city.trim(),
        postcode: addr.postcode.trim(),
        country: 'IR',
      }
      const billed = delivery === 'shipped'
      const lineItems: LinePick[] = lines.map((l) => ({
        product_id: l.product.id,
        ...(l.variation ? { variation_id: l.variation.id } : {}),
        quantity: l.qty,
      }))

      // وضعیت سفارش تابع نوع دریافت است: حضوری → «فروش حضوری»، ارسالی → «در حال انجام».
      // نقدی و کارت‌به‌کارت در محل تسویه می‌شوند؛ اقساطی اسنپ‌پی بدون تسویهٔ کامل ثبت می‌شود.
      const inPerson = delivery === 'inperson'
      const code = coupon.trim()
      const shipCost = shipApplied ?? 0
      const order = await api.createOrder({
        customer_id: customer.id,
        payment_method: pay === 'cash' ? 'pos-cash' : pay === 'card' ? 'pos-card' : 'snappay-installment',
        payment_method_title: PAY_OPTIONS.find((o) => o.id === pay)?.fa ?? pay,
        set_paid: pay !== 'snappay',
        status: inPerson ? 'sale-hazouri' : 'processing',
        billing: { first_name: customer.first_name, last_name: customer.last_name, phone: bPhone, ...(billed ? addrBlock : {}) },
        ...(billed ? { shipping: { first_name: customer.first_name, last_name: customer.last_name, ...addrBlock } } : {}),
        line_items: lineItems,
        ...(code ? { coupon_lines: [{ code }] } : {}),
        ...(billed && shipCost > 0
          ? { shipping_lines: [{ method_id: 'flat_rate', method_title: 'هزینهٔ ارسال', total: String(shipCost) }] }
          : {}),
      })
      setCreated(order)
      setCustMatches(null)
      setLines([])
      setProdQuery('')
      setPicking(null)
      setCoupon('')
      setCouponApplied(null)
      setCouponMsg(null)
      setShipInput('')
      setShipApplied(null)
      // سفارش ثبت شد — برای تحویلِ رسید به مشتری (مخصوصاً حضوری)، پیش‌نمایش رسید فروشگاه باز می‌شود.
      setReceiptOrder(order)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  /* --------------------------------- UI --------------------------------- */
  if (!configured) {
    return (
      <div className="page">
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber" style={{ marginInline: 'auto' }}>
              <IconBag size={28} />
            </div>
            <div className="empty-title">ثبت سفارش سریع</div>
            <div className="empty-sub">
              برای ثبت سریع سفارش، ابتدا فروشگاه و کلیدهای API را در تنظیمات وارد کنید یا دادهٔ آزمایشی را فعال
              کنید.
            </div>
            <div className="empty-action">
              <button type="button" className="btn btn-primary" onClick={onGoSettings}>
                رفتن به تنظیمات
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const pal = selectedCust ? avatarPalette(String(selectedCust.id) + selectedCust.username + selectedCust.email) : null

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">ثبت سفارش سریع</div>
          <div className="page-sub">
            ثبت فوری سفارش جدید — فروشگاه «{storeName ?? 'ووکامرس'}» {conn.state === 'fail' ? '· اتصال برقرار نیست' : ''}
          </div>
        </div>
        {created && (
          <div className="qo-created-chip fade-in">
            <IconCheck size={15} />
            سفارش <b>#{faDigits(created.number)}</b> ثبت شد
          </div>
        )}
      </div>

      {/* ------------------------------ ۱. مشتری ----------------------------- */}
      <section className="panel qo-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">
              <span className="qo-step">۱</span> مشتری
            </div>
            <div className="panel-sub">شماره موبایل را وارد کنید؛ اگر مشتری سایت بود خودکار انتخاب می‌شود.</div>
          </div>
          {selectedCust && (
            <span className="qo-cust-picked">
              <IconCheck size={13} /> {custName(selectedCust)}
            </span>
          )}
        </div>

        <div className="qo-body">
          {!selectedCust ? (
            <>
              <div className="field" style={{ position: 'relative' }}>
                <label className="lbl" htmlFor="qo-phone">
                  شمارهٔ موبایل <span className="req">*</span>
                </label>
                <div className="qo-phone-row">
                  <div className="search" style={{ flex: '0 1 320px' }}>
                    <span className="search-ic">
                      <IconSearch size={15} />
                    </span>
                    <input
                      ref={phoneRef}
                      id="qo-phone"
                      dir="ltr"
                      autoComplete="off"
                      value={phone}
                      onChange={(e) => {
                        setPhone(e.target.value)
                        if (selectedCust) clearCustomer()
                      }}
                      placeholder="۰۹۱۲…"
                      style={{ textAlign: 'start' }}
                    />
                  </div>
                  {custLoading && (
                    <span className="qo-searching">
                      <IconRefresh size={13} className="spin" /> در حال جستجو…
                    </span>
                  )}
                </div>
                <div className="f-hint">
                  {!phoneReady && custMatches === null
                    ? 'حداقل ۱۰ رقم — با پیش‌شمارهٔ ۰۹'
                    : lookupDoneNoMatch
                      ? `مشتری با شمارهٔ ${faDigits(normPhone)} در سایت پیدا نشد.`
                      : custMatches !== null && custMatches.length > 1
                        ? `${faNum(custMatches.length)} مشتری با این شماره پیدا شد — یکی را انتخاب کنید.`
                        : ''}
                </div>

                {/* انتخاب مشتری پیدا شده */}
                {custMatches && custMatches.length > 0 && !custLoading && (
                  <div className="qo-matches fade-in">
                    {custMatches.map((c) => {
                      const p = avatarPalette(String(c.id) + c.username + c.email)
                      return (
                        <button type="button" key={c.id} className="qo-match" onClick={() => pickCustomer(c)}>
                          <span className="u-avatar" style={{ color: p.color, background: p.bg }}>
                            {initialsOf(c)}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="qo-match-name">{custName(c)}</span>
                            <span className="qo-match-sub" dir="ltr">
                              {faDigits(custPhone(c))}
                            </span>
                          </span>
                          <span className="qo-match-meta">
                            {faNum(c.orders_count)} سفارش
                            {Number(c.total_spent) > 0 ? ` · ${faNum(c.total_spent)} ${cur}` : ''}
                          </span>
                          <IconUserPlus size={16} />
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* ساخت مشتری جدید */}
                {(lookupDoneNoMatch || showNewForm) && (
                  <div className="qo-new-cust fade-in">
                    <div className="qo-new-title">
                      <IconUserPlus size={15} />
                      مشتری جدید — با شمارهٔ <b dir="ltr">{faDigits(normPhone)}</b>
                    </div>
                    <div className="form-grid">
                      <div className="field">
                        <label className="lbl" htmlFor="qo-nfirst">
                          نام <span className="req">*</span>
                        </label>
                        <input
                          id="qo-nfirst"
                          className="input"
                          value={newName.first}
                          onChange={(e) => setNewName({ ...newName, first: e.target.value })}
                          placeholder="مثلاً علی"
                        />
                      </div>
                      <div className="field">
                        <label className="lbl" htmlFor="qo-nlast">
                          نام خانوادگی <span className="req">*</span>
                        </label>
                        <input
                          id="qo-nlast"
                          className="input"
                          value={newName.last}
                          onChange={(e) => setNewName({ ...newName, last: e.target.value })}
                          placeholder="مثلاً محمدی"
                        />
                      </div>
                    </div>
                    <div className="f-hint">
                      با ثبت سفارش، مشتری جدیدی با همین شماره در فروشگاه ساخته می‌شود (بدون نیاز به ایمیل).
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="qo-selected fade-in">
              <span className="u-avatar" style={{ color: pal!.color, background: pal!.bg }}>
                {initialsOf(selectedCust)}
              </span>
              <span style={{ minWidth: 0 }}>
                <div className="qo-sel-name">{custName(selectedCust)}</div>
                <div className="qo-sel-sub" dir="ltr">
                  {faDigits(custPhone(selectedCust))} · {faNum(selectedCust.orders_count)} سفارش قبلی
                </div>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearCustomer}>
                <IconUsers size={14} /> تغییر مشتری
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------ ۲. اقلام ----------------------------- */}
      <section className="panel qo-panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">
              <span className="qo-step">۲</span> اقلام سفارش
            </div>
            <div className="panel-sub">نام یا کد محصول را جستجو کنید؛ برای محصول متغیر، ترکیب دلخواه را انتخاب کنید.</div>
          </div>
          {lines.length > 0 && (
            <span className="qo-cust-picked">
              <IconBag size={13} /> {faNum(lineCount)} عدد — {faNum(total)} {cur}
            </span>
          )}
        </div>

        <div className="qo-body">
          <div className="qo-search-wrap">
            <div className="search">
              <span className="search-ic">
                <IconSearch size={15} />
              </span>
              <input
                ref={prodInputRef}
                dir="rtl"
                value={prodQuery}
                onChange={(e) => {
                  setProdQuery(e.target.value)
                  setPicking(null)
                  setError(null)
                }}
                placeholder="جستجوی محصول… (برای افزایش سرعت، کافی است چند حرف تایپ کنید)"
              />
              {prodQuery && (
                <button type="button" className="clear-btn" onClick={() => setProdQuery('')} aria-label="پاک‌کردن جستجو">
                  <IconX size={13} />
                </button>
              )}
            </div>

            {/* نتایج جستجو */}
            {prodQuery.trim().length > 0 && !picking && (
              <div className="qo-results fade-in">
                {prodLoading && (
                  <div className="qo-results-empty">
                    <IconRefresh size={15} className="spin" /> در حال جستجو…
                  </div>
                )}
                {!prodLoading && prodResults.length === 0 && (
                  <div className="qo-results-empty">محصولی با این نام پیدا نشد.</div>
                )}
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
                          {p.type === 'variable' ? 'محصول متغیر — انتخاب ترکیب' : p.categories[0]?.name ?? ''}
                        </span>
                      </span>
                      <span className="qo-result-price">{p.type === 'variable' ? '' : `${faNum(p.price)} ${cur}`}</span>
                      {p.type === 'variable' ? (
                        <span className="qo-add-txt">
                          <IconLayers size={14} /> ترکیب‌ها
                        </span>
                      ) : (
                        <span className="qo-add-txt">
                          <IconPlus size={14} /> افزودن
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            )}

            {/* ترکیب‌های محصول متغیر */}
            {picking && (
              <div className="qo-picking fade-in">
                <div className="qo-picking-head">
                  <div>
                    <div className="qo-match-name">{picking.name}</div>
                    <div className="qo-match-sub">همهٔ ترکیب‌های محصول — یکی را برای افزودن انتخاب کنید</div>
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
                {!detailLoading && detailVars.length === 0 && (
                  <div className="qo-results-empty">ترکیبی برای این محصول تعریف نشده است.</div>
                )}
                {!detailLoading && (
                  <div className="qo-vars">
                    {detailVars.map((v) => {
                      const out = v.stock_status === 'outofstock'
                      const price = Math.round((Number(v.price) || 0) * 100) / 100
                      return (
                        <div key={v.id} className={'qo-var' + (out ? ' out' : '')}>
                          <span className="qo-var-combo">{v.attributes.map((a) => `${a.name}: ${a.option}`).join(' · ')}</span>
                          <span className="qo-var-meta">
                            <span className="qo-result-price">
                              {faNum(price)} {cur}
                              {v.stock_quantity !== null ? ` · موجودی ${faNum(v.stock_quantity)}` : ''}
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

          {/* اقلام انتخاب‌شده */}
          {lines.length > 0 && (
            <div className="qo-lines">
              <div className="qo-line qo-line-head">
                <span>کالا</span>
                <span>قیمت واحد</span>
                <span>تعداد</span>
                <span>مبلغ</span>
                <span />
              </div>
              {lines.map((l) => {
                const unit = unitPrice(l.product, l.variation)
                const combo = l.variation
                  ? l.variation.attributes.map((a) => `${a.name}: ${a.option}`).join('، ')
                  : ''
                return (
                  <div className="qo-line" key={l.key}>
                    <span style={{ minWidth: 0 }}>
                      <span className="qo-match-name">{l.product.name}</span>
                      {combo && <span className="qo-match-sub">{combo}</span>}
                    </span>
                    <span className="num">{faNum(unit)}</span>
                    <span className="qo-qty">
                      <button type="button" className="qo-qty-btn" onClick={() => setQty(l.key, l.qty - 1)} aria-label="کم‌کردن">
                        −
                      </button>
                      <input
                        className="qo-qty-input"
                        dir="ltr"
                        inputMode="numeric"
                        value={String(l.qty)}
                        onChange={(e) => {
                          const n = Number(e.target.value.replace(/\D/g, ''))
                          if (!Number.isNaN(n)) setQty(l.key, n)
                        }}
                      />
                      <button type="button" className="qo-qty-btn" onClick={() => setQty(l.key, l.qty + 1)} aria-label="افزودن">
                        +
                      </button>
                    </span>
                    <span className="num qo-line-total">{faNum(Math.round(unit * l.qty * 100) / 100)}</span>
                    <button type="button" className="btn-icon qo-remove" onClick={() => removeLine(l.key)} aria-label="حذف قلم">
                      <IconTrash size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {lines.length === 0 && (
            <div className="qo-empty-items">
              <IconBag size={22} />
              هنوز کالایی به سفارش اضافه نشده — با جستجو شروع کنید.
            </div>
          )}
        </div>
      </section>

      {/* --------------------------- ۳ و ۴: ارسال و پرداخت ---------------------- */}
      <div className="qo-duo">
        <section className="panel qo-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">
                <span className="qo-step">۳</span> نحوهٔ دریافت
              </div>
              <div className="panel-sub">حضوری در فروشگاه یا ارسال به آدرس</div>
            </div>
          </div>
          <div className="qo-body">
            <div className="qo-seg">
              <button
                type="button"
                className={'qo-seg-btn' + (delivery === 'inperson' ? ' active' : '')}
                onClick={() => {
                  setDelivery('inperson')
                  setShipApplied(null)
                }}
              >
                <IconStore size={17} />
                <span>
                  <b>حضوری</b>
                  <small>تحویل در فروشگاه — بدون آدرس</small>
                </span>
              </button>
              <button
                type="button"
                className={'qo-seg-btn' + (delivery === 'shipped' ? ' active' : '')}
                onClick={() => setDelivery('shipped')}
              >
                <IconBox size={17} />
                <span>
                  <b>ارسالی</b>
                  <small>ارسال با پست / پیک</small>
                </span>
              </button>
            </div>

            {delivery === 'shipped' && (
              <div className="qo-addr fade-in">
                <div className="form-grid">
                  <div className="field">
                    <label className="lbl" htmlFor="qo-state">
                      استان <span className="req">*</span>
                    </label>
                    <select
                      id="qo-state"
                      className="sel"
                      style={{ width: '100%' }}
                      value={addr.state}
                      onChange={(e) => setAddr({ ...addr, state: e.target.value })}
                    >
                      <option value="" disabled>
                        انتخاب استان…
                      </option>
                      {IR_PROVINCES.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.fa}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="lbl" htmlFor="qo-city">
                      شهر <span className="req">*</span>
                    </label>
                    <input
                      id="qo-city"
                      className="input"
                      value={addr.city}
                      onChange={(e) => setAddr({ ...addr, city: e.target.value })}
                      placeholder="مثلاً تهران"
                    />
                  </div>
                  <div className="field">
                    <label className="lbl" htmlFor="qo-addr1">
                      نشانی <span className="req">*</span>
                    </label>
                    <input
                      id="qo-addr1"
                      className="input"
                      value={addr.address1}
                      onChange={(e) => setAddr({ ...addr, address1: e.target.value })}
                      placeholder="خیابان، کوچه، پلاک"
                    />
                  </div>
                  <div className="field">
                    <label className="lbl" htmlFor="qo-addr2">
                      ادامهٔ آدرس
                    </label>
                    <input
                      id="qo-addr2"
                      className="input"
                      value={addr.address2}
                      onChange={(e) => setAddr({ ...addr, address2: e.target.value })}
                      placeholder="واحد، طبقه (اختیاری)"
                    />
                  </div>
                  <div className="field">
                    <label className="lbl" htmlFor="qo-postcode">
                      کدپستی <span className="f-hint-inline">(اختیاری)</span>
                    </label>
                    <input
                      id="qo-postcode"
                      className="input ltr"
                      dir="ltr"
                      inputMode="numeric"
                      value={addr.postcode}
                      onChange={(e) => setAddr({ ...addr, postcode: e.target.value })}
                      placeholder="10 رقمی"
                    />
                  </div>
                </div>

                <div className="field" style={{ marginTop: 12 }}>
                  <label className="lbl" htmlFor="qo-shipcost">
                    هزینهٔ ارسال <span className="f-hint-inline">(اختیاری)</span>
                  </label>
                  <div className="qo-apply-row">
                    <input
                      id="qo-shipcost"
                      className="input ltr"
                      dir="ltr"
                      inputMode="decimal"
                      autoComplete="off"
                      value={shipInput}
                      onChange={(e) => setShipInput(e.target.value)}
                      placeholder="0"
                    />
                    <button type="button" className="btn btn-soft" onClick={applyShip} disabled={!shipInput.trim()}>
                      <IconCheck size={14} /> اعمال
                    </button>
                  </div>
                  <div className="f-hint">
                    {shipApplied !== null
                      ? `اعمال شد — ${faNum(shipApplied)} ${cur} به مبلغ نهایی اضافه می‌شود.`
                      : 'مبلغ را وارد کنید و «اعمال» را بزنید تا در مبلغ نهایی دیده شود.'}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="panel qo-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">
                <span className="qo-step">۴</span> نحوهٔ پرداخت
              </div>
              <div className="panel-sub">روش تسویهٔ این سفارش</div>
            </div>
          </div>
          <div className="qo-body">
            <div className="qo-seg qo-pays">
              {PAY_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={'qo-seg-btn' + (pay === o.id ? ' active' : '')}
                  onClick={() => setPay(o.id)}
                >
                  {o.id === 'cash' ? <IconWallet size={17} /> : o.id === 'card' ? <IconSwap size={17} /> : <IconLayers size={17} />}
                  <span>
                    <b>{o.fa}</b>
                    <small>{o.sub}</small>
                  </span>
                </button>
              ))}
            </div>
            <div className="f-hint" style={{ marginTop: 2 }}>
              {pay === 'cash' || pay === 'card'
                ? 'نقدی / کارت‌به‌کارت — مبلغ همان‌جا دریافت و سفارش پرداخت‌شده ثبت می‌شود.'
                : 'اقساطی اسنپ‌پی — پرداخت کامل انجام نشده و سفارش بدون تسویه ثبت می‌شود.'}
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label className="lbl" htmlFor="qo-coupon">
                کد تخفیف <span className="f-hint-inline">(اختیاری)</span>
              </label>
              <div className="qo-apply-row">
                <input
                  id="qo-coupon"
                  className="input ltr"
                  dir="ltr"
                  autoComplete="off"
                  value={coupon}
                  onChange={(e) => {
                    const v = e.target.value
                    setCoupon(v)
                    if (couponApplied && v.trim().toLowerCase() !== couponApplied.code.toLowerCase()) {
                      setCouponApplied(null)
                      setCouponMsg(null)
                    }
                  }}
                  placeholder="WELCOME10"
                  disabled={couponBusy}
                />
                {couponApplied ? (
                  <button type="button" className="btn btn-ghost" onClick={clearCoupon} disabled={couponBusy}>
                    <IconX size={14} /> حذف
                  </button>
                ) : (
                  <button type="button" className="btn btn-soft" onClick={applyCoupon} disabled={couponBusy || !coupon.trim()}>
                    {couponBusy ? <IconRefresh size={14} className="spin" /> : <IconCheck size={14} />}
                    {couponBusy ? 'بررسی…' : 'اعمال'}
                  </button>
                )}
              </div>
              <div className="f-hint">
                {couponApplied
                  ? `اعمال شد — تخفیف حدود ${faNum(discountAmount)} ${cur} از مبلغ نهایی کسر می‌شود.`
                  : 'کد را وارد و اعمال کنید تا تخفیف در مبلغ نهایی دیده شود.'}
              </div>
              {couponMsg && <div className="f-hint qo-coupon-err">{couponMsg}</div>}
            </div>
          </div>
        </section>
      </div>

      {/* ------------------------------- ثبت سفارش ---------------------------- */}
      <div className="qo-sumbar">
        <div className="qo-sumstats">
          <span>
            <b>{faNum(lineCount)}</b> عدد کالا
          </span>
          {shipAmount > 0 && (
            <span>
              هزینهٔ ارسال: <b>{faNum(shipAmount)}</b> {cur}
            </span>
          )}
          {discountAmount > 0 && (
            <span>
              تخفیف: <b className="od-discount">−{faNum(discountAmount)}</b> {cur}
            </span>
          )}
          <span>
            مبلغ نهایی: <b className="qo-sum-total">{faNum(grandTotal)}</b> {cur}
          </span>
          <span
            className={"pill " + (delivery === 'inperson' ? 'pill-green' : 'pill-teal')}
            style={{ alignSelf: 'center' }}
            title="وضعیتی که سفارش با آن ثبت می‌شود"
          >
            {delivery === 'inperson' ? 'فروش حضوری' : orderStatusMeta('processing').fa}
          </span>
        </div>
        <button type="button" className="btn btn-primary qo-submit" onClick={submit} disabled={submitting || !configured}>
          {submitting ? (
            <>
              <IconRefresh size={16} className="spin" /> در حال ثبت…
            </>
          ) : (
            <>
              <IconCheck size={16} /> ثبت سفارش {created ? '— سفارش بعدی' : ''}
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="notice err fade-in">
          <IconAlert size={15} />
          <div>{error}</div>
        </div>
      )}

      {created && (
        <div className="notice ok fade-in">
          <IconCheck size={15} />
          <div style={{ flex: 1 }}>
            سفارش <b>#{faDigits(created.number)}</b> برای «
            {created.customer_name ||
              [created.billing?.first_name, created.billing?.last_name].filter(Boolean).join(' ') ||
              '—'}
            » ثبت شد ({orderStatusMeta(created.status).fa}، {faDate(created.date_created)}).
          </div>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setReceiptOrder(created)}>
            <IconPrint size={14} /> چاپ رسید فروشگاه
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>
            <IconPlus size={14} /> سفارش جدید
          </button>
        </div>
      )}

      {isMock && created && !receiptOrder && (
        <div className="notice amber">
          <IconAlert size={15} />
          <div>دادهٔ آزمایشی: سفارش فقط در همین پیش‌نمایش ثبت شده و چاپ واقعی در نسخهٔ دسکتاپ انجام می‌شود.</div>
        </div>
      )}

      {receiptOrder && <ReceiptModal order={receiptOrder} initialType="store" onClose={() => setReceiptOrder(null)} />}
    </div>
  )
}