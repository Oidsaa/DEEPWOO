import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ConnState, Order, OrderNote, OrdersListResult, ReceiptType } from '../../shared/types'
import { api, isMock } from '../api'
import { avatarPalette, faDate, faDigits, faNum, faTime, orderStatusMeta } from '../lib/format'
import { bulkPostalHtml, bulkStoreHtml, bulkWarehouseHtml, RECEIPT_KINDS, type BulkReceiptDoc, type ReceiptShop } from '../lib/print'
import BulkPrintModal from './BulkPrintModal'
import {
  IconAlert,
  IconBag,
  IconCheck,
  IconEye,
  IconGear,
  IconPrint,
  IconRefresh,
  IconSearch,
  IconStore,
  IconSwap,
  IconX,
} from './Icons'
import OrderDetailModal from './OrderDetailModal'
import OrderStatusModal from './OrderStatusModal'
import ReceiptModal from './ReceiptModal'

const PER_PAGE_OPTIONS = [25, 50, 100] as const

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

export default function OrdersView({ configured, conn, storeName, onGoSettings }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [params, setParams] = useState({ search: '', page: 1, perPage: 50 })
  const [data, setData] = useState<OrdersListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const debounceRef = useRef<number | undefined>(undefined)
  /** Order ids selected across pages (the first column). */
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  /** Row-level status change (single order). */
  const [statusOrder, setStatusOrder] = useState<Order | null>(null)
  /** Bulk status change for the selected orders. */
  const [bulkStatus, setBulkStatus] = useState(false)
  /** Bulk print: menu open + its viewport anchor, or building/sending. */
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false)
  const [bulkPrintPos, setBulkPrintPos] = useState({ top: 0, right: 0 })
  const [bulkPrintBusy, setBulkPrintBusy] = useState(false)
  const [bulkPrintError, setBulkPrintError] = useState<string | null>(null)
  /** Built bulk document shown in the preview modal (prints only on confirm). */
  const [bulkDoc, setBulkDoc] = useState<BulkReceiptDoc | null>(null)

  /**
   * چاپ گروهی: selected orders (across pages) are re-fetched by id (with the
   * store's own sort), their notes are loaded, and one big document is built
   * with the chosen receipt layout and opened as a PREVIEW — printing is a
   * separate, manual confirm inside the modal.
   */
  const runBulkPrint = async (type: ReceiptType) => {
    if (bulkPrintBusy) return
    setBulkPrintBusy(true)
    setBulkPrintError(null)
    try {
      const ids = [...selectedIds]
      const list = await api.listOrders({ include: ids, perPage: Math.max(1, ids.length) })
      const orders = list.orders
      if (orders.length === 0) throw new Error('سفارش انتخاب‌شده‌ای برای چاپ پیدا نشد.')
      // Warehouse labels include manager/customer notes — load them once per order.
      const notesLists = await Promise.all(
        orders.map((o) =>
          api
            .listOrderNotes(o.id)
            .then((n) => [o.id, n] as const)
            .catch(() => [o.id, [] as OrderNote[]] as const),
        ),
      )
      const notesMap = new Map(notesLists)
      const notesOf = (orderId: number): OrderNote[] => notesMap.get(orderId) ?? []
      const s = await api.getSettings()
      let host = ''
      try {
        host = new URL(s.siteUrl || '').hostname.replace(/^www\./, '')
      } catch {
        host = ''
      }
      const shop: ReceiptShop = {
        name: s.storeName || host,
        domain: host,
        address: s.storeAddress,
        postcode: s.storePostcode,
        phone: s.storePhone,
        logo: s.storeLogo,
      }
      let doc: BulkReceiptDoc
      if (type === 'store') doc = bulkStoreHtml(orders, shop)
      else if (type === 'postal') doc = bulkPostalHtml(orders, shop)
      else doc = bulkWarehouseHtml(orders, shop, notesOf)
      setBulkDoc(doc)
    } catch (e) {
      setBulkPrintError(e instanceof Error ? e.message : String(e))
    } finally {
      setBulkPrintBusy(false)
    }
  }
  /** Row whose print menu is open (the three receipt kinds), with its anchor. */
  const [printMenu, setPrintMenu] = useState<{ order: Order; top: number; right: number } | null>(null)
  /** Receipt modal target + its initially selected kind. */
  const [printOrder, setPrintOrder] = useState<{ order: Order; type: ReceiptType } | null>(null)

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  useEffect(() => {
    if (!configured) {
      setLoading(false)
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .listOrders({ search: params.search, page: params.page, perPage: params.perPage })
      .then((r) => {
        if (!cancelled) setData(r)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured, params.search, params.page, params.perPage, loadCount])

  const onSearchChange = (value: string) => {
    setSearchInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      const v = value.trim()
      setParams((p) => (p.search === v ? p : { ...p, search: v, page: 1 }))
    }, 380)
  }

  const pageOrders = data?.orders ?? []
  const pageIds = pageOrders.map((o) => o.id)
  const pageAllSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id))
  const pageSomeSelected = pageIds.some((id) => selectedIds.has(id))

  const toggleOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const togglePage = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) for (const id of pageIds) next.delete(id)
      else for (const id of pageIds) next.add(id)
      return next
    })
  }

  const dimmed = loading && !!data

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">سفارش‌ها</h1>
            {data && (
              <span className="chip">
                <IconBag size={13} />
                {faNum(data.total)} سفارش
              </span>
            )}
          </div>
          <div className="page-sub">سفارشات فروشگاه «{storeName ?? 'ووکامرس'}»</div>
        </div>
      </div>

      {conn.state === 'fail' && (
        <div className="notice err">
          <IconAlert size={17} />
          <div style={{ flex: 1 }}>{conn.message}</div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
            تلاش دوباره
          </button>
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
                ? 'برای دیدن سفارش‌های واقعی باید برنامه را داخل نسخهٔ دسکتاپ اجرا کنید. در این پیش‌نمایش فقط دادهٔ آزمایشی در دسترس است.'
                : 'برای نمایش سفارش‌ها، ابتدا در بخش «تنظیمات» آدرس سایت و کلیدهای API ووکامرس را وارد کنید. کلیدها فقط روی همین دستگاه ذخیره می‌شوند.'}
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
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">فهرست سفارش‌ها</div>
              <div className="panel-sub">
                {data
                  ? `نمایش ${faNum(pageOrders.length)} سفارش از ${faNum(data.total)}`
                  : 'بارگذاری داده‌ها از فروشگاه…'}
              </div>
            </div>
            <div className="toolbar" style={{ width: 'min(560px, 100%)' }}>
              <div className="search">
                <span className="search-ic">
                  <IconSearch size={15} />
                </span>
                <input
                  type="text"
                  value={searchInput}
                  placeholder="جستجو بر اساس شماره سفارش یا نام مشتری…"
                  onChange={(e) => onSearchChange(e.target.value)}
                />
                {searchInput && (
                  <button
                    type="button"
                    className="clear-btn"
                    aria-label="پاک کردن جستجو"
                    onClick={() => {
                      setSearchInput('')
                      window.clearTimeout(debounceRef.current)
                      setParams((p) => (p.search === '' ? p : { ...p, search: '', page: 1 }))
                    }}
                  >
                    <IconX size={14} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn-icon"
                title="بارگذاری مجدد"
                onClick={() => setLoadCount((n) => n + 1)}
              >
                <IconRefresh size={15} className={loading ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="sel-bar">
              <IconCheck size={15} />
              <span>
                <b>{faNum(selectedIds.size)}</b> سفارش انتخاب شده
              </span>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setBulkStatus(true)}>
                <IconSwap size={14} />
                تغییر وضعیت گروهی
              </button>
              <div className="bulk-print-wrap" style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={(e) => {
                    setBulkPrintError(null)
                    const r = e.currentTarget.getBoundingClientRect()
                    setBulkPrintPos({ top: r.bottom + 6, right: window.innerWidth - r.right })
                    setBulkPrintOpen((o) => !o)
                  }}
                  disabled={bulkPrintBusy}
                  title="چاپ رسید همهٔ سفارش‌های انتخاب‌شده"
                >
                  <IconPrint size={14} />
                  {bulkPrintBusy ? 'در حال آماده‌سازی…' : 'چاپ گروهی'}
                </button>
                {bulkPrintOpen &&
                  createPortal(
                    <>
                      <div className="act-backdrop" onClick={() => setBulkPrintOpen(false)} />
                      <div
                        className="act-menu"
                        role="menu"
                        aria-label="نوع رسید گروهی"
                        style={{ top: bulkPrintPos.top, right: bulkPrintPos.right }}
                      >
                        <div className="act-menu-title">قالب چاپ گروهی</div>
                        {RECEIPT_KINDS.map((k) => (
                          <button
                            key={k.type}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setBulkPrintOpen(false)
                              void runBulkPrint(k.type)
                            }}
                          >
                            <b>{k.fa}</b>
                            <span>{k.sub}</span>
                          </button>
                        ))}
                      </div>
                    </>,
                    document.body,
                  )}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setSelectedIds(new Set())}
              >
                پاک کردن انتخاب
              </button>
            </div>
          )}

          {error ? (
            <div className="empty">
              <div className="empty-ic amber">
                <IconAlert size={28} />
              </div>
              <div className="empty-title">دریافت سفارش‌ها ناموفق بود</div>
              <div className="empty-sub">{error}</div>
              <div className="empty-action">
                <button type="button" className="btn btn-ghost" onClick={() => setLoadCount((n) => n + 1)}>
                  <IconRefresh size={15} />
                  تلاش دوباره
                </button>
              </div>
            </div>
          ) : loading && !data ? (
            <SkeletonTable />
          ) : !data || pageOrders.length === 0 ? (
            <div className="empty">
              <div className="empty-ic">
                <IconSearch size={26} />
              </div>
              <div className="empty-title">{searchInput ? 'نتیجه‌ای پیدا نشد' : 'سفارشی وجود ندارد'}</div>
              <div className="empty-sub">
                {searchInput
                  ? `سفارشی با «${searchInput}» مطابقت نداشت. شمارهٔ سفارش یا نام مشتری دیگری را امتحان کنید.`
                  : 'هنوز سفارشی در فروشگاه ثبت نشده است.'}
              </div>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl tbl-orders" style={dimmed ? { opacity: 0.45 } : undefined}>
                <colgroup>
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '18%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className="th-check">
                      <input
                        type="checkbox"
                        aria-label="انتخاب همهٔ سفارش‌های این صفحه"
                        checked={pageAllSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !pageAllSelected && pageSomeSelected
                        }}
                        onChange={togglePage}
                      />
                    </th>
                    <th>شماره سفارش</th>
                    <th>نام مشتری</th>
                    <th>تاریخ و ساعت</th>
                    <th>وضعیت و درگاه پرداخت</th>
                    <th className="th-num">قیمت سفارش</th>
                    <th className="th-actions">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {pageOrders.map((o) => (
                    <OrderRow
                      key={o.id}
                      order={o}
                      selected={selectedIds.has(o.id)}
                      onToggle={() => toggleOne(o.id)}
                      onDetail={() => setDetailOrder(o)}
                      onStatus={() => setStatusOrder(o)}
                      onPrint={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        setPrintMenu({ order: o, top: r.bottom + 6, right: window.innerWidth - r.right })
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detailOrder && <OrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} />}

          {statusOrder && (
            <OrderStatusModal
              order={statusOrder}
              onClose={() => setStatusOrder(null)}
              onChanged={() => {
                setStatusOrder(null)
                setLoadCount((n) => n + 1)
              }}
            />
          )}

          {bulkPrintError && (
            <div className="notice err" style={{ margin: '0 16px 8px' }}>
              <IconAlert size={15} />
              <div style={{ flex: 1 }}>{bulkPrintError}</div>
            </div>
          )}

          {bulkDoc && <BulkPrintModal doc={bulkDoc} onClose={() => setBulkDoc(null)} />}

          {bulkStatus && selectedIds.size > 0 && (
            <OrderStatusModal
              orderIds={[...selectedIds]}
              onClose={() => setBulkStatus(false)}
              onChanged={() => {
                setSelectedIds(new Set())
                setLoadCount((n) => n + 1)
              }}
            />
          )}

          {printOrder && (
            <ReceiptModal
              order={printOrder.order}
              initialType={printOrder.type}
              onClose={() => setPrintOrder(null)}
            />
          )}

          {printMenu &&
            createPortal(
              <>
                <div className="act-backdrop" onClick={() => setPrintMenu(null)} />
                <div
                  className="act-menu"
                  role="menu"
                  aria-label="انواع رسید"
                  style={{ top: printMenu.top, right: printMenu.right }}
                >
                  <div className="act-menu-title">انتخاب نوع رسید</div>
                  {RECEIPT_KINDS.map((k) => (
                    <button
                      key={k.type}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        const o = printMenu.order
                        setPrintMenu(null)
                        setPrintOrder({ order: o, type: k.type })
                      }}
                    >
                      <b>{k.fa}</b>
                      <span>{k.sub}</span>
                    </button>
                  ))}
                </div>
              </>,
              document.body,
            )}

          {data && !error && (
            <div className="pager">
              <div className="page-info">
                صفحهٔ <b>{faNum(data.page)}</b> از <b>{faNum(data.totalPages)}</b>
              </div>
              <div className="pager-btns">
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={loading || data.page <= 1}
                  onClick={() => setParams((p) => ({ ...p, page: Math.max(1, p.page - 1) }))}
                >
                  قبلی
                </button>
                <select
                  className="sel"
                  value={params.perPage}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, perPage: Number(e.target.value), page: 1 }))
                  }
                  title="تعداد در هر صفحه"
                >
                  {PER_PAGE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {faNum(n)} در صفحه
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  disabled={loading || data.page >= data.totalPages}
                  onClick={() => setParams((p) => ({ ...p, page: Math.min(data.totalPages, p.page + 1) }))}
                >
                  بعدی
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function OrderRow({
  order,
  selected,
  onToggle,
  onDetail,
  onStatus,
  onPrint,
}: {
  order: Order
  selected: boolean
  onToggle: () => void
  onDetail: () => void
  onStatus: () => void
  onPrint: (e: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  const pal = avatarPalette(order.customer_name ?? String(order.id))
  const meta = orderStatusMeta(order.status)
  const dt = new Date(order.date_created)
  return (
    <tr className={selected ? 'tr-active' : undefined}>
      <td className="td-check">
        <input type="checkbox" aria-label={`انتخاب سفارش ${order.number}`} checked={selected} onChange={onToggle} />
      </td>
      <td>
        <span className="order-no" dir="ltr">
          #{faDigits(order.number)}
        </span>
      </td>
      <td>
        <div className="cell-user cell-orders-user">
          <div className="u-avatar" style={{ color: pal.color, background: pal.bg }}>
            {(order.customer_name ?? '؟').trim().slice(0, 1)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="u-name">{order.customer_name ?? 'مشتری مهمان'}</div>
          </div>
        </div>
      </td>
      <td>
        <div className="cell-datetime">
          <span>{faDate(order.date_created)}</span>
          <span className="cell-time">{faTime(dt)}</span>
        </div>
      </td>
      <td>
        <div className="cell-status-gw">
          <span className={'pill ' + meta.cls}>{meta.fa}</span>
          <span className="cell-gw">{order.payment_method_title || '—'}</span>
        </div>
      </td>
      <td>
        <div className="cell-price" dir="ltr" style={{ textAlign: 'right' }}>
          {faNum(order.total)}
        </div>
      </td>
      <td>
        <div className="cell-actions">
          <button
            type="button"
            className="btn-icon"
            title="جزئیات سفارش"
            aria-label="جزئیات سفارش"
            onClick={onDetail}
          >
            <IconEye size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="تغییر وضعیت سفارش"
            aria-label={`تغییر وضعیت سفارش ${order.number}`}
            onClick={onStatus}
          >
            <IconSwap size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="چاپ رسید"
            aria-label={`چاپ رسید سفارش ${order.number}`}
            onClick={onPrint}
          >
            <IconPrint size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function SkeletonTable() {
  return (
    <div className="tbl-wrap">
      <table className="tbl tbl-orders">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className="th-check" />
            <th>شماره سفارش</th>
            <th>نام مشتری</th>
            <th>تاریخ و ساعت</th>
            <th>وضعیت و درگاه پرداخت</th>
            <th>قیمت سفارش</th>
            <th>عملیات</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, i) => (
            <tr className="sk-row" key={i}>
              <td>
                <div className="sk sk-line" style={{ width: 16, height: 16, margin: '0 auto' }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 80 }} />
              </td>
              <td>
                <div className="sk-cell-user">
                  <div className="sk sk-thumb" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div className="sk sk-line" style={{ width: 130 }} />
                  </div>
                </div>
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 110 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 130 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 90 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 64, height: 30 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}