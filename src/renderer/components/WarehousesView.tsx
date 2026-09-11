import { useEffect, useMemo, useState } from 'react'
import type { ConnState, WarehouseItemState, WarehousesOverview } from '../../shared/types'
import { api, isMock } from '../api'
import { faDigits, faNum, faTime } from '../lib/format'
import { forceRefresh, reloadView } from '../lib/refresh'
import { lastStoreSync } from '../lib/syncStamp'
import WarehouseStockModal from './WarehouseStockModal'
import { IconAlert, IconCheck, IconGear, IconRefresh, IconSearch, IconStore, IconWarehouse, IconX } from './Icons'

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

const PAGE_SIZE = 50

type FilterKey = 'all' | 'mismatch' | 'unregistered' | 'ok'

const FILTERS: Array<{ key: FilterKey; fa: string }> = [
  { key: 'all', fa: 'همه' },
  { key: 'mismatch', fa: 'مغایرت‌دار' },
  { key: 'unregistered', fa: 'ثبت‌نشده' },
  { key: 'ok', fa: 'هماهنگ' },
]

/** One row per PRODUCT (like the products page) — combinations live in the modal. */
interface ProductRow {
  productId: number
  name: string
  imageUrl?: string
  sku?: string
  isVariable: boolean
  comboCount: number
  registeredCombos: number
  mismatchCombos: number
  /** مجموع موجودی سایتِ ترکیب‌ها (محصول ساده: همان موجودی خودش). */
  siteStock: number | null
  /** تعداد ترکیب‌های ثبت‌شده برای هر انبار. */
  whRegistered: Record<string, number>
  /** مجموع موجودیِ ثبت‌شدهٔ هر انبار (null = هیچ ترکیبی در این انبار ثبت نشده). */
  whStock: Record<string, number | null>
  /** مجموع انبارهای ترکیب‌های ثبت‌شده. */
  sum: number | null
  status: 'unregistered' | 'mismatch' | 'ok'
  items: WarehouseItemState[]
}

