import type { Order, OrderNote, ReceiptType } from '../../shared/types'
import { faDate, faDigits, faNum, faTime } from './format'

/** Result of building one receipt document. */
export interface ReceiptDoc {
  type: ReceiptType
  html: string
  /** Paper width in mm (set as @page width). */
  widthMm: number
  /** Paper height in mm — grows for warehouse/store with the item count. */
  heightMm: number
  landscape: boolean
  itemCount: number
}

/** Store identity printed on the receipts (from the settings panel). */
export interface ReceiptShop {
  name: string
  domain: string
  address?: string
  postcode?: string
  phone?: string
  logo?: string
}

const mm = (n: number): number => Math.round(n * 10) / 10

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Label of each receipt kind (for the picker). */
export const RECEIPT_KINDS: Array<{ type: ReceiptType; fa: string; sub: string; widthMm: number }> = [
  { type: 'store', fa: 'رسید فروشگاه', sub: 'فیش حرارتی ۸ سانتی‌متر', widthMm: 80 },
  { type: 'postal', fa: 'رسید پستی', sub: 'برچسب ۲۱ × ۴٫۲ سانتی‌متر', widthMm: 210 },
  { type: 'warehouse', fa: 'رسید انبارداری', sub: 'برچسب ۱۰ × ۴٫۲ سانتی‌متر', widthMm: 100 },
]

/* ------------------------------------------------------------------ */
/* Order helpers shared by every receipt                               */
/* ------------------------------------------------------------------ */

/** «استان، شهر، ادامهٔ آدرس» — کدپستی عمداً در این قالب نمی‌آید. */
function faAddress(state?: string, city?: string, rest?: string): string {
  return [state, city, rest].map((v) => (v ?? '').trim()).filter(Boolean).join('، ')
}

function deliveryAddress(order: Order) {
  const bill = order.billing ?? {}
  const ship = order.shipping
  const isShip = !!ship && JSON.stringify(ship) !== JSON.stringify({
    first_name: bill.first_name, last_name: bill.last_name, address_1: bill.address_1,
    address_2: bill.address_2, city: bill.city, state: bill.state, postcode: bill.postcode, country: bill.country,
  })
  const a = isShip ? ship! : bill
  const addr = [a.address_1, a.address_2].filter(Boolean).join('، ')
  const shipPhone = (a as { phone?: string }).phone
  return {
    name:
      order.customer_name ||
      [bill.first_name, bill.last_name].filter(Boolean).join(' ').trim() ||
      `مشتری #${order.customer_id || ''}`,
    phone: shipPhone || bill.phone || '',
    addr,
    city: a.city || '',
    state: a.state || '',
    postcode: a.postcode || '',
    isShip,
  }
}

/** One printable line item (name + variations, unit price, qty, total). */
function lineRows(order: Order) {
  return order.line_items.map((l) => {
    const meta = (l.meta_data ?? [])
      .filter((m) => !String(m.key ?? '').startsWith('_'))
      .map((m) => `${m.display_key || m.key}: ${m.display_value || m.value}`)
    const q = Number(l.quantity) || 0
    let unit = l.price !== undefined && l.price !== '' ? Number(l.price) : null
    if (unit === null && q > 0) unit = Math.round(((Number(l.total) || 0) / q) * 100) / 100
    return { name: l.name || '—', meta, qty: q, unit, total: Number(l.total) || 0, sku: l.sku }
  })
}

function totalsOf(order: Order) {
  const items = Number(order.line_items.reduce((a, l) => a + (Number(l.total) || 0), 0)) || 0
  const discount = Number(order.discount_total) || 0
  const shipping = Number(order.shipping_total) || 0
  return {
    items: Math.round(items * 100) / 100,
    discount: Math.round(discount * 100) / 100,
    shipping: Math.round(shipping * 100) / 100,
    total: Number(order.total) || 0,
  }
}

/* ------------------------------------------------------------------ */
/* Shared page chrome                                                  */
/* ------------------------------------------------------------------ */

