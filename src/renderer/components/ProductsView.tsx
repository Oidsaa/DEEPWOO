import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnState, Product, ProductsResult } from '../../shared/types'
import { api, isMock } from '../api'
import { avatarPalette, faDate, faDigits, faNum } from '../lib/format'
import AddProductModal from './AddProductModal'
import BulkPriceModal from './BulkPriceModal'
import BulkStockModal from './BulkStockModal'
import ProductDetailModal from './ProductDetailModal'
import ProductOrdersModal from './ProductOrdersModal'
import {
  IconAlert,
  IconBag,
  IconBox,
  IconEye,
  IconGear,
  IconLayers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStore,
  IconTag,
  IconX,
} from './Icons'

const PER_PAGE_OPTIONS = [25, 50, 100] as const

const STATUS_OPTIONS = [
  { value: '', fa: 'همهٔ وضعیت‌ها' },
  { value: 'publish', fa: 'منتشرشده' },
  { value: 'draft', fa: 'پیش‌نویس' },
  { value: 'private', fa: 'خصوصی' },
  { value: 'pending', fa: 'در انتظار بررسی' },
] as const

const PUB_STATUS: Record<string, { fa: string; cls: string }> = {
  publish: { fa: 'منتشرشده', cls: 'pill-green' },
  private: { fa: 'خصوصی', cls: 'pill-amber' },
  draft: { fa: 'پیش‌نویس', cls: 'pill-dim' },
  pending: { fa: 'در انتظار بررسی', cls: 'pill-indigo' },
}

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

const STOCK_META: Record<string, { fa: string; cls: string }> = {
  instock: { fa: 'موجود', cls: 'pill-green' },
  outofstock: { fa: 'ناموجود', cls: 'pill-red' },
  onbackorder: { fa: 'در انتظار تأمین', cls: 'pill-amber' },
}

function stockMeta(s: string): { fa: string; cls: string } {
  return STOCK_META[s] ?? { fa: s.replace(/-/g, ' '), cls: 'pill-dim' }
}

function typeFa(type: string): string {
  if (type === 'variable') return 'متغیر'
  if (type === 'variation') return 'مشخصات'
  if (type === 'grouped') return 'گروهی'
  if (type === 'external') return 'خارجی'
  return type
}

/** Price display: current price, struck-through regular price when on sale. */
function PriceCell({ product }: { product: Product }) {
  if (product.type === 'variable' && !product.price) {
    return (
      <span className="price-wrap">
        <span className="price-current dim">متغیر</span>
      </span>
    )
  }
  const price = product.price ? faNum(product.price) : '—'
  const hasSale = product.on_sale && product.sale_price && product.regular_price
  return (
    <span className="price-wrap">
      {hasSale && <span className="price-old">{faNum(product.regular_price)}</span>}
      <span className="price-current">{price}</span>
    </span>
  )
}

