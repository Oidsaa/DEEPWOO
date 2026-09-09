import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ProductDetail, Settings, WarehouseDef } from '../../shared/types'
import { DEFAULT_WAREHOUSES, readWarehouseStock } from '../../shared/warehouses'
import { api } from '../api'
import { faDigits, faNum, toLatin } from '../lib/format'
import { IconAlert, IconCheck, IconRefresh, IconWarehouse, IconX } from './Icons'

interface Props {
  productId: number
  productName: string
  onClose: () => void
  /** Called after a successful save so the parent can refresh its data. */
  onChanged: () => void
}

interface Row {
  variationId: number | null
  label: string
  sku: string | null
  manageStock: boolean
  siteStock: number | null
  /** Registered counts when the modal opened (null = ثبت‌نشده). */
  initial: Record<string, number | null>
  /** Live input strings per warehouse id. */
  values: Record<string, string>
  /** true once the keeper edited any input of this row. */
  touched: boolean
  /** true → on save the site stock becomes the row's sum (تأیید انبارداری). */
  sync: boolean
}

function parseCount(raw: string): number | null {
  const s = toLatin(raw).replace(/\s/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}

export default function WarehouseStockModal({ productId, productName, onClose, onChanged }: Props) {
  const [warehouses, setWarehouses] = useState<WarehouseDef[]>(DEFAULT_WAREHOUSES)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [detail, settings] = await Promise.all([
          api.getProductDetail(productId) as Promise<ProductDetail>,
          api.getSettings() as Promise<Settings>,
        ])
        if (cancelled) return
        const whs = settings.warehouses?.length ? settings.warehouses : DEFAULT_WAREHOUSES
        setWarehouses(whs)
        const ids = whs.map((w) => w.id)
        const source =
          detail.product.type === 'variable'
            ? detail.variations.map((v) => ({
                variationId: v.id as number | null,
                label: (v.attributes ?? []).map((a) => a.option).filter(Boolean).join(' / ') || v.sku || String(v.id),
                sku: v.sku || detail.product.sku || null,
                node: v,
              }))
            : [
                {
                  variationId: null,
                  label: detail.product.name,
                  sku: detail.product.sku || null,
                  node: detail.product,
                },
              ]
        setRows(
          source.map((s) => {
            const registered = readWarehouseStock(s.node.meta_data, ids)
            const initial: Record<string, number | null> = {}
            const values: Record<string, string> = {}
            for (const w of whs) {
              initial[w.id] = typeof registered[w.id] === 'number' ? registered[w.id] : null
              values[w.id] = typeof registered[w.id] === 'number' ? String(registered[w.id]) : ''
            }
            const manageStock = s.node.manage_stock === true
            return {
              variationId: s.variationId,
              label: s.label,
              sku: s.sku,
              manageStock,
              siteStock: typeof s.node.stock_quantity === 'number' ? Math.round(s.node.stock_quantity) : null,
              initial,
              values,
              touched: false,
              sync: false,
            }
          }),
        )
      } catch (e) {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [productId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const patchRow = (variationId: number | null, patch: Partial<Row>) => {
    setRows((rs) => (rs ?? []).map((r) => (r.variationId === variationId ? { ...r, ...patch } : r)))
  }

  const setValue = (r: Row, whId: string, raw: string) => {
    patchRow(r.variationId, { values: { ...r.values, [whId]: raw }, touched: true })
    if (done) setDone(false)
  }

  const dirtyRows = (rows ?? []).filter((r) => r.touched)

  const save = async () => {
    if (busy || rows === null || dirtyRows.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const payloadRows = dirtyRows.map((r) => {
        const values: Record<string, number> = {}
        for (const w of warehouses) {
          values[w.id] = parseCount(r.values[w.id] ?? '') ?? 0
        }
        return { variationId: r.variationId, values, syncSite: r.sync }
      })
      const result = await api.saveWarehouseStock({ productId, rows: payloadRows })
      // Fold the site's response back into the rows (authoritative values).
      const byVar = new Map(result.rows.map((rr) => [rr.variationId ?? 0, rr]))
      setRows((rs) =>
        (rs ?? []).map((r) => {
          const rr = byVar.get(r.variationId ?? 0)
          if (!rr) return r
          const values = { ...r.values }
          for (const w of warehouses) values[w.id] = String(rr.warehouseStock[w.id] ?? 0)
          return {
            ...r,
            touched: false,
            sync: false,
            values,
            siteStock: typeof rr.siteStock === 'number' ? rr.siteStock : r.siteStock,
            manageStock: rr.siteSynced ? true : r.manageStock,
          }
        }),
      )
      setDone(true)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const modal = (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label="ثبت انبارداری">
        <div className="modal-head">
          <div className="modal-title-row">
            <div className="modal-ic">
              <IconWarehouse size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="modal-title">انبارداری — {productName}</div>
              <div className="modal-sub">
                موجودی هر انبار را به تفکیک ثبت کنید؛ با «ثبت و همگام‌سازی» موجودی سایت برابر مجموع انبارها می‌شود.
              </div>
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
          {done && !error && (
            <div className="notice ok fade-in">
              <IconCheck size={16} />
              <div>موجودی انبارها در فروشگاه ذخیره شد.</div>
            </div>
          )}

          {loadErr ? (
            <div className="empty">
              <div className="empty-ic amber">
                <IconAlert size={26} />
              </div>
              <div className="empty-title">خواندن اطلاعات محصول ناموفق بود</div>
              <div className="empty-sub">{loadErr}</div>
            </div>
          ) : rows === null ? (
            <div className="wh-loading">
              <IconRefresh size={18} className="spin" />
              در حال خواندن محصول و ترکیبات…
            </div>
          ) : rows.length === 0 ? (
            <div className="empty">
              <div className="empty-title">این محصول ترکیبی ندارد</div>
              <div className="empty-sub">
                این محصول از نوع متغیر است اما هیچ ترکیبی برای آن تعریف نشده است. ابتدا ترکیبات را در ووکامرس بسازید.
              </div>
            </div>
          ) : (
            <div className="wh-rows">
              <div className="wh-row wh-row-head">
                <div className="wh-cell-name">قلم</div>
                {warehouses.map((w) => (
                  <div key={w.id} className="wh-cell-count">
                    {w.name}
                  </div>
                ))}
                <div className="wh-cell-sum">مجموع</div>
                <div className="wh-cell-sync" title="با ذخیره، موجودی سایت برابر مجموع انبارها می‌شود">
                  همگام‌سازی سایت
                </div>
              </div>
              {rows.map((r) => {
                const sum = warehouses.reduce((acc, w) => acc + (parseCount(r.values[w.id] ?? '') ?? 0), 0)
                const anyFilled = warehouses.some((w) => parseCount(r.values[w.id] ?? '') !== null)
                const delta = r.siteStock !== null ? sum - r.siteStock : null
                const mismatch = delta !== null && delta !== 0
                return (
                  <div className={'wh-row' + (mismatch ? ' wh-row-diff' : '')} key={r.variationId ?? 0}>
                    <div className="wh-cell-name">
                      <div className="wh-name">{r.label}</div>
                      <div className="wh-sub">
                        {r.sku ? <span dir="ltr">{faDigits(r.sku)}</span> : null}
                        <span className={'pill ' + (r.siteStock !== null ? 'pill-dim' : 'pill-amber')}>
                          {r.siteStock !== null ? 'سایت: ' + faNum(r.siteStock) : 'سایت: —'}
                        </span>
                        {delta !== null && (
                          <span className={'pill ' + (mismatch ? 'pill-red' : 'pill-green')}>
                            {mismatch ? (delta > 0 ? 'انبار ' + faNum(delta) + ' بیشتر' : 'انبار ' + faNum(-delta) + ' کمتر') : 'برابر سایت'}
                          </span>
                        )}
                      </div>
                    </div>
                    {warehouses.map((w) => {
                      const registered = r.initial[w.id]
                      return (
                        <div className="wh-cell-count" key={w.id}>
                          <input
                            className="input wh-input"
                            inputMode="numeric"
                            dir="ltr"
                            placeholder={typeof registered === 'number' ? faNum(registered) : '—'}
                            value={r.values[w.id] ?? ''}
                            disabled={busy}
                            onChange={(e) => setValue(r, w.id, e.target.value)}
                          />
                        </div>
                      )
                    })}
                    <div className="wh-cell-sum num">{faNum(sum)}</div>
                    <div className="wh-cell-sync">
                      <label className={'wh-sync' + (!r.touched ? ' disabled' : '')}>
                        <input
                          type="checkbox"
                          checked={r.sync}
                          disabled={busy || !r.touched || !anyFilled}
                          onChange={(e) => patchRow(r.variationId, { sync: e.target.checked })}
                        />
                        <span>ثبت و به‌روزرسانی سایت</span>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <div className="notice amber" style={{ marginTop: 14 }}>
            <IconAlert size={16} />
            <div>
              خانه‌های خالیِ ردیف‌های تغییر یافته صفر ثبت می‌شوند؛ ردیف‌های دست‌نخورده ذخیره نمی‌شوند. همگام‌سازی فقط با
              تیکِ «ثبت و به‌روزرسانی سایت» موجودی سایت را تغییر می‌دهد.
            </div>
          </div>

          <div className="pd-actions">
            <span className="pd-note">
              {busy ? 'در حال ذخیره…' : done ? 'ذخیره شد.' : dirtyRows.length > 0 ? `${faNum(dirtyRows.length)} ردیف تغییر کرده است.` : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
                بستن
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={save}
                disabled={busy || rows === null || dirtyRows.length === 0}
              >
                {busy ? <IconRefresh size={15} className="spin" /> : <IconCheck size={15} />}
                ذخیره انبارداری
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