export default function WarehousesView({ configured, conn, storeName, onGoSettings }: Props) {
  const [overview, setOverview] = useState<WarehousesOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [page, setPage] = useState(1)
  const [stockProduct, setStockProduct] = useState<{ id: number; name: string } | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      setOverview(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .getWarehousesOverview()
      .then((ov) => {
        if (cancelled) return
        setOverview(ov)
        void lastStoreSync('warehouses-overview').then((d) => {
          if (!cancelled) setSyncedAt(d)
        })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setOverview(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured, loadCount])

  // A status change (or any stock-affecting write) pushes data:stock-changed — reload.
  useEffect(() => api.onStockChanged(() => reloadView(setLoadCount)), [])

  useEffect(() => {
    if (!savedFlash) return
    const t = window.setTimeout(() => setSavedFlash(false), 4200)
    return () => window.clearTimeout(t)
  }, [savedFlash])

  const productRows = useMemo<ProductRow[]>(() => {
    const items = overview?.items ?? []
    const whIds = overview?.warehouses.map((w) => w.id) ?? []
    const byProduct = new Map<number, WarehouseItemState[]>()
    for (const it of items) {
      const arr = byProduct.get(it.productId)
      if (arr) arr.push(it)
      else byProduct.set(it.productId, [it])
    }
    const out: ProductRow[] = []
    for (const [productId, list] of byProduct) {
      const first = list[0]
      const isVariable = list.some((i) => i.variationId !== null)
      const registered = list.filter((i) => i.sum !== null)
      const hasMismatch = list.some((i) => i.delta !== null && i.delta !== 0)
      const siteVals = list.map((i) => i.siteStock).filter((v): v is number => typeof v === 'number')
      const sumVals = registered.map((i) => i.sum as number)
      const whRegistered: Record<string, number> = {}
      for (const id of whIds) {
        whRegistered[id] = list.filter((i) => typeof i.warehouseStock[id] === 'number').length
      }
      const whStock: Record<string, number | null> = {}
      for (const id of whIds) {
        const vals = list.map((i) => i.warehouseStock[id]).filter((v): v is number => typeof v === 'number')
        whStock[id] = vals.length ? vals.reduce((a, b) => a + b, 0) : null
      }
      out.push({
        productId,
        name: first.productName ?? first.name,
        imageUrl: first.imageUrl,
        sku: isVariable ? undefined : first.sku,
        isVariable,
        comboCount: list.length,
        registeredCombos: registered.length,
        mismatchCombos: list.filter((i) => i.delta !== null && i.delta !== 0).length,
        siteStock: siteVals.length ? siteVals.reduce((a, b) => a + b, 0) : null,
        whRegistered,
        whStock,
        sum: sumVals.length ? sumVals.reduce((a, b) => a + b, 0) : null,
        status: registered.length < list.length ? 'unregistered' : hasMismatch ? 'mismatch' : 'ok',
        items: list,
      })
    }
    return out
  }, [overview])

  const counts = useMemo(
    () => ({
      total: productRows.length,
      mismatch: productRows.filter((p) => p.status === 'mismatch').length,
      unregistered: productRows.filter((p) => p.status === 'unregistered').length,
      ok: productRows.filter((p) => p.status === 'ok').length,
    }),
    [productRows],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = productRows
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          p.items.some((i) => (i.name + ' ' + (i.sku ?? '')).toLowerCase().includes(q)),
      )
    }
    if (filter !== 'all') list = list.filter((p) => p.status === filter)
    return list
  }, [productRows, search, filter])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const dimmed = loading && !!overview

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">انبارها</h1>
            {overview && (
              <span className="chip">
                <IconWarehouse size={13} />
                {faNum(counts.total)} محصول
              </span>
            )}
          </div>
          <div className="page-sub">
            فروشگاه «{storeName ?? 'ووکامرس'}» — موجودی هر انبار به تفکیک محصولات؛ برای ثبت یا دیدن ترکیبات، روی محصول
            کلیک کنید. ملاک همیشه موجودی سایت است و مغایرت‌ها با دکمهٔ «انبارداری» اصلاح می‌شوند.
          </div>
        </div>
        {configured && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => forceRefresh(setLoadCount)}
            title="همگام‌سازی مجدد با فروشگاه"
          >
            <IconRefresh size={15} className={loading ? 'spin' : ''} />
            بارگذاری مجدد
          </button>
        )}
      </div>

      {conn.state === 'fail' && (
        <div className="notice err">
          <IconAlert size={17} />
          <div style={{ flex: 1 }}>{conn.message}</div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => forceRefresh(setLoadCount)}>
            تلاش دوباره
          </button>
        </div>
      )}

      {savedFlash && (
        <div className="notice ok fade-in">
          <IconCheck size={17} />
          <div>انبارداری با موفقیت ثبت شد.</div>
        </div>
      )}

      {!configured ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber">
              <IconStore size={30} />
            </div>
            <div className="empty-title">هنوز به فروشگاه متصل نشده‌اید</div>
            <div className="empty-sub">
              {isMock
                ? 'در این پیش‌نمایش فقط دادهٔ آزمایشی در دسترس است.'
                : 'برای نمایش موجودی انبارها، ابتدا در بخش «تنظیمات» آدرس سایت و کلیدهای API ووکامرس را وارد کنید. کلیدها فقط روی همین دستگاه ذخیره می‌شوند.'}
            </div>
            <div className="empty-action">
              <button type="button" className="btn btn-primary" onClick={onGoSettings}>
                <IconGear size={16} />
                رفتن به تنظیمات
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-ic t-teal">
                <IconWarehouse size={19} />
              </div>
              <div>
                <div className="stat-label">کل محصولات</div>
                <div className="stat-value">{overview ? faNum(counts.total) : '—'}</div>
              </div>
            </div>
            <div
              className={'stat-card' + (counts.mismatch > 0 ? ' stat-card-btn' : '') + (filter === 'mismatch' ? ' stat-card-active' : '')}
              role={counts.mismatch > 0 ? 'button' : undefined}
              tabIndex={counts.mismatch > 0 ? 0 : undefined}
              onClick={() => counts.mismatch > 0 && setFilter((f) => (f === 'mismatch' ? 'all' : 'mismatch'))}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && counts.mismatch > 0) {
                  e.preventDefault()
                  setFilter((f) => (f === 'mismatch' ? 'all' : 'mismatch'))
                }
              }}
            >
              <div className="stat-ic t-rose">
                <IconAlert size={19} />
              </div>
              <div>
                <div className="stat-label">مغایرت با سایت</div>
                <div className="stat-value">{overview ? faNum(counts.mismatch) : '—'}</div>
              </div>
            </div>
            <div
              className={'stat-card stat-card-btn' + (filter === 'unregistered' ? ' stat-card-active' : '')}
              role="button"
              tabIndex={0}
              onClick={() => setFilter((f) => (f === 'unregistered' ? 'all' : 'unregistered'))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setFilter((f) => (f === 'unregistered' ? 'all' : 'unregistered'))
                }
              }}
            >
              <div className="stat-ic t-amber">
                <IconAlert size={19} />
              </div>
              <div>
                <div className="stat-label">ثبت‌نشده</div>
                <div className="stat-value">{overview ? faNum(counts.unregistered) : '—'}</div>
              </div>
            </div>
            <div
              className={'stat-card stat-card-btn' + (filter === 'ok' ? ' stat-card-active' : '')}
              role="button"
              tabIndex={0}
              onClick={() => setFilter((f) => (f === 'ok' ? 'all' : 'ok'))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setFilter((f) => (f === 'ok' ? 'all' : 'ok'))
                }
              }}
            >
              <div className="stat-ic t-indigo">
                <IconCheck size={19} />
              </div>
              <div>
                <div className="stat-label">هماهنگ</div>
                <div className="stat-value">{overview ? faNum(counts.ok) : '—'}</div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">موجودی انبارها</div>
                <div className="panel-sub">
                  {overview
                    ? `${faNum(rows.length)} محصول` +
                      (overview.warehouses.length ? ` • انبارها: ${overview.warehouses.map((w) => w.name).join('، ')}` : '') +
                      (syncedAt ? ` • همگام‌سازی با فروشگاه در ${faTime(syncedAt)}` : '')
                    : 'بارگذاری داده‌ها از فروشگاه…'}
                </div>
              </div>
              <div className="toolbar" style={{ width: 'min(480px, 100%)' }}>
                <div className="search">
                  <span className="search-ic">
                    <IconSearch size={15} />
                  </span>
                  <input
                    type="text"
                    value={search}
                    placeholder="جستجوی نام یا کد محصول…"
                    onChange={(e) => {
                      setSearch(e.target.value)
                      setPage(1)
                    }}
                  />
                  {search && (
                    <button
                      type="button"
                      className="clear-btn"
                      aria-label="پاک کردن جستجو"
                      onClick={() => setSearch('')}
                    >
                      <IconX size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="wh-filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={'chip chip-btn' + (filter === f.key ? ' active' : '')}
                  onClick={() => {
                    setFilter(f.key)
                    setPage(1)
                  }}
                >
                  {f.fa}
                  {f.key === 'mismatch' && counts.mismatch > 0 ? ` (${faNum(counts.mismatch)})` : ''}
                </button>
              ))}
            </div>

            {error ? (
              <div className="empty">
                <div className="empty-ic amber">
                  <IconAlert size={28} />
                </div>
                <div className="empty-title">دریافت موجودی انبارها ناموفق بود</div>
                <div className="empty-sub">{error}</div>
                <div className="empty-action">
                  <button type="button" className="btn btn-ghost" onClick={() => forceRefresh(setLoadCount)}>
                    <IconRefresh size={15} />
                    تلاش دوباره
                  </button>
                </div>
              </div>
            ) : loading && !overview ? (
              <div className="wh-loading">
                <IconRefresh size={18} className="spin" />
                در حال خواندن محصولات از فروشگاه…
              </div>
            ) : !overview || overview.items.length === 0 ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconWarehouse size={26} />
                </div>
                <div className="empty-title">محصولی برای انبارداری وجود ندارد</div>
                <div className="empty-sub">هنوز محصولی در فروشگاه ثبت نشده است.</div>
              </div>
            ) : pageRows.length === 0 ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconSearch size={26} />
                </div>
                <div className="empty-title">نتیجه‌ای پیدا نشد</div>
                <div className="empty-sub">با فیلتر یا عبارت جستجوی فعلی محصولی یافت نشد.</div>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl tbl-warehouses" style={dimmed ? { opacity: 0.45 } : undefined}>
                  <colgroup>
                    <col />
                    <col style={{ width: 76 }} />
                    {overview.warehouses.map((w) => (
                      <col key={w.id} style={{ width: 84 }} />
                    ))}
                    <col style={{ width: 86 }} />
                    <col />
                    <col />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>محصول</th>
                      <th>موجودی سایت</th>
                      {overview.warehouses.map((w) => (
                        <th key={w.id}>{w.name}</th>
                      ))}
                      <th>مجموع انبارها</th>
                      <th>وضعیت</th>
                      <th className="th-actions">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((p) => {
                      const simple = p.items[0]
                      return (
                        <tr
                          key={p.productId}
                          className={'wh-tr-click' + (p.status === 'mismatch' ? ' wh-tr-alert' : '')}
                          onClick={() => setStockProduct({ id: p.productId, name: p.name })}
                          title="بازکردن انبارداری"
                        >
                          <td>
                            <div className="cell-user">
                              {p.imageUrl ? (
                                <img className="p-thumb" src={p.imageUrl} alt="" loading="lazy" />
                              ) : (
                                <div className="u-avatar" style={{ borderRadius: 10, fontSize: 11 }}>
                                  <IconWarehouse size={14} />
                                </div>
                              )}
                              <div style={{ minWidth: 0 }}>
                                <div className="u-name">
                                  <span className="u-name-txt" title={p.name}>
                                    {p.name}
                                  </span>
                                </div>
                                {p.isVariable ? (
                                  <div className="u-sub">
                                    {faNum(p.comboCount)} ترکیب • {faNum(p.registeredCombos)} ثبت‌شده
                                  </div>
                                ) : p.sku ? (
                                  <div className="u-sub" dir="ltr" style={{ textAlign: 'right' }}>
                                    {faDigits(p.sku)}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            {p.siteStock !== null ? (
                              <span
                                className="stock-qty num"
                                title={p.isVariable ? 'مجموع موجودی سایتِ ترکیب‌ها' : undefined}
                              >
                                {faNum(p.siteStock)}
                              </span>
                            ) : (
                              <span className="pill pill-dim">—</span>
                            )}
                          </td>
                          {overview.warehouses.map((w) => {
                            const sv = simple.warehouseStock[w.id]
                            const whv = p.whStock[w.id] ?? null
                            return (
                              <td key={w.id}>
                                {p.isVariable ? (
                                  whv !== null ? (
                                    <span
                                      className="stock-qty num"
                                      title={`مجموع موجودی ثبت‌شده — ${faNum(p.whRegistered[w.id] ?? 0)} ترکیب از ${faNum(p.comboCount)}`}
                                    >
                                      {faNum(whv)}
                                    </span>
                                  ) : (
                                    <span className="pill pill-dim">—</span>
                                  )
                                ) : typeof sv === 'number' ? (
                                  <span className="stock-qty num">{faNum(sv)}</span>
                                ) : (
                                  <span className="pill pill-dim">—</span>
                                )}
                              </td>
                            )
                          })}
                          <td>
                            {p.sum !== null ? (
                              <span
                                className="stock-qty num"
                                title={
                                  p.isVariable && p.registeredCombos < p.comboCount
                                    ? `مجموع ${faNum(p.registeredCombos)} ترکیبِ ثبت‌شده`
                                    : undefined
                                }
                              >
                                {faNum(p.sum)}
                              </span>
                            ) : (
                              <span className="pill pill-dim">ثبت‌نشده</span>
                            )}
                          </td>
                          <td>
                            {p.status === 'unregistered' ? (
                              <span className="pill pill-amber">
                                {p.isVariable
                                  ? `نیاز به انبارداری (${faNum(p.registeredCombos)}/${faNum(p.comboCount)})`
                                  : 'نیاز به انبارداری'}
                              </span>
                            ) : p.status === 'mismatch' ? (
                              <span className="pill pill-red">
                                {p.isVariable
                                  ? `مغایرت در ${faNum(p.mismatchCombos)} ترکیب`
                                  : simple.delta! > 0
                                    ? 'انبار ' + faNum(simple.delta!) + ' بیشتر'
                                    : 'انبار ' + faNum(-simple.delta!) + ' کمتر'}
                              </span>
                            ) : (
                              <span className="pill pill-green">هماهنگ</span>
                            )}
                          </td>
                          <td>
                            <div className="cell-actions">
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setStockProduct({ id: p.productId, name: p.name })
                                }}
                              >
                                <IconWarehouse size={14} />
                                انبارداری
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > PAGE_SIZE && (
              <div className="pager">
                <div className="page-info">
                  صفحهٔ <b>{faNum(safePage)}</b> از <b>{faNum(totalPages)}</b>
                </div>
                <div className="pager-btns">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={safePage <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    قبلی
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    بعدی
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {stockProduct && (
        <WarehouseStockModal
          productId={stockProduct.id}
          productName={stockProduct.name}
          onClose={() => setStockProduct(null)}
          onChanged={() => {
            setSavedFlash(true)
            // The main process folded the save into its cached snapshot —
            // reload the view without wiping the cache (no store re-walk).
            reloadView(setLoadCount)
          }}
        />
      )}
    </div>
  )
}