export default function ProductsView({ configured, conn, storeName, onGoSettings }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [params, setParams] = useState({ search: '', status: '', stockStatus: '', page: 1, perPage: 100 })
  const [data, setData] = useState<ProductsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const debounceRef = useRef<number | undefined>(undefined)
  const [showAddModal, setShowAddModal] = useState(false)
  const [detailProduct, setDetailProduct] = useState<Product | null>(null)
  const [ordersProduct, setOrdersProduct] = useState<Product | null>(null)
  const [bulkPriceProduct, setBulkPriceProduct] = useState<Product | null>(null)
  const [bulkStockProduct, setBulkStockProduct] = useState<Product | null>(null)
  const [successFlash, setSuccessFlash] = useState<string | null>(null)

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  useEffect(() => {
    if (!successFlash) return
    const t = window.setTimeout(() => setSuccessFlash(null), 4200)
    return () => window.clearTimeout(t)
  }, [successFlash])

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
      .listProducts({
        search: params.search,
        status: params.status,
        stockStatus: params.stockStatus,
        page: params.page,
        perPage: params.perPage,
      })
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
  }, [configured, params.search, params.status, params.stockStatus, params.page, params.perPage, loadCount])

  const handleCreated = (name: string) => {
    setShowAddModal(false)
    setSuccessFlash(`محصول «${name}» با موفقیت در فروشگاه ثبت شد.`)
    setSearchInput('')
    window.clearTimeout(debounceRef.current)
    setParams((p) => ({ ...p, search: '', page: 1 }))
    setLoadCount((n) => n + 1)
  }

  const onSearchChange = (value: string) => {
    setSearchInput(value)
    window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      const v = value.trim()
      setParams((p) => (p.search === v ? p : { ...p, search: v, page: 1 }))
    }, 380)
  }

  // These aggregates come from the store across ALL pages (see woo.ts / mock),
  // so the widgets are never limited to the currently visible page.
  const inStock = data ? data.inStock : null
  const outOfStock = data ? data.outOfStock : null
  const totalSales = data ? data.totalSales : null
  const dimmed = loading && !!data

  const SEG_FA: Record<string, string> = { instock: 'موجود', outofstock: 'ناموجود' }
  const segFa = (v: string) => SEG_FA[v] ?? v

  /** Clicking a segment widget filters the list to that group; clicking it again clears. */
  const toggleSegment = (v: string) =>
    setParams((p) => ({ ...p, stockStatus: p.stockStatus === v ? '' : v, page: 1 }))

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">محصولات</h1>
            {data && (
              <span className="chip">
                <IconBox size={13} />
                {faNum(data.total)} محصول
              </span>
            )}
          </div>
          <div className="page-sub">
            محصولات فروشگاه «{storeName ?? 'ووکامرس'}»{' '}
            <span style={{ color: 'var(--ink-3)' }}>همهٔ وضعیت‌ها (منتشرشده، خصوصی، پیش‌نویس و…) نمایش داده می‌شوند.</span>
          </div>
        </div>
        {configured && (
          <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <IconPlus size={16} />
            افزودن محصول
          </button>
        )}
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

      {successFlash && (
        <div className="notice ok fade-in">
          <IconBox size={17} />
          <div>{successFlash}</div>
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
                ? 'برای دیدن محصولات واقعی باید برنامه را داخل نسخهٔ دسکتاپ اجرا کنید. در این پیش‌نمایش فقط دادهٔ آزمایشی در دسترس است.'
                : 'برای نمایش محصولات، ابتدا در بخش «تنظیمات» آدرس سایت و کلیدهای API ووکامرس را وارد کنید. کلیدها فقط روی همین دستگاه ذخیره می‌شوند.'}
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
            <StatCard
              icon={<IconBox size={19} />}
              tone="t-teal"
              label="کل محصولات"
              value={data ? faNum(data.totalAll) : '—'}
              onClick={() => toggleSegment('')}
              active={params.stockStatus === ''}
            />
            <StatCard
              icon={<IconRefresh size={18} />}
              tone="t-indigo"
              label="موجود"
              value={inStock !== null ? faNum(inStock) : '—'}
              onClick={() => toggleSegment('instock')}
              active={params.stockStatus === 'instock'}
            />
            <StatCard
              icon={<IconAlert size={18} />}
              tone="t-amber"
              label="ناموجود"
              value={outOfStock !== null ? faNum(outOfStock) : '—'}
              onClick={() => toggleSegment('outofstock')}
              active={params.stockStatus === 'outofstock'}
            />
            <StatCard
              icon={<IconBag size={18} />}
              tone="t-rose"
              label="فروش کل"
              value={totalSales !== null ? faNum(totalSales) : '—'}
            />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">فهرست محصولات</div>
                <div className="panel-sub">
                  {data
                    ? `نمایش ${faNum(data.products.length)} محصول از ${faNum(data.total)}`
                    : 'بارگذاری داده‌ها از فروشگاه…'}
                  {params.stockStatus && data && (
                    <>
                      {' '}—{' '}
                      <b style={{ color: 'var(--ink-2)', fontWeight: 700 }}>
                        فقط {segFa(params.stockStatus)}ها نمایش داده می‌شوند (برای حذف، دوباره روی همان ویجت کلیک کنید)
                      </b>
                    </>
                  )}
                </div>
              </div>
              <div className="toolbar" style={{ width: 'min(560px, 100%)' }}>
                <select
                  className="sel"
                  style={{ minWidth: 140 }}
                  value={params.status}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, status: e.target.value, page: 1 }))
                  }
                  title="وضعیت انتشار"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.fa}
                    </option>
                  ))}
                </select>
                <div className="search">
                  <span className="search-ic">
                    <IconSearch size={15} />
                  </span>
                  <input
                    type="text"
                    value={searchInput}
                    placeholder="جستجو بر اساس نام یا کد محصول…"
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

            {error ? (
              <div className="empty">
                <div className="empty-ic amber">
                  <IconAlert size={28} />
                </div>
                <div className="empty-title">دریافت محصولات ناموفق بود</div>
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
            ) : !data || data.products.length === 0 ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconSearch size={26} />
                </div>
                <div className="empty-title">{searchInput ? 'نتیجه‌ای پیدا نشد' : 'محصولی وجود ندارد'}</div>
                <div className="empty-sub">
                  {searchInput
                    ? `محصولی با «${searchInput}» مطابقت نداشت. عبارت دیگری را امتحان کنید.`
                    : params.stockStatus
                      ? `محصولی با وضعیت موجودی «${segFa(params.stockStatus)}» مطابق با فیلترهای جاری یافت نشد.`
                      : params.status
                        ? `محصولی با وضعیت «${STATUS_OPTIONS.find((s) => s.value === params.status)?.fa}» ثبت نشده است.`
                        : 'هنوز محصولی در فروشگاه ثبت نشده است.'}
                </div>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl tbl-products" style={dimmed ? { opacity: 0.45 } : undefined}>
                  <colgroup>
                    <col style={{ width: '26%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '20%' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>محصول</th>
                      <th>قیمت</th>
                      <th>وضعیت</th>
                      <th>فروش</th>
                      <th>دسته‌بندی</th>
                      <th>تاریخ ایجاد</th>
                      <th className="th-actions">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.products.map((p) => (
                      <ProductRow
                        key={p.id}
                        product={p}
                        onDetail={() => setDetailProduct(p)}
                        onOrders={() => setOrdersProduct(p)}
                        onBulkPrice={() => setBulkPriceProduct(p)}
                        onBulkStock={() => setBulkStockProduct(p)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
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
        </>
      )}

      {showAddModal && <AddProductModal onClose={() => setShowAddModal(false)} onCreated={handleCreated} />}

      {detailProduct && (
        <ProductDetailModal
          productId={detailProduct.id}
          productName={detailProduct.name}
          onClose={() => setDetailProduct(null)}
          onChanged={() => setLoadCount((n) => n + 1)}
        />
      )}

      {ordersProduct && (
        <ProductOrdersModal product={ordersProduct} onClose={() => setOrdersProduct(null)} />
      )}

      {bulkPriceProduct && (
        <BulkPriceModal
          product={bulkPriceProduct}
          onClose={() => setBulkPriceProduct(null)}
          onChanged={() => setLoadCount((n) => n + 1)}
        />
      )}

      {bulkStockProduct && (
        <BulkStockModal
          product={bulkStockProduct}
          onClose={() => setBulkStockProduct(null)}
          onChanged={() => setLoadCount((n) => n + 1)}
        />
      )}
    </div>
  )
}

function ProductRow({
  product,
  onDetail,
  onOrders,
  onBulkPrice,
  onBulkStock,
}: {
  product: Product
  onDetail: () => void
  onOrders: () => void
  onBulkPrice: () => void
  onBulkStock: () => void
}) {
  const pal = avatarPalette(String(product.id) + product.name)
  const meta = stockMeta(product.stock_status)
  const cats = product.categories.map((c) => c.name).slice(0, 2).join('، ')
  const firstImg = product.images[0]?.src
  const [imgBroken, setImgBroken] = useState(false)
  const pub = PUB_STATUS[product.status]
  // Only show a tooltip with the full name when the name is actually cut off
  // by the column (long names) — short names stay tooltip-free, like the
  // icon buttons' hover tooltips.
  const nameRef = useRef<HTMLSpanElement | null>(null)
  const [nameOverflow, setNameOverflow] = useState(false)
  useEffect(() => {
    const el = nameRef.current
    if (!el) return
    const check = () => setNameOverflow(el.scrollWidth > el.clientWidth + 1)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [product.name])

  return (
    <tr>
      <td>
        <div className="cell-user">
          {firstImg && !imgBroken ? (
            <img
              className="p-thumb"
              src={firstImg}
              alt=""
              loading="lazy"
              onError={() => setImgBroken(true)}
            />
          ) : (
            <div className="u-avatar" style={{ borderRadius: 10, color: pal.color, background: pal.bg, fontSize: 11 }}>
              {product.name.trim().slice(0, 1) || '؟'}
            </div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="u-name" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span ref={nameRef} className="u-name-txt" title={nameOverflow ? product.name : undefined}>
                {product.name}
              </span>
              {product.status !== 'publish' && pub && (
                <span className={'pill ' + pub.cls} style={{ fontSize: 9.5, padding: '2px 7px' }}>
                  {pub.fa}
                </span>
              )}
            </div>
            {product.type !== 'simple' ? (
              <div className="u-sub" style={{ direction: 'rtl' }}>
                {typeFa(product.type)}
                {product.sku ? ` • ${faDigits(product.sku)}` : ''}
              </div>
            ) : product.sku ? (
              <div className="u-sub" dir="ltr" style={{ textAlign: 'right' }}>
                {faDigits(product.sku)}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td>
        <PriceCell product={product} />
      </td>
      <td>
        <div className="stock-cell">
          <span className={'pill ' + meta.cls}>{meta.fa}</span>
          {product.stock_quantity !== null && product.stock_quantity !== undefined && (
            <span className="stock-qty num">{faNum(product.stock_quantity)} عدد</span>
          )}
        </div>
      </td>
      <td>
        <span className="num cell-sales">{faNum(product.total_sales)}</span>
      </td>
      <td>
        <span className="cell-cat">{cats || '—'}</span>
      </td>
      <td>
        <div className="cell-date">{faDate(product.date_created)}</div>
      </td>
      <td>
        <div className="cell-actions">
          <button
            type="button"
            className="btn-icon"
            title="جزئیات محصول و ویرایش ترکیبات"
            aria-label="جزئیات محصول"
            onClick={onDetail}
          >
            <IconEye size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="سفارش‌های این محصول"
            aria-label="سفارش‌های محصول"
            onClick={onOrders}
          >
            <IconBag size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="تغییر کلی قیمت محصول"
            aria-label="تغییر کلی قیمت"
            onClick={onBulkPrice}
          >
            <IconTag size={14} />
          </button>
          <button
            type="button"
            className="btn-icon"
            title="تغییر کلی موجودی محصول"
            aria-label="تغییر کلی موجودی"
            onClick={onBulkStock}
          >
            <IconLayers size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function StatCard({
  icon,
  tone,
  label,
  value,
  onClick,
  active,
}: {
  icon: ReactNode
  tone: string
  label: string
  value: string
  /** When provided the card behaves as a filter toggle for the product list. */
  onClick?: () => void
  active?: boolean
}) {
  const cls =
    'stat-card' + (onClick ? ' stat-card-btn' : '') + (active ? ' stat-card-active' : '')
  const inner = (
    <>
      <div className={'stat-ic ' + tone}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </>
  )
  if (!onClick) return <div className={cls}>{inner}</div>
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={!!active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      {inner}
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="tbl-wrap">
      <table className="tbl tbl-products">
        <colgroup>
          <col style={{ width: '26%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '20%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>محصول</th>
            <th>قیمت</th>
            <th>وضعیت</th>
            <th>فروش</th>
            <th>دسته‌بندی</th>
            <th>تاریخ ایجاد</th>
            <th>عملیات</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, i) => (
            <tr className="sk-row" key={i}>
              <td>
                <div className="sk-cell-user">
                  <div className="sk sk-thumb" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div className="sk sk-line" style={{ width: 150 }} />
                    <div className="sk sk-line" style={{ width: 70 }} />
                  </div>
                </div>
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 80 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 70 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 50 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 90 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 90 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 110 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
