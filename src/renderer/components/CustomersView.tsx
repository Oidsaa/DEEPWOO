import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnState, Customer, CustomersResult, StoreStats } from '../../shared/types'
import { api, isMock } from '../api'
import { avatarPalette, faDate, faDigits, faNum, faTime } from '../lib/format'
import AddCustomerModal from './AddCustomerModal'
import OrderHistoryModal from './OrderHistoryModal'
import {
  IconAlert,
  IconBag,
  IconGear,
  IconRefresh,
  IconSearch,
  IconStore,
  IconUserPlus,
  IconUsers,
  IconWallet,
  IconX,
} from './Icons'

const PER_PAGE_OPTIONS = [25, 50, 100] as const

interface Props {
  configured: boolean
  conn: ConnState
  onGoSettings: () => void
  onUseDemo?: () => void
}

function initialsOf(c: Customer): string {
  const fn = (c.first_name ?? '').trim()
  const ln = (c.last_name ?? '').trim()
  if (fn || ln) return ((fn[0] ?? '') + (ln[0] ?? '')).trim().slice(0, 2) || '؟'
  const u = c.username || c.email
  return u.slice(0, 2).toUpperCase()
}

export default function CustomersView({ configured, conn, onGoSettings, onUseDemo }: Props) {
  const [searchInput, setSearchInput] = useState('')
  const [params, setParams] = useState({ search: '', page: 1, perPage: 100 })
  const [data, setData] = useState<CustomersResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadCount, setLoadCount] = useState(0)
  const [syncedAt, setSyncedAt] = useState<Date | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [successFlash, setSuccessFlash] = useState<string | null>(null)
  const [storeStats, setStoreStats] = useState<StoreStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)
  const debounceRef = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(debounceRef.current), [])

  useEffect(() => {
    if (!successFlash) return
    const t = window.setTimeout(() => setSuccessFlash(null), 4200)
    return () => window.clearTimeout(t)
  }, [successFlash])

  const handleCreated = (name: string) => {
    setShowAddModal(false)
    setSuccessFlash(`مشتری «${name}» با موفقیت در فروشگاه ثبت شد.`)
    setSearchInput('')
    window.clearTimeout(debounceRef.current)
    setParams((p) => ({ ...p, search: '', page: 1 }))
    setLoadCount((n) => n + 1)
  }

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
      .listCustomers({ search: params.search, page: params.page, perPage: params.perPage })
      .then((r) => {
        if (!cancelled) {
          setData(r)
          setSyncedAt(new Date())
        }
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

  // Store-wide KPIs: مجموع خرید all customers + buyers of the current Persian
  // month are computed over EVERY customer of the store (see woo.ts / mock),
  // independent of the visible page and the search box.
  useEffect(() => {
    if (!configured) {
      setStoreStats(null)
      setStatsLoading(false)
      setStatsError(false)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    setStatsError(false)
    api
      .getStoreStats()
      .then((s) => {
        if (!cancelled) setStoreStats(s)
      })
      .catch(() => {
        if (!cancelled) setStatsError(true)
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured])

  const kpiVal = (v: number | undefined): string =>
    v !== undefined && v !== null
      ? faNum(v)
      : statsLoading
        ? '…'
        : statsError
          ? '—'
          : '…'
  const dimmed = loading && !!data

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <div className="page-title-row">
            <h1 className="page-title">مشتریان</h1>
            {data && (
              <span className="chip">
                <IconUsers size={13} />
                {faNum(data.total)} مشتری
              </span>
            )}
          </div>
          <div className="page-sub">
            فهرست مشتریان فروشگاه ووکامرس — بدون ورود به پیشخوان وردپرس.{' '}
            <span style={{ color: 'var(--ink-3)' }}>برای مشاهدهٔ تاریخچهٔ سفارش‌ها، روی سطر هر مشتری کلیک کنید.</span>
          </div>
        </div>
        {configured && (
          <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            <IconUserPlus size={16} />
            افزودن مشتری
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
          <IconBag size={17} />
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
                ? 'برای دیدن مشتریان واقعی باید برنامه را داخل نسخهٔ دسکتاپ اجرا کنید. در این پیش‌نمایش فقط دادهٔ آزمایشی در دسترس است.'
                : 'برای نمایش مشتریان، ابتدا در بخش «تنظیمات» آدرس سایت و کلیدهای API ووکامرس را وارد کنید. کلیدها فقط روی همین دستگاه ذخیره می‌شوند.'}
            </div>
            <div className="empty-action">
              <button type="button" className="btn btn-primary" onClick={onGoSettings}>
                <IconGear size={16} />
                رفتن به تنظیمات
              </button>
              {isMock && onUseDemo && (
                <button type="button" className="btn btn-ghost" onClick={onUseDemo} style={{ marginInlineStart: 8 }}>
                  <IconStore size={16} />
                  استفاده از دادهٔ آزمایشی
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <StatCard
              icon={<IconUsers size={19} />}
              tone="t-teal"
              label="کل مشتریان"
              value={kpiVal(storeStats?.totalCustomers)}
            />
            <StatCard
              icon={<IconBag size={19} />}
              tone="t-indigo"
              label="مشتریان ماه جاری"
              value={kpiVal(storeStats?.monthCustomers)}
            />
            <StatCard
              icon={<IconWallet size={19} />}
              tone="t-amber"
              label="مجموع خرید"
              value={kpiVal(storeStats?.sum)}
            />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">فهرست مشتریان</div>
                <div className="panel-sub">
                  {data
                    ? `نمایش ${faNum(data.customers.length)} مشتری از ${faNum(data.total)}` +
                      (syncedAt ? ` • همگام‌سازی با فروشگاه در ${faTime(syncedAt)}` : '')
                    : 'بارگذاری داده‌ها از فروشگاه…'}
                </div>
              </div>
              <div className="toolbar" style={{ width: 'min(420px, 100%)' }}>
                <div className="search">
                  <span className="search-ic">
                    <IconSearch size={15} />
                  </span>
                  <input
                    type="text"
                    value={searchInput}
                    placeholder="جستجو بر اساس نام یا ایمیل…"
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
                  className={'btn-icon' + (loading ? '' : '')}
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
                <div className="empty-title">دریافت مشتریان ناموفق بود</div>
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
            ) : !data || data.customers.length === 0 ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconSearch size={26} />
                </div>
                <div className="empty-title">{searchInput ? 'نتیجه‌ای پیدا نشد' : 'مشتری‌ای وجود ندارد'}</div>
                <div className="empty-sub">
                  {searchInput
                    ? `مشتری‌ای با «${searchInput}» مطابقت نداشت. عبارت دیگری را امتحان کنید.`
                    : 'هنوز مشتری‌ای در فروشگاه ثبت نشده است.'}
                </div>
                {!searchInput && (
                  <div className="empty-action">
                    <button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                      <IconUserPlus size={16} />
                      افزودن اولین مشتری
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="tbl-wrap">
                <table className="tbl" style={dimmed ? { opacity: 0.45 } : undefined}>
                  <thead>
                    <tr>
                      <th>مشتری</th>
                      <th>موبایل</th>
                      <th>سفارش‌ها</th>
                      <th title="شامل همهٔ وضعیت‌ها به‌جز ناموفق، لغو شده و بازپرداخت‌شده">مجموع خرید</th>
                      <th>عضویت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((c) => {
                      const pal = avatarPalette(String(c.id) + c.username + c.email)
                      const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || c.email
                      return (
                        <tr
                          key={c.id}
                          className={'tr-click' + (selectedCustomer?.id === c.id ? ' tr-active' : '')}
                          onClick={() => setSelectedCustomer(c)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setSelectedCustomer(c)
                            }
                          }}
                          tabIndex={0}
                          aria-label={`مشاهدهٔ سفارش‌های ${[c.first_name, c.last_name].filter(Boolean).join(' ') || c.email}`}
                        >
                          <td>
                            <div className="cell-user">
                              <div className="u-avatar" style={{ color: pal.color, background: pal.bg }}>
                                {initialsOf(c)}
                              </div>
                              <div style={{ minWidth: 0 }}>
                                <div className="u-name">{name}</div>
                                {c.username && <div className="u-sub">@{c.username}</div>}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="cell-phone" dir="ltr">
                              {faDigits(c.billing?.phone)}
                            </div>
                          </td>
                          <td>
                            <span className="num" style={{ color: 'var(--ink-2)' }}>
                              {faNum(c.orders_count)}
                            </span>
                          </td>
                          <td>
                            <span className="num cell-spent">{faNum(c.total_spent)}</span>
                          </td>
                          <td>
                            <div className="cell-date">{faDate(c.date_created)}</div>
                          </td>
                        </tr>
                      )
                    })}
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

      {showAddModal && configured && (
        <AddCustomerModal onClose={() => setShowAddModal(false)} onCreated={handleCreated} />
      )}

      {selectedCustomer && !showAddModal && <OrderHistoryModal customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />}
    </div>
  )
}

function StatCard({
  icon,
  tone,
  label,
  value,
}: {
  icon: ReactNode
  tone: string
  label: string
  value: string
}) {
  return (
    <div className="stat-card">
      <div className={'stat-ic ' + tone}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
      </div>
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>مشتری</th>
            <th>موبایل</th>
            <th>سفارش‌ها</th>
            <th>مجموع خرید</th>
            <th>عضویت</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 8 }, (_, i) => (
            <tr className="sk-row" key={i}>
              <td>
                <div className="sk-cell-user">
                  <div className="sk sk-avatar" />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div className="sk sk-line" style={{ width: 130 }} />
                    <div className="sk sk-line" style={{ width: 80 }} />
                  </div>
                </div>
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 110 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 36 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 80 }} />
              </td>
              <td>
                <div className="sk sk-line" style={{ width: 90 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
