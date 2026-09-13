import type { Order, OrderNote } from '../../shared/types'
import { warehouseReceiptHtml, sheetBodyOf, sheetInnerOf, type ReceiptShop } from './print'

const PX_MM = 96 / 25.4

/**
 * Natural content height (mm, without the fixed page height) of every .sheet
 * in one measuring pass — a hidden iframe lays all labels out at height:auto.
 * Returns [] when measurement is impossible; callers fall back to estimates.
 */
async function measureSheetHeightsMm(html: string, widthMm: number): Promise<number[]> {
  if (typeof document === 'undefined') return []
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = `position:fixed; left:-10000px; top:0; width:${widthMm}mm; height:10px; border:none; visibility:hidden;`
  const loaded = new Promise<void>((resolve) => {
    frame.onload = () => resolve()
    frame.onerror = () => resolve()
  })
  frame.srcdoc = html
  document.body.appendChild(frame)
  try {
    const timeout = new Promise<void>((r) => window.setTimeout(r, 2000))
    await Promise.race([loaded, timeout])
    const doc = frame.contentDocument
    if (!doc) return []
    return Array.from(doc.querySelectorAll<HTMLElement>('.sheet')).map((el) => {
      const prev = el.style.height
      el.style.height = 'auto'
      const h = el.getBoundingClientRect().height / PX_MM
      el.style.height = prev
      return h
    })
  } finally {
    frame.remove()
  }
}

/**
 * Exact height for every warehouse label = natural content height + 10mm blank
 * bottom strip (never clipped, no giant white tail from wrap estimates).
 */
export async function measureWarehouseHeights(
  orders: Order[],
  shop: ReceiptShop,
  notesOf: (orderId: number) => OrderNote[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>()
  if (orders.length === 0) return out
  const docs = orders.map((o) => warehouseReceiptHtml(o, shop, notesOf(o.id)))
  const skin = docs.length ? sheetInnerOf(docs[0].html) : ''
  const bodies = docs
    .map((d, i) => `<div class="mwrap" data-oid="${orders[i].id}">${sheetBodyOf(d.html)}</div>`)
    .join('')
  const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { margin: 0; background: #fff; }
    .num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }
    .mwrap { width: 100mm; font-family: 'Vazirmatn', 'Tahoma', 'Segoe UI', sans-serif; color: #000; }
    .mwrap .sheet { height: auto !important; }
  </style>${skin}</head><body>${bodies}</body></html>`
  const heights = await measureSheetHeightsMm(html, 100)
  docs.forEach((_, i) => {
    const h = heights[i]
    if (typeof h === 'number' && h > 0) out.set(orders[i].id, Math.max(42, Math.ceil((h + 10) * 10) / 10))
  })
  return out
}

/** Exact height (natural content + 10mm blank bottom) of ONE warehouse label. */
export async function measureWarehouseHeight(
  order: Order,
  shop: ReceiptShop,
  notes: OrderNote[],
): Promise<number | null> {
  const m = await measureWarehouseHeights([order], shop, () => notes)
  return m.get(order.id) ?? null
}