function pageHtml(widthMm: number, heightMm: number, _landscape: boolean, body: string): string {
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/>
<title>چاپ رسید</title>
<style>
  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { width: ${widthMm}mm; height: ${heightMm}mm; overflow: hidden; direction: rtl;
    font-family: 'Vazirmatn', 'Tahoma', 'Segoe UI', sans-serif; color: #111; }
  .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }
  table { border-collapse: collapse; width: 100%; }
  .dash { border: 0; border-top: 1px dashed #9aa0a6; margin: 1.2mm 0; }
</style></head><body>${body}</body></html>`
}

const num = (n: number): string => faNum(n)

/* ------------------------------------------------------------------ */
/* Store receipt — 80 mm thermal roll (no height limit)                */
/* ------------------------------------------------------------------ */

export function storeReceiptHtml(order: Order, shop: ReceiptShop): ReceiptDoc {
  const rows = lineRows(order)
  const t = totalsOf(order)
  const w = RECEIPT_KINDS[0].widthMm // 80mm
  const ship = deliveryAddress(order)
  const logo = shop.logo ? `<img class="shop-logo" src="${esc(shop.logo)}" alt=""/>` : ''
  // خرید حضوری: بدون ارسال و بدون جمع اقلام — فقط تخفیف (در صورت وجود) و جمع نهایی.
  const discWord = t.discount > 0 ? `<div class="line"><span>تخفیف</span><b class="num">−${num(t.discount)}</b></div>` : ''
  const supportWord = shop.phone ? `<div class="foot-tel num">پشتیبانی: ${faDigits(shop.phone)}</div>` : ''

  const itemsHtml = rows
    .map((r) => {
      const varTxt = r.meta.length ? `<div class="var">${esc(r.meta.join(' | '))}</div>` : ''
      const skuTxt = r.sku ? `<div class="var">${esc(r.sku)}</div>` : ''
      return `<div class="item">
        <div class="iname">${esc(r.name)}${varTxt}${skuTxt}</div>
        <div class="iqty num">${num(r.qty)}</div>
        <div class="itotal num">${num(r.total)}</div>
      </div>`
    })
    .join('')

  // No height limit on the thermal roll: budget each block conservatively so
  // long names/variations never clip — a few mm of slack is fine on a roll.
  const metaCount = 3 + (ship.phone ? 1 : 0)
  const headMm = (shop.logo ? 8.5 : 0) + 5.7 + 3.8 + 1.2
  const rowsMm = rows.reduce((a, r) => {
    const all = [r.name, r.meta.join('، '), r.sku].filter(Boolean).join(' — ')
    // 80mm roll → the name column is ~37mm ≈ 15 Persian chars per line.
    return a + 6.2 + 3.6 * Math.max(0, estLines(all, 15) - 1)
  }, 0)
  const totalsRows = 1 + (discWord ? 1 : 0)
  const totalsMm = totalsRows * 3.8 + Math.max(0, totalsRows - 1) * 1.1 + 4.6 + 1.2
  const footMm = 4.4 + (supportWord ? 3.4 : 0) + 1.2
  const h = mm(
    6 + headMm + 2.7 + metaCount * 3.8 + (metaCount - 1) * 1.1 + 2.7 + 3.9 + rowsMm + 2.7 + totalsMm + 2.7 + footMm + 4,
  )

  const body = `
  <div class="sheet store">
    <div class="store-head">
      ${logo}
      <div class="shop">${esc(shop.name || shop.domain || 'فروشگاه')}</div>
      <div class="site">${esc(shop.domain)}</div>
    </div>
    <hr class="dash"/>
    <div class="meta">
      <div class="line"><span>سفارش</span><b class="num">#${faDigits(order.number)}</b></div>
      <div class="line"><span>تاریخ</span><b>${faDate(order.date_created)} — ${faTime(new Date(order.date_created))}</b></div>
      <div class="line"><span>مشتری</span><b>${esc(ship.name)}</b></div>
      ${ship.phone ? `<div class="line"><span>موبایل</span><b class="num">${faDigits(ship.phone)}</b></div>` : ''}
    </div>
    <hr class="dash"/>
    <div class="items">
      <div class="item item-head">
        <div class="iname">اقلام سفارش (${num(rows.length)})</div>
        <div class="iqty">تعداد</div>
        <div class="itotal">مبلغ</div>
      </div>
      ${itemsHtml}
    </div>
    <hr class="dash"/>
    <div class="totals">
      ${discWord}
      <div class="line total"><span>مجموع سفارش</span><b class="num">${num(t.total)}</b></div>
    </div>
    <hr class="dash"/>
    <div class="foot">
      <div>ممنون از خرید شما — ${esc(shop.name || shop.domain)}</div>
      ${supportWord}
    </div>
  </div>
  <style>
    .sheet.store { padding: 3mm 3.2mm 2.6mm; font-size: 9.2px; color:#000; }
    .sheet.store .store-head { text-align: center; }
    .store-head .shop-logo { max-height: 11mm; max-width: 50mm; object-fit: contain; margin-bottom: 0.8mm; }
    .store-head .shop { font-size: 13.5px; font-weight: 800; }
    .store-head .site { font-size: 8.6px; color: #555; margin-top: 0.4mm; direction: ltr; }
    .sheet.store .meta, .sheet.store .totals { display: flex; flex-direction: column; gap: 1mm; }
    .sheet.store .line { display: flex; align-items: baseline; justify-content: space-between; gap: 2mm; font-size: 9.2px; }
    .sheet.store .line b { font-weight: 700; text-align: left; }
    .sheet.store .items { display: flex; flex-direction: column; }
    .sheet.store .item { display: flex; align-items: center; gap: 2mm; padding: 1.2mm 0; border-bottom: 1px dotted #ccc; }
    .sheet.store .item-head { font-weight: 800; font-size: 9.4px; border-bottom: 1px solid #000; padding-bottom: 0.6mm; }
    .sheet.store .item .iname { flex: 1; min-width: 0; line-height: 1.45; }
    .sheet.store .item .iqty { font-size: 8.4px; color: #333; white-space: nowrap; min-width: 7mm; text-align: center; }
    .sheet.store .item .itotal { white-space: nowrap; font-weight: 700; width: 24mm; text-align: left; }
    .sheet.store .item .var { font-size: 7.8px; color: #444; }
    .sheet.store .item-head .iqty { color: #000; }
    .sheet.store .total { border-top: 1px solid #000; padding-top: 1mm; margin-top: 0.6mm; font-size: 11px; font-weight: 800; }
    .sheet.store .total b { font-size: 12.5px; }
    .sheet.store .foot { text-align: center; font-size: 8.4px; color: #333; padding-top: 0.4mm; display: flex; flex-direction: column; gap: 0.5mm; }
    .sheet.store .foot-tel { font-size: 8px; color: #444; }
  </style>`

  return { type: 'store', html: pageHtml(w, h, false, body), widthMm: w, heightMm: h, landscape: false, itemCount: rows.length }
}

/* ------------------------------------------------------------------ */
/* Postal label — 210 × 42 mm, split exactly in half:                  */
/* right = گیرنده (buyer), left = فرستنده (store from settings)        */
/* ------------------------------------------------------------------ */

export function postalReceiptHtml(order: Order, shop: ReceiptShop): ReceiptDoc {
  const w = 210
  const h = 42
  const ship = deliveryAddress(order)
  const addrFull = faAddress(ship.state, ship.city, ship.addr)
  const rows = lineRows(order)

  const recvPhone = ship.phone ? `<span class="sep">|</span><span class="h-phone num">شماره تماس: ${faDigits(ship.phone)}</span>` : ''
  const shopLine = [
    shop.postcode ? `کدپستی: ${faDigits(shop.postcode)}` : '',
    shop.phone ? `تلفن پشتیبانی: ${faDigits(shop.phone)}` : '',
  ]
    .filter(Boolean)
    .join(' | ')

  const body = `
  <div class="sheet postal">
    <div class="air">
      <div class="air-in">
        <div class="h-label">گیرنده</div>
        <div class="h-line">
          <span class="num h-code">${faDigits(order.number)}</span><span class="sep">|</span>
          <b class="h-name">${esc(ship.name)}</b>${recvPhone}
        </div>
        <div class="h-addr">${esc(addrFull || '—')}</div>
        ${ship.postcode ? `<div class="h-post">کدپستی: <b class="num">${faDigits(ship.postcode)}</b></div>` : ''}
      </div>
    </div>
    <div class="air">
      <div class="air-in">
        <div class="h-label">فرستنده</div>
        <div class="h-name s-name">${esc(shop.name || shop.domain || 'فروشگاه')}</div>
        ${shop.address ? `<div class="h-addr">${esc(shop.address)}</div>` : ''}
        ${shopLine ? `<div class="h-post">${shopLine}</div>` : ''}
      </div>
    </div>
  </div>
  <style>
    .sheet.postal { display: flex; gap: 2mm; padding: 2.4mm 3mm; font-size: 9px; color: #000; }
    .air { flex: 1 1 0; min-width: 0; padding: 1.3mm;
      background: repeating-linear-gradient(45deg, #b91c1c 0 2.3mm, #1e50c0 2.3mm 4.6mm); }
    .air-in { background: #fff; height: 100%; box-sizing: border-box; padding: 1.7mm 2.4mm;
      display: flex; flex-direction: column; justify-content: center; gap: 0.5mm; text-align: right; }
    .h-label { font-size: 10px; font-weight: 900; margin-bottom: 0.4mm; }
    .h-line { line-height: 1.45; white-space: nowrap; }
    .h-code { font-weight: 800; font-size: 10.5px; }
    .h-name { font-size: 13px; font-weight: 900; margin: 0 0.4mm; }
    .h-phone { font-size: 9px; color: #222; }
    .sep { color: #9aa0a6; margin: 0 0.8mm; }
    .h-addr { font-size: 8.8px; line-height: 1.55; color: #111; }
    .h-post { font-size: 9.3px; font-weight: 700; margin-top: 0.3mm; }
    .s-name { font-size: 12px; }
  </style>`

  return { type: 'postal', html: pageHtml(w, h, true, body), widthMm: w, heightMm: h, landscape: true, itemCount: rows.length }
}

/* ------------------------------------------------------------------ */
/* Warehouse label — 100 mm wide, 42 mm tall for ≤2 items; the height  */
/* grows so items AND notes always fit (no clipping).                  */
/* ------------------------------------------------------------------ */

/** Rough text lines a string needs on the label width (Persian ≈ narrow glyphs). */
function estLines(text: string, perLine = 24): number {
  return Math.max(1, Math.ceil((String(text).length + 4) / perLine))
}

// این فاکتور پیش خود فروشگاه می‌ماند؛ نام فروشگاه روی آن چاپ نمی‌شود.
export function warehouseReceiptHtml(order: Order, _shop: ReceiptShop, notes: OrderNote[] = []): ReceiptDoc {
  const rows = lineRows(order)
  const w = 100
  const ship = deliveryAddress(order)
  const addrFull = faAddress(ship.state, ship.city, ship.addr)
  const t = totalsOf(order)

  // یادداشت مدیر = نوشتهٔ یک ادمین (غیرسیستم و غیرمشتری)؛ یادداشت مشتری =
  // علامت‌گذاری‌شده برای مشتری + یادداشت ثبت‌شده هنگام خرید (order.customer_note)
  // که در فروشگاه‌های واقعی ممکن است فقط در همین فیلد نگهداری شود.
  const adminNotes = notes.filter((n) => n.added_by_user && !n.customer_note)
  const checkoutNote = (order.customer_note || '').trim()
  const customerNotes = notes.filter((n) => n.customer_note)
  if (checkoutNote && !customerNotes.some((n) => n.note === checkoutNote)) {
    customerNotes.push({
      id: -1,
      author: 'مشتری',
      date_created: order.date_created,
      note: checkoutNote,
      customer_note: true,
      added_by_user: false,
    })
  }

  // Base 42mm fits the header + ≈2 single-line items; everything below adds height
  // so items and notes are NEVER clipped (a couple of mm of slack is fine on labels).
  let extra = 0
  if (rows.length > 2) extra += (rows.length - 2) * 5.8
  for (const r of rows) {
    const nmLines = estLines(`${r.name}${r.meta.length ? ' — ' + r.meta.join('، ') : ''}`, 26)
    if (nmLines > 1) extra += (nmLines - 1) * 3.4
  }
  const addrLines = estLines(addrFull, 26)
  if (addrLines > 1) extra += (addrLines - 1) * 3.5
  if (ship.postcode) extra += 3.3
  const noteExtra = (list: OrderNote[]): number =>
    list.length ? 4.2 + list.reduce((a, n) => a + 4.2 + estLines(n.note, 30) * 3.5, 0) : 0
  extra += noteExtra(adminNotes) + noteExtra(customerNotes)
  const h = mm(Math.max(42, 42 + extra + 1))

  const noteBlock = (list: OrderNote[], title: string): string =>
    list.length
      ? `<div class="wh-notes">
          <div class="wh-note-title">${title}</div>
          ${list
            .map(
              (n) =>
                `<div class="wh-note"><div class="wh-note-txt">${esc(n.note)}</div>` +
                `<div class="wh-note-d">${faDate(n.date_created)} — ${esc(n.author)}</div></div>`,
            )
            .join('')}
        </div>`
      : ''

  const itemsHtml = rows
    .map((r, i) => {
      const varTxt = r.meta.length ? `<span class="wh-var">${esc(r.meta.join(' | '))}</span>` : ''
      return `<div class="wh-row">
        <span class="idx">${num(i + 1)}</span>
        <span class="nm">${esc(r.name)}${varTxt}</span>
        <span class="qt"><b class="num">${num(r.qty)}</b> عدد</span>
      </div>`
    })
    .join('')

  const body = `
  <div class="sheet wh">
    <div class="wh-top">
      <div class="wh-title">رسید انبارداری</div>
      <div class="wh-order"><span>سفارش</span><b class="num">#${faDigits(order.number)}</b></div>
    </div>
    <div class="wh-cust">
      <div class="wh-line"><span class="lbl">گیرنده</span><b>${esc(ship.name)}</b>
        ${ship.phone ? `<span class="num">${faDigits(ship.phone)}</span>` : ''}</div>
      <div class="wh-line addr">${esc(addrFull || '—')}</div>
      ${ship.postcode ? `<div class="wh-line post"><span class="lbl">کد پستی</span><b class="num">${faDigits(ship.postcode)}</b></div>` : ''}
      <div class="wh-line small"><span>تاریخ ${faDate(order.date_created)} ${faTime(new Date(order.date_created))}</span></div>
    </div>
    <div class="wh-head"><span>اقلام</span><span>تعداد</span></div>
    <div class="wh-rows">${itemsHtml}</div>
    ${noteBlock(adminNotes, 'یادداشت مدیر فروشگاه')}
    ${noteBlock(customerNotes, 'یادداشت مشتری')}
    <div class="wh-foot">
      <span>تعداد اقلام: <b class="num">${num(rows.reduce((a, r) => a + r.qty, 0))}</b></span>
      <span>مبلغ نهایی سفارش: <b class="num">${num(t.total)}</b></span>
    </div>
  </div>
  <style>
    .sheet.wh { display: flex; flex-direction: column; padding: 2.6mm 3.2mm 2.2mm; font-size: 9.4px; color: #000; }
    .wh-top { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1.6px solid #000; padding-bottom: 0.7mm; }
    .wh-title { font-size: 13.5px; font-weight: 900; }
    .wh-order b { font-size: 11.5px; }
    .wh-cust { padding: 1.1mm 0 0.8mm; display: flex; flex-direction: column; gap: 0.5mm; }
    .wh-line { font-size: 9.6px; line-height: 1.35; }
    .wh-line .lbl { font-weight: 800; margin-left: 1mm; }
    .wh-line b { font-weight: 800; }
    .wh-line.addr { font-size: 8.8px; color: #1a1a1a; }
    .wh-line.post { font-size: 9.4px; }
    .wh-line.post .lbl { font-weight: 700; color: #444; }
    .wh-line.post b { font-size: 10.5px; }
    .wh-line.small { font-size: 8.4px; color: #444; }
    .wh-head { display: flex; justify-content: space-between; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 0.3mm 0; font-weight: 800; font-size: 9px; }
    .wh-rows { display: flex; flex-direction: column; }
    .wh-row { display: flex; align-items: flex-start; gap: 1.6mm; padding: 0.55mm 0; border-bottom: 0.5px dotted #bbb; }
    .wh-row .idx { width: 4mm; color: #444; font-size: 8.6px; padding-top: 0.4mm; }
    .wh-row .nm { flex: 1; min-width: 0; line-height: 1.35; white-space: normal; overflow: hidden; }
    .wh-var { display: block; font-size: 7.8px; color: #555; }
    .wh-row .qt { white-space: nowrap; font-size: 9.4px; padding-top: 0.4mm; }
    .wh-notes { border-top: 1px solid #000; margin-top: 0.7mm; padding-top: 0.6mm; }
    .wh-note-title { font-size: 9px; font-weight: 900; margin-bottom: 0.3mm; }
    .wh-note { padding: 0.4mm 0 0.6mm; border-bottom: 0.5px dotted #bbb; }
    .wh-note-txt { font-size: 8.4px; line-height: 1.5; color: #111; white-space: normal; overflow: hidden; }
    .wh-note-d { font-size: 7.4px; color: #555; margin-top: 0.2mm; }
    .wh-foot { display: flex; justify-content: space-between; gap: 3mm; padding-top: 0.9mm; border-top: 1.6px solid #000; font-size: 9.6px; font-weight: 700; }
  </style>`

  return { type: 'warehouse', html: pageHtml(w, h, false, body), widthMm: w, heightMm: h, landscape: false, itemCount: rows.length }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function buildReceiptDoc(
  order: Order,
  type: ReceiptType,
  shop: ReceiptShop,
  notes: OrderNote[] = [],
): ReceiptDoc {
  if (type === 'postal') return postalReceiptHtml(order, shop)
  if (type === 'warehouse') return warehouseReceiptHtml(order, shop, notes)
  return storeReceiptHtml(order, shop)
}