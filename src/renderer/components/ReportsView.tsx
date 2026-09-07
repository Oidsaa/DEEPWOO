import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ConnState, CustomerInsights, OpsGroup, OpsOrderRow, Product, SalesReport, TopSeller } from '../../shared/types'
import { api, isMock } from '../api'
import { faDate, faDay, faDigits, faNum, orderStatusMeta } from '../lib/format'
import { jalaliToLocalKey, localKeyDaysAgo, localKeyToJalali } from '../lib/jalali'
import { stockAlertsOf, topRatedProducts } from '../../shared/reports'
import {
  IconAlert,
  IconBag,
  IconBox,
  IconChart,
  IconClock,
  IconGear,
  IconLayers,
  IconRefresh,
  IconStore,
  IconTag,
  IconUsers,
  IconWallet,
  IconX,
} from './Icons'

/** ستارهٔ امتیاز محصول (بدون آیکون اختصاصی). */
function StarIcon({ size = 13 }: { size?: number }) {
  return <span style={{ fontSize: size, lineHeight: 1 }}>★</span>
}

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

const PERIODS = [
  { days: 1, fa: 'امروز' },
  { days: 7, fa: '۷ روز اخیر' },
  { days: 30, fa: '۳۰ روز اخیر' },
  { days: 90, fa: '۹۰ روز اخیر' },
]

/** Report window: a preset width OR an explicit inclusive from/to range. */
type PeriodSel = { days: number } | { from: string; to: string }

type RepTab = 'overview' | 'customers' | 'products' | 'orders' | 'stock'

const TABS: Array<{ id: RepTab; fa: string }> = [
  { id: 'overview', fa: 'خلاصهٔ مدیریتی' },
  { id: 'customers', fa: 'مشتریان' },
  { id: 'products', fa: 'محصولات' },
  { id: 'orders', fa: 'سفارش‌ها' },
  { id: 'stock', fa: 'موجودی' },
]

/** Small KPI card on the report pages. */
function Kpi({ icon, tone, label, value, hint }: { icon: ReactNode; tone: string; label: string; value: string; hint?: string }) {
  return (
    <div className="stat-card">
      <div className={'stat-ic ' + tone}>{icon}</div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint ? <div className="stat-hint">{hint}</div> : null}
      </div>
    </div>
  )
}

function BarRow({ label, value, pct, cls, note }: { label: string; value: string; pct: number; cls: string; note?: string }) {
  return (
    <div className="rp-row" style={{ gap: 6 }}>
      <div className="rp-row-head" style={{ marginBottom: 2 }}>
        <span className="rp-row-name">{label}</span>
        <span className="rp-row-val num">
          {value} {note}
        </span>
      </div>
      <div className="rp-bar-track slim">
        <div className={'rp-bar ' + cls} style={{ width: Math.min(100, Math.max(1, pct)) + '%' }} />
      </div>
    </div>
  )
}

function MiniBar({ v, max, cls }: { v: number; max: number; cls: string }) {
  return (
    <div className="rp-bar-track slim" style={{ margin: '4px 0 0' }}>
      <div className={'rp-bar ' + cls} style={{ width: max > 0 ? Math.max(2, (v / max) * 100) + '%' : '0%' }} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* خلاصهٔ مدیریتی                                                      */
/* ------------------------------------------------------------------ */

function growthText(cur: number, prev: number): string | null {
  if (prev <= 0) return null
  const g = ((cur - prev) / prev) * 100
  return (g >= 0 ? '▲' : '▼') + ' ' + faNum(Math.abs(g) >= 100 ? Math.round(Math.abs(g)) : Math.round(Math.abs(g) * 10) / 10) + '٪ نسبت به دورهٔ قبل'
}

function OverviewTab({ r, maxDay }: { r: SalesReport; maxDay: number }) {
  const c = r.customers
  const avg = r.totals.orders > 0 ? r.totals.revenue / r.totals.orders : 0
  const prevAvg = r.previous.orders > 0 ? r.previous.revenue / r.previous.orders : 0
  const best = [...r.daily].sort((a, b) => b.total - a.total || b.orders - a.orders)[0]
  const growthSales = growthText(r.totals.revenue, r.previous.revenue)
  const growthOrders = growthText(r.totals.orders, r.previous.orders)
  const growthAvg = growthText(avg, prevAvg)
  const topPay = r.payments[0]

  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-ic t-teal">
            <IconWallet size={19} />
          </div>
          <div>
            <div className="stat-label">فروش در این بازه</div>
            <div className="stat-value">{faNum(r.totals.revenue)}</div>
            <div className="stat-hint">تومان — سفارش‌های معتبر</div>
            <span className={'stat-delta ' + (growthSales?.includes('▼') ? 'down' : 'up')}>{growthSales ?? '— نسبت به دورهٔ قبل'}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-indigo">
            <IconBag size={19} />
          </div>
          <div>
            <div className="stat-label">تعداد سفارش</div>
            <div className="stat-value">{faNum(r.totals.orders)}</div>
            <div className="stat-hint">در {faNum(r.days)} روز اخیر</div>
            <span className={'stat-delta ' + (growthOrders?.includes('▼') ? 'down' : 'up')}>{growthOrders ?? '— نسبت به دورهٔ قبل'}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-amber">
            <IconLayers size={19} />
          </div>
          <div>
            <div className="stat-label">میانگین ارزش سبد خرید</div>
            <div className="stat-value">{faNum(Math.round(avg))}</div>
            <div className="stat-hint">تومان به ازای هر سفارش</div>
            <span className={'stat-delta ' + (growthAvg?.includes('▼') ? 'down' : 'up')}>{growthAvg ?? '— نسبت به دورهٔ قبل'}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-teal">
            <IconBox size={19} />
          </div>
          <div>
            <div className="stat-label">اقلام فروخته‌شده</div>
            <div className="stat-value">{faNum(r.totals.items)}</div>
            <div className="stat-hint">جمع تعداد کالاهای سفارش‌ها</div>
          </div>
        </div>
      </div>

      <div className="qo-duo">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">تحلیل قیف فروش و نرخ تبدیل</div>
              <div className="panel-sub">مسیر سفارش‌های بازه بر اساس وضعیت آن‌ها</div>
            </div>
            <span className="qo-cust-picked">
              <IconStore size={13} /> {faNum(r.funnel.created)} سفارش ثبت‌شده
            </span>
          </div>
          <div className="rp-body">
            <BarRow label="ثبت‌شده (همهٔ وضعیت‌ها)" value={faNum(r.funnel.created)} pct={100} cls="soft" note="۱۰۰٪" />
            <BarRow label="در انتظار پرداخت/معوق" value={faNum(r.funnel.awaiting)} pct={r.funnel.waitingPct ?? 0} cls="soft" note={faNum(r.funnel.waitingPct ?? 0) + '٪'} />
            <BarRow label="پرداخت‌شده / در جریان" value={faNum(r.funnel.paid)} pct={r.funnel.paidPct ?? 0} cls="" note={faNum(r.funnel.paidPct ?? 0) + '٪'} />
            <BarRow label="تکمیل‌شده" value={faNum(r.funnel.completed)} pct={r.funnel.completionPct ?? 0} cls="indigo" note={faNum(r.funnel.completionPct ?? 0) + '٪'} />
            <BarRow label="لغو / بازگشت / ناموفق" value={faNum(r.funnel.lost)} pct={r.funnel.lostPct ?? 0} cls="danger" note={faNum(r.funnel.lostPct ?? 0) + '٪'} />
          </div>
          <div className="notice amber" style={{ margin: '0 14px 12px' }}>
            <IconAlert size={15} />
            <div>تقریبی: API فروشگاه دادهٔ بازدید سایت را ندارد؛ قیف از روی وضعیت سفارش‌های همین بازه ساخته شده است.</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">خلاصهٔ مدیریتی</div>
              <div className="panel-sub">نکات کلیدی بازهٔ {faDate(r.from)} تا {faDate(r.to)}</div>
            </div>
            <span className="qo-cust-picked">
              <IconChart size={13} /> {faNum(r.days)} روز
            </span>
          </div>
          <div className="rp-body" style={{ gap: 10 }}>
            <ExecRow
              title="بهترین روز فروش"
              value={best && best.total > 0 ? `${faDate(best.date)} — ${faNum(best.total)} تومان` : 'در این بازه فروشی ثبت نشده'}
              icon={<IconChart size={13} />}
            />
            <ExecRow title="نسبت سفارش به مشتری" value={c.orderRatio !== null ? `${faNum(c.orderRatio)} سفارش به ازای هر مشتری فعال` : '—'} icon={<IconBag size={13} />} />
            <ExecRow title="مشتریان بازه" value={`${faNum(c.active)} فعال (${faNum(c.newCustomers)} جدید · ${faNum(c.returning)} بازگشتی · ${faNum(c.guests)} مهمان)`} icon={<IconUsers size={13} />} />
            <ExecRow title="خرید تکراری" value={c.repeatRate !== null ? `${faNum(c.repeatRate)}٪ مشتریان بیش از یک بار خرید کرده‌اند` : '—'} icon={<IconLayers size={13} />} />
            {topPay ? (
              <ExecRow title="روش پرداخت غالب" value={`${topPay.label} — ${faNum(topPay.count)} سفارش (${faNum(topPay.total)} تومان)`} icon={<IconWallet size={13} />} />
            ) : null}
            <ExecRow title="میانگین فروش روزانه" value={r.days > 0 ? faNum(Math.round(r.totals.revenue / r.days)) + ' تومان' : '—'} icon={<IconClock size={13} />} />
          </div>
        </section>
      </div>

      {/* فروش روزانه */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">فروش روزانه</div>
            <div className="panel-sub">
              از {faDate(r.daily[0]?.date)} تا {faDate(r.daily[r.daily.length - 1]?.date)}
            </div>
          </div>
          <span className="qo-cust-picked">
            <IconChart size={13} /> اوج روزانه: {faNum(maxDay)} تومان
          </span>
        </div>
        <div className="rp-chart-wrap">
          {r.totals.orders === 0 ? (
            <div className="qo-results-empty" style={{ padding: 48 }}>
              در این بازه سفارش معتبری ثبت نشده است.
            </div>
          ) : (
            <DayChart r={r} maxDay={maxDay} />
          )}
        </div>
      </section>

      <div className="qo-duo">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">فروش بر اساس وضعیت</div>
              <div className="panel-sub">سهم هر وضعیت از فروش بازه</div>
            </div>
          </div>
          <div className="rp-body">
            {r.statuses.length === 0 ? (
              <div className="pd-empty">داده‌ای نیست.</div>
            ) : (
              r.statuses.map((s) => {
                const meta = orderStatusMeta(s.label)
                const share = r.totals.revenue > 0 ? (s.total / r.totals.revenue) * 100 : 0
                return (
                  <div className="rp-row" key={s.label}>
                    <div className="rp-row-head">
                      <span className={'pill ' + meta.cls}>{meta.fa}</span>
                      <span className="rp-row-val num">
                        {faNum(s.total)} تومان · {faNum(s.count)} سفارش
                      </span>
                    </div>
                    <div className="rp-bar-track slim">
                      <div className="rp-bar soft" style={{ width: share + '%' }} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">فروش بر اساس روش پرداخت</div>
              <div className="panel-sub">سهم هر درگاه / روش تسویه</div>
            </div>
          </div>
          <div className="rp-body">
            {r.payments.length === 0 ? (
              <div className="pd-empty">داده‌ای نیست.</div>
            ) : (
              r.payments.map((p) => {
                const share = r.totals.revenue > 0 ? (p.total / r.totals.revenue) * 100 : 0
                return (
                  <div className="rp-row" key={p.label}>
                    <div className="rp-row-head">
                      <span className="rp-row-name">{p.label}</span>
                      <span className="rp-row-val num">{faNum(p.total)} تومان</span>
                    </div>
                    <div className="rp-bar-track slim">
                      <div className="rp-bar" style={{ width: share + '%' }} />
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">فروش بر اساس شهر</div>
            <div className="panel-sub">مقصد سفارش‌ها بر اساس شهر صورتحساب</div>
          </div>
        </div>
        <div className="rp-body">
          {r.cities.length === 0 ? (
            <div className="pd-empty">داده‌ای نیست.</div>
          ) : (
            r.cities.map((c) => {
              const share = r.totals.revenue > 0 ? (c.total / r.totals.revenue) * 100 : 0
              const unknown = c.city === 'نامشخص'
              return (
                <div className="rp-row" key={c.city}>
                  <div className="rp-row-head">
                    <span className="rp-row-name">{unknown ? 'نامشخص' : c.city}</span>
                    <span className="rp-row-val num">
                      {faNum(c.total)} تومان · {faNum(c.count)} سفارش
                    </span>
                  </div>
                  <div className="rp-bar-track slim">
                    <div className="rp-bar indigo" style={{ width: share + '%' }} />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </>
  )
}

function ExecRow({ icon, title, value }: { icon: ReactNode; title: string; value: string }) {
  return (
    <div className="rp-row" style={{ alignItems: 'center' }}>
      <span className="rp-row-name" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 128 }}>
        {icon}
        {title}
      </span>
      <span className="rp-row-val num" style={{ fontWeight: 500, color: 'var(--text, #e6edf7)' }}>
        {value}
      </span>
    </div>
  )
}

function DayChart({ r, maxDay }: { r: SalesReport; maxDay: number }) {
  const dayLabelEvery = Math.max(1, Math.ceil(r.daily.length / 12))
  return (
    <div className="rp-chart" dir="ltr">
      {r.daily.map((d, i) => {
        const h = d.total > 0 ? Math.max(3, (d.total / maxDay) * 100) : 1.5
        return (
          <div
            className="rp-bar-col"
            key={d.date}
            title={`${faDate(d.date)} — ${faNum(d.total)} تومان · ${faNum(d.orders)} سفارش`}
          >
            <div className="rp-bar-track">
              <div className="rp-bar" style={{ height: h + '%' }} />
            </div>
            {(i % dayLabelEvery === 0 || i === r.daily.length - 1) && <div className="rp-bar-label">{faDay(d.date)}</div>}
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* مشتریان                                                            */
/* ------------------------------------------------------------------ */

function CustomerRows({ r }: { r: SalesReport }) {
  const c = r.customers
  return (
    <>
      <div className="stat-grid">
        <Kpi icon={<IconUsers size={19} />} tone="t-teal" label="مشتریان فعال" value={faNum(c.active)} hint="با حداقل یک خرید معتبر در بازه" />
        <Kpi icon={<IconUserPlusInline />} tone="t-indigo" label="مشتریان جدید" value={faNum(c.newCustomers)} hint="در دورهٔ قبل خریدی نداشتند" />
        <Kpi icon={<IconRefresh size={19} />} tone="t-amber" label="مشتریان بازگشتی" value={faNum(c.returning)} hint="در دورهٔ هم‌طول قبل هم خرید کرده‌اند" />
        <Kpi icon={<IconBag size={19} />} tone="t-teal" label="مشتریان مهمان" value={faNum(c.guests)} hint="بدون حساب کاربری خرید کرده‌اند" />
      </div>
      <div className="notice amber" style={{ marginTop: 0 }}>
        <IconAlert size={15} />
        <div style={{ flex: 1 }}>
          «جدید / بازگشتی» و رفتار مشتری از روی سفارش‌های همین بازه و دورهٔ هم‌طول قبلش محاسبه شده — تقریبی است و سفارش‌های قدیمی‌تر از دورهٔ قبل را نمی‌بیند.
        </div>
      </div>

      <div className="qo-duo">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">رفتار مشتریان بازه</div>
              <div className="panel-sub">توزیع تعداد خرید مشتریان فعال</div>
            </div>
          </div>
          <div className="rp-body">
            <div className="rp-row">
              <div className="rp-row-head">
                <span className="rp-row-name">نرخ خرید مجدد</span>
                <span className="rp-row-val num">{c.repeatRate !== null ? faNum(c.repeatRate) + '٪' : '—'}</span>
              </div>
              <MiniBar v={c.repeatRate ?? 0} max={100} cls="" />
            </div>
            <div className="rp-row">
              <div className="rp-row-head">
                <span className="rp-row-name">میانگین فروش هر مشتری فعال</span>
                <span className="rp-row-val num">{c.avgRevenue !== null ? faNum(Math.round(c.avgRevenue)) + ' تومان' : '—'}</span>
              </div>
            </div>
            <div className="rp-row">
              <div className="rp-row-head">
                <span className="rp-row-name">نسبت سفارش به مشتری</span>
                <span className="rp-row-val num">{c.orderRatio !== null ? faNum(c.orderRatio) : '—'}</span>
              </div>
            </div>
            <div className="rp-row">
              <div className="rp-row-head">
                <span className="rp-row-name">خرید تکراری (۲+ سفارش)</span>
                <span className="rp-row-val num">
                  {faNum(c.repeatBuyers)} مشتری از {faNum(c.active)}
                </span>
              </div>
            </div>
            <div style={{ height: 6 }} />
            {c.buckets.map((b) => {
              const max = Math.max(1, ...c.buckets.map((x) => x.count))
              return (
                <div className="rp-row" key={b.label} style={{ gap: 4 }}>
                  <div className="rp-row-head" style={{ marginBottom: 2 }}>
                    <span className="rp-row-name">{b.label}</span>
                    <span className="rp-row-val num">{faNum(b.count)} مشتری</span>
                  </div>
                  <MiniBar v={b.count} max={max} cls="indigo" />
                </div>
              )
            })}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">کوپن‌های پراستفاده</div>
              <div className="panel-sub">بر اساس سفارش‌های معتبر بازه</div>
            </div>
            <span className="qo-cust-picked">
              <IconTag size={13} /> {faNum(r.coupons.length)} کد
            </span>
          </div>
          <div className="rp-body">
            {r.coupons.length === 0 ? (
              <div className="pd-empty">در این بازه کوپنی استفاده نشده است.</div>
            ) : (
              r.coupons.map((cou) => {
                const max = Math.max(1, ...r.coupons.map((x) => x.orders))
                return (
                  <div className="rp-row" key={cou.code}>
                    <div className="rp-row-head">
                      <span className="pill pill-teal" dir="ltr">
                        {cou.code}
                      </span>
                      <span className="rp-row-val num">
                        {faNum(cou.orders)} سفارش · {faNum(cou.discount)} تومان تخفیف
                      </span>
                    </div>
                    <MiniBar v={cou.orders} max={max} cls="soft" />
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <div className="qo-duo">
        <TopCustomers title="۱۰ مشتری برتر بر اساس مبلغ خرید" rows={c.topByAmount} by="مبلغ" />
        <TopCustomers title="۱۰ مشتری برتر بر اساس تعداد سفارش" rows={c.topByOrders} by="تعداد" />
      </div>
    </>
  )
}

function IconUserPlusInline() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20c.6-3.4 3-5 6.2-5s5.6 1.6 6.2 5" />
      <path d="M18 8v6M15 11h6" strokeLinecap="round" />
    </svg>
  )
}

function TopCustomers({ title, rows, by }: { title: string; rows: CustomerInsights['topByAmount']; by: 'مبلغ' | 'تعداد' }) {
  const maxV = Math.max(1, ...rows.map((r) => (by === 'مبلغ' ? r.revenue : r.orders)))
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">بر اساس سفارش‌های معتبر بازه</div>
        </div>
      </div>
      <div className="rp-body">
        {rows.length === 0 ? (
          <div className="pd-empty">داده‌ای نیست.</div>
        ) : (
          rows.map((c, i) => (
            <div className="rp-row" key={c.name + c.id} style={{ gap: 4 }}>
              <div className="rp-row-head">
                <span className="rp-rank-wrap">
                  <span className={'rp-rank' + (i < 3 ? ' top' : '')}>{faNum(i + 1)}</span>
                  <span className="qo-match-name" style={{ fontSize: 12 }}>
                    {c.name}
                    {c.id === 0 ? <span className="pill pill-dim" style={{ fontSize: 8.5, marginInlineStart: 6 }}>مهمان</span> : null}
                  </span>
                </span>
                <span className="rp-row-val num">
                  {by === 'مبلغ' ? faNum(c.revenue) + ' تومان' : faNum(c.orders) + ' سفارش'}
                  {by === 'مبلغ' ? ` · ${faNum(c.orders)} سفارش` : ` · ${faNum(c.revenue)} تومان`}
                </span>
              </div>
              <MiniBar v={by === 'مبلغ' ? c.revenue : c.orders} max={maxV} cls="indigo" />
            </div>
          ))
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* محصولات                                                           */
/* ------------------------------------------------------------------ */

function ProductsTab({ r, catalog }: { r: SalesReport; catalog: Product[] }) {
  const topRated = catalog.length > 0 ? topRatedProducts(catalog, 10) : []
  const p = r.profit
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">پرفروش‌ترین محصولات بازه</div>
            <div className="panel-sub">۱۰ محصول برتر — بر اساس مبلغ فروش</div>
          </div>
        </div>
        <div className="rp-body">
          {r.products.length === 0 ? (
            <div className="pd-empty">در این بازه محصولی فروخته نشده است.</div>
          ) : (
            <div className="rp-prods">
              {r.products.map((pr, i) => (
                <ProductRow key={pr.id + pr.name} p={pr} i={i} total={r.totals.revenue} />
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="qo-duo">
        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">۵ محصول / ترکیب پرفروش هفته</div>
              <div className="panel-sub">
                {faDate(r.weekly.from)} تا {faDate(r.weekly.to)}
              </div>
            </div>
          </div>
          <div className="rp-body">
            {r.weekly.top.length === 0 ? (
              <div className="pd-empty">در هفتهٔ پایانی بازه فروشی ثبت نشده است.</div>
            ) : (
              <div className="rp-prods">
                {r.weekly.top.map((w, i) => (
                  <ProductRow key={w.id + w.name} p={w} i={i} total={undefined} weekly />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">محبوب‌ترین ویژگی‌های محصولات</div>
              <div className="panel-sub">مقدارهای فروخته‌شدهٔ ویژگی‌ها (رنگ، سایز، …) از خطوط سفارش</div>
            </div>
          </div>
          <div className="rp-body">
            {r.features.length === 0 ? (
              <div className="pd-empty">در این بازه سفارشی با ویژگی ثبت نشده است.</div>
            ) : (
              r.features.map((f) => {
                const max = Math.max(1, ...r.features.map((x) => x.units))
                return (
                  <div className="rp-row" key={f.label + f.value} style={{ gap: 4 }}>
                    <div className="rp-row-head" style={{ marginBottom: 2 }}>
                      <span className="rp-row-name">
                        <span className="pill pill-dim" style={{ fontSize: 9, marginInlineEnd: 6 }}>
                          {f.label}
                        </span>
                        {f.value}
                      </span>
                      <span className="rp-row-val num">
                        {faNum(f.units)} عدد · {faNum(f.orders)} سفارش
                      </span>
                    </div>
                    <MiniBar v={f.units} max={max} cls="" />
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">محصولات دارای بیشترین امتیاز</div>
            <div className="panel-sub">بر اساس امتیاز و تعداد دیدگاه‌های مشتریان فروشگاه</div>
          </div>
          {catalog.length === 0 ? null : (
            <span className="qo-cust-picked">
              <StarIcon /> از کاتالوگ فروشگاه
            </span>
          )}
        </div>
        <div className="rp-body">
          {catalog.length === 0 ? (
            <div className="pd-empty">برای محاسبهٔ امتیازها، کاتالوگ فروشگاه بارگذاری نشده است.</div>
          ) : topRated.length === 0 ? (
            <div className="pd-empty">هنوز محصولی در فروشگاه امتیاز نگرفته است.</div>
          ) : (
            <div className="rp-prods">
              {topRated.map((pr, i) => {
                const avg = Number(pr.average_rating) || 0
                const count = Number(pr.rating_count) || 0
                return (
                  <div className="rp-prod" key={pr.id}>
                    <span className={'rp-rank' + (i < 3 ? ' top' : '')}>{faNum(i + 1)}</span>
                    <span className="rp-prod-main" style={{ minWidth: 0 }}>
                      <span className="qo-match-name">{pr.name}</span>
                      <span className="qo-match-sub">
                        <span style={{ color: 'var(--amber, #fbbf24)', fontSize: 10 }}>★ {faNum(avg)}</span>
                        <span> · {faNum(count)} دیدگاه</span>
                        {pr.sku ? <span dir="ltr"> · {pr.sku}</span> : null}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* سود ناخالص (از تنظیمات productCosts) */}
      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">سود ناخالص بازه</div>
            <div className="panel-sub">
              ردیف‌ها بر پایهٔ قیمت تمام‌شدهٔ ثبت‌شده در تنظیمات — کالاهای بدون قیمت در انتها با علامت «بدون قیمت»
            </div>
          </div>
          <span className="qo-cust-picked">
            <IconWallet size={13} /> سود ناخالص: {p.coveredRevenue > 0 ? faNum(p.grossProfit) : '—'} تومان
          </span>
        </div>
        {p.uncoveredProducts > 0 && (
          <div className="notice amber" style={{ margin: '0 16px 10px' }}>
            <IconAlert size={15} />
            <div style={{ flex: 1 }}>
              {faNum(p.uncoveredProducts)} کالای فروخته‌شده قیمت تمام‌شده ندارند ({faNum(p.uncoveredRevenue)} تومان فروش) — سود آن‌ها محاسبه نشده است.
            </div>
          </div>
        )}
        {p.rows.length === 0 ? (
          <div className="rp-body">
            <div className="pd-empty">در این بازه کالایی فروخته نشده است.</div>
          </div>
        ) : (
          <div className="rp-table-wrap">
            <div className="rp-table rp-table-head">
              <span>کالا</span>
              <span>تعداد</span>
              <span>فروش</span>
              <span>قیمت تمام‌شده/واحد</span>
              <span>بهای کل</span>
              <span>سود ناخالص</span>
              <span>حاشیه</span>
            </div>
            {p.rows.map((row) => {
              const margin = row.revenue > 0 && row.covered ? (row.profit / row.revenue) * 100 : null
              return (
                <div
                  className={'rp-table' + (row.covered ? '' : ' dim')}
                  key={`${row.id}-${row.name}`}
                  title={row.covered ? undefined : 'قیمت تمام‌شده در تنظیمات ثبت نشده است'}
                >
                  <span className="rp-t-cell-main">
                    <span className="qo-match-name">{row.name}</span>
                    {row.sku ? <span className="qo-match-sub" dir="ltr">{row.sku}</span> : null}
                    {!row.covered && <span className="pill pill-dim" style={{ fontSize: 9.5 }}>بدون قیمت</span>}
                  </span>
                  <span className="num">{faNum(row.units)}</span>
                  <span className="num">{faNum(row.revenue)}</span>
                  <span className="num">{row.covered ? faNum(row.unitCost) : '—'}</span>
                  <span className="num">{row.covered ? faNum(row.cogs) : '—'}</span>
                  <span className={'num ' + (row.covered ? (row.profit >= 0 ? 'pos' : 'neg') : '')}>
                    {row.covered ? faNum(row.profit) : '—'}
                  </span>
                  <span className="num">{margin === null ? '—' : faNum(margin) + '٪'}</span>
                </div>
              )
            })}
          </div>
        )}
        {p.rowsTruncated && (
          <div className="notice amber" style={{ margin: '0 16px 14px' }}>
            <IconAlert size={15} />
            <div>تعداد کالاها بیش از سقف نمایش است — ردیف‌های برتر نشان داده شده‌اند.</div>
          </div>
        )}
      </section>
    </>
  )
}

function ProductRow({ p, i, total, weekly }: { p: TopSeller; i: number; total?: number; weekly?: boolean }) {
  const share = total && total > 0 ? (p.revenue / total) * 100 : null
  return (
    <div className="rp-prod" key={p.id + p.name}>
      <span className={'rp-rank' + (i < 3 ? ' top' : '')}>{faNum(i + 1)}</span>
      <span className="rp-prod-main" style={{ minWidth: 0 }}>
        <span className="qo-match-name">{p.name}</span>
        <span className="qo-match-sub">
          {p.sku ? <span dir="ltr">{p.sku}</span> : null}
          {p.sku ? ' · ' : ''}
          {faNum(p.units)} عدد در {faNum(p.orders)} سفارش
        </span>
      </span>
      <span className="rp-prod-val" style={{ textAlign: 'left' }}>
        <span className="num">{faNum(p.revenue)}</span>
        {weekly ? (
          <span className="qo-match-sub" style={{ textAlign: 'left' }}>
            هفتهٔ جاری
          </span>
        ) : (
          <span className="qo-match-sub" style={{ textAlign: 'left' }}>
            {share === null ? '' : share >= 0.1 ? share.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '<۰٫۱'}٪ از فروش
          </span>
        )}
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* سفارش‌ها (عملیات)                                                  */
/* ------------------------------------------------------------------ */

function OrdersTab({ r }: { r: SalesReport }) {
  const o = r.ops
  return (
    <>
      <div className="stat-grid">
        <Kpi icon={<IconX size={19} />} tone="t-red" label="لغو و برگشت (بازه)" value={faNum(o.cancelled.count)} hint={o.cancelled.total > 0 ? faNum(o.cancelled.total) + ' تومان' : undefined} />
        <Kpi icon={<IconClock size={19} />} tone="t-amber" label="لغو/برگشت ۷ روز اخیر" value={faNum(o.cancelled7.count)} hint={o.cancelled7.total > 0 ? faNum(o.cancelled7.total) + ' تومان' : undefined} />
        <Kpi icon={<IconBag size={19} />} tone="t-indigo" label="سفارش‌های معوق و تکمیل‌نشده" value={faNum(o.waiting.count)} hint={o.waiting.total > 0 ? faNum(o.waiting.total) + ' تومان' : undefined} />
        <Kpi icon={<IconStore size={19} />} tone="t-teal" label="سبدهای رها شده" value={faNum(o.abandoned.count)} hint={o.abandoned.total > 0 ? faNum(o.abandoned.total) + ' تومان' : undefined} />
      </div>
      <div className="notice info" style={{ marginTop: 0 }}>
        <IconAlert size={15} />
        <div style={{ flex: 1 }}>
          سبد رها شده در ووکامرس فقط وقتی ثبت می‌شود که افزونهٔ پیگیری سبد نصب باشد (وضعیت checkout-draft)؛ بدون آن این بخش معمولاً خالی است. «معوق» = در انتظار پرداخت / بررسی.
        </div>
      </div>

      <div className="qo-duo">
        <OpsPanel title="گزارش سفارش‌های لغوشده و برگشتی" sub={`کل بازه — ${faDate(o.cancelled.from)} تا ${faDate(o.cancelled.to)}`} g={o.cancelled} />
        <OpsPanel title="سفارش‌های لغوشده ۷ روز گذشته" sub={`${faDate(o.cancelled7.from)} تا ${faDate(o.cancelled7.to)}`} g={o.cancelled7} />
      </div>
      <div className="qo-duo">
        <OpsPanel title="سفارش‌های معوق و تکمیل‌نشده" sub={`${faDate(o.waiting.from)} تا ${faDate(o.waiting.to)}`} g={o.waiting} />
        <OpsPanel title="سبدهای رها شده" sub={`${faDate(o.abandoned.from)} تا ${faDate(o.abandoned.to)}`} g={o.abandoned} emptyNote="افزونهٔ پیگیری سبد نصب نیست یا در این بازه سبد رهاشده‌ای ثبت نشده است." />
      </div>
    </>
  )
}

function OpsPanel({ title, sub, g, emptyNote }: { title: string; sub: string; g: OpsGroup; emptyNote?: string }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">{title}</div>
          <div className="panel-sub">
            {sub} · {faNum(g.count)} سفارش
            {g.total > 0 ? ` · جمع ${faNum(g.total)} تومان` : ''}
          </div>
        </div>
      </div>
      {g.rows.length === 0 ? (
        <div className="rp-body">
          <div className="pd-empty">{emptyNote ?? 'موردی نیست.'}</div>
        </div>
      ) : (
        <div className="rp-table-wrap">
          <div className="rp-table rp-table-head">
            <span>سفارش</span>
            <span>مشتری</span>
            <span>تاریخ</span>
            <span>وضعیت</span>
            <span>مبلغ</span>
          </div>
          {g.rows.map((row) => (
            <OpsRow key={row.id} row={row} />
          ))}
        </div>
      )}
      {g.rowsTruncated && (
        <div className="notice amber" style={{ margin: '0 16px 12px' }}>
          <IconAlert size={15} />
          <div>سفارش‌های بیشتری وجود دارد — {faNum(g.rows.length)} مورد آخر نمایش داده شده‌اند.</div>
        </div>
      )}
    </section>
  )
}

function OpsRow({ row }: { row: OpsOrderRow }) {
  const meta = orderStatusMeta(row.status)
  return (
    <div className="rp-table">
      <span className="rp-t-cell-main">
        <span className="qo-match-name" dir="ltr">
          #{row.number}
        </span>
        <span className="qo-match-sub">{row.payment ? row.payment : '—'}</span>
      </span>
      <span className="qo-match-name" style={{ fontSize: 12 }}>
        {row.customer}
      </span>
      <span className="qo-match-sub num">{faDate(row.date)}</span>
      <span>
        <span className={'pill ' + meta.cls}>{meta.fa}</span>
      </span>
      <span className="num">{faNum(row.total)}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* موجودی                                                            */
/* ------------------------------------------------------------------ */

function StockTab({ catalog, threshold, onThreshold }: { catalog: Product[] | null; threshold: number; onThreshold: (n: number) => void }) {
  const alerts = catalog ? stockAlertsOf(catalog, threshold) : []
  const low = alerts.filter((a) => a.kind === 'low')
  const out = alerts.filter((a) => a.kind === 'out')
  const back = alerts.filter((a) => a.kind === 'back')
  const maxLow = Math.max(1, ...low.map((a) => a.qty ?? 0))

  return (
    <>
      <div className="stat-grid">
        <Kpi icon={<IconBox size={19} />} tone="t-amber" label="کمتر از حد نصاب" value={faNum(low.length)} hint={`موجودی ≤ ${faNum(threshold)}`} />
        <Kpi icon={<IconX size={19} />} tone="t-red" label="ناموجود" value={faNum(out.length)} hint="باید سریعاً سفارش داده شود" />
        <Kpi icon={<IconClock size={19} />} tone="t-indigo" label="عقب‌افتاده / سفارش بعدی" value={faNum(back.length)} hint="وضعیت onbackorder" />
        <Kpi icon={<IconStore size={19} />} tone="t-teal" label="کالاهای کاتالوگ" value={catalog ? faNum(catalog.length) : '—'} hint="تمام وضعیت‌های غیرحذف" />
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">هشدار کمبود موجودی</div>
            <div className="panel-sub">حد نصاب دلخواه شما؛ زیر آن در این گزارش هشدار داده می‌شود</div>
          </div>
          <span className="qo-cust-picked" style={{ gap: 6 }}>
            <IconBox size={13} /> حد نصاب:
            <input
              type="number"
              min={1}
              max={9999}
              value={threshold}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value))
                if (Number.isFinite(n) && n >= 1) onThreshold(Math.min(9999, n))
              }}
              className="rp-threshold-input"
            />
          </span>
        </div>
        {catalog === null ? (
          <div className="rp-body">
            <div className="sk" style={{ height: 14, width: '60%' }} />
            <div className="sk" style={{ height: 14, width: '80%' }} />
            <div className="sk" style={{ height: 14, width: '50%' }} />
          </div>
        ) : alerts.length === 0 ? (
          <div className="rp-body">
            <div className="pd-empty">همهٔ کالاها بالاتر از حد نصاب {faNum(threshold)} هستند — موجودی سالم است.</div>
          </div>
        ) : (
          <div className="rp-table-wrap">
            <div className="rp-table rp-table-head">
              <span>کالا</span>
              <span>دسته</span>
              <span>وضعیت</span>
              <span>موجودی</span>
              <span>وضعیت انبار</span>
            </div>
            {alerts.map((a) => {
              const kindMeta =
                a.kind === 'low'
                  ? { cls: 'pill-amber', fa: `کمبود (≤ ${faNum(threshold)})` }
                  : a.kind === 'out'
                    ? { cls: 'pill-red', fa: 'ناموجود' }
                    : { cls: 'pill-indigo', fa: 'عقب‌افتاده' }
              return (
                <div className="rp-table" key={a.product.id}>
                  <span className="rp-t-cell-main">
                    <span className="qo-match-name">{a.product.name}</span>
                    {a.product.sku ? <span className="qo-match-sub" dir="ltr">{a.product.sku}</span> : null}
                  </span>
                  <span className="qo-match-sub" style={{ fontSize: 11 }}>
                    {a.product.categories[0]?.name ?? '—'}
                  </span>
                  <span>
                    <span className={'pill ' + kindMeta.cls}>{kindMeta.fa}</span>
                  </span>
                  <span className="num" style={a.kind === 'low' ? { color: 'var(--amber, #fbbf24)' } : undefined}>
                    {a.kind === 'low' ? (
                      <span className="bar-wrap">
                        <MiniBar v={a.qty ?? 0} max={maxLow} cls="soft" />
                        {faNum(a.qty ?? 0)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </span>
                  <span className="qo-match-sub">{a.product.stock_status === 'instock' ? 'در انبار' : a.product.stock_status === 'outofstock' ? 'ناموجود' : 'سفارش بعدی'}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* صفحهٔ گزارشات                                                       */
/* ------------------------------------------------------------------ */

export default function ReportsView({ configured, conn, storeName, onGoSettings }: Props) {
  const [period, setPeriod] = useState<PeriodSel>({ days: 30 })
  const [custom, setCustom] = useState(false)
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const [rangeErr, setRangeErr] = useState<string | null>(null)
  const [tab, setTab] = useState<RepTab>('overview')
  const [report, setReport] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Product[] | null>(null)
  const [catError, setCatError] = useState<string | null>(null)
  const [catLoading, setCatLoading] = useState(false)
  const [threshold, setThreshold] = useState(5)
  const thresholdInit = useRef(false)

  const runReport = useCallback(
    async (sel: PeriodSel) => {
      if (!configured) return
      setLoading(true)
      setError(null)
      try {
        const query = 'days' in sel ? { days: sel.days } : { from: sel.from, to: sel.to }
        setReport(await api.getReports(query))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setReport(null)
      } finally {
        setLoading(false)
      }
    },
    [configured],
  )

  useEffect(() => {
    void runReport(period)
  }, [period, runReport])

  const pickPreset = (d: number) => {
    setCustom(false)
    setRangeErr(null)
    setPeriod({ days: d })
  }

  const pickCustom = () => {
    if (custom) return
    const from = 'days' in period ? localKeyDaysAgo(period.days - 1) : period.from
    const to = 'days' in period ? localKeyDaysAgo(0) : period.to
    setCustom(true)
    setRangeErr(null)
    setFromText(faDigits(localKeyToJalali(from) ?? ''))
    setToText(faDigits(localKeyToJalali(to) ?? ''))
  }

  const applyCustom = (f: string, t: string) => {
    if (!f || !t) {
      setRangeErr('هر دو تاریخ (از و تا) را وارد کنید — مثل ۱۴۰۵/۰۶/۱۶.')
      return
    }
    const fk = jalaliToLocalKey(f)
    const tk = jalaliToLocalKey(t)
    if (!fk || !tk) {
      setRangeErr('تاریخ نامعتبر است — فرمت را به‌صورت سال/ماه/روز وارد کنید.')
      return
    }
    const today = localKeyDaysAgo(0)
    if (tk > today) {
      setRangeErr('تاریخ پایان نمی‌تواند در آینده باشد.')
      return
    }
    if (fk > tk) {
      setRangeErr('تاریخ شروع بعد از تاریخ پایان است.')
      return
    }
    const span = Math.round((+new Date(tk) - +new Date(fk)) / 86400000) + 1
    if (span > 366) {
      setRangeErr('بازهٔ سفارشی حداکثر ۳۶۶ روز است.')
      return
    }
    setRangeErr(null)
    setPeriod({ from: fk, to: tk })
  }

  const onFromChange = (v: string) => {
    setFromText(v)
    if (toText) applyCustom(v, toText)
  }
  const onToChange = (v: string) => {
    setToText(v)
    if (fromText) applyCustom(fromText, v)
  }

  // Catalog is only needed by the محصولات / موجودی tabs — fetch lazily once.
  useEffect(() => {
    if (!configured || catalog !== null || (tab !== 'products' && tab !== 'stock')) return
    let cancelled = false
    setCatLoading(true)
    setCatError(null)
    api
      .getProductCatalog()
      .then((res) => {
        if (!cancelled) setCatalog(res.products)
      })
      .catch((e) => {
        if (!cancelled) setCatError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setCatLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [configured, catalog, tab])

  // Default threshold from saved settings, once.
  useEffect(() => {
    if (thresholdInit.current) return
    thresholdInit.current = true
    void api.getSettings().then((s) => {
      if (typeof s.lowStockThreshold === 'number' && Number.isFinite(s.lowStockThreshold)) {
        setThreshold(Math.min(9999, Math.max(1, Math.round(s.lowStockThreshold))))
      }
    })
  }, [])

  const setThresholdAndSave = (n: number) => {
    setThreshold(n)
    void api.getSettings().then((s) => void api.saveSettings({ ...s, lowStockThreshold: n }))
  }

  if (!configured) {
    return (
      <div className="page">
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber" style={{ marginInline: 'auto' }}>
              <IconChart size={28} />
            </div>
            <div className="empty-title">گزارشات فروش و مدیریتی</div>
            <div className="empty-sub">
              برای مشاهدهٔ گزارش فروش، مشتریان، محصولات و موجودی، ابتدا فروشگاه و کلیدهای API را در تنظیمات وارد کنید.
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

  const r = report
  const maxDay = r ? Math.max(1, ...r.daily.map((d) => d.total)) : 1

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">گزارشات</div>
          <div className="page-sub">
            گزارش فروش، مشتریان، محصولات و موجودی فروشگاه «{storeName ?? 'ووکامرس'}»{' '}
            {conn.state === 'fail' ? '· اتصال برقرار نیست' : ''}
          </div>
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div className="rp-tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={'rp-tab' + (tab === t.id ? ' active' : '')}
                onClick={() => setTab(t.id)}
              >
                {t.id === 'overview' ? <IconChart size={14} /> : t.id === 'customers' ? <IconUsers size={14} /> : t.id === 'products' ? <IconBox size={14} /> : t.id === 'orders' ? <IconBag size={14} /> : <IconStore size={14} />}
                {t.fa}
              </button>
            ))}
          </div>
          <div className="rp-tabs" style={{ marginInlineStart: 2 }}>
            {PERIODS.map((p) => (
              <button
                key={p.days}
                type="button"
                className={'os-chip' + (!custom && 'days' in period && period.days === p.days ? ' active' : '')}
                onClick={() => pickPreset(p.days)}
              >
                {p.fa}
              </button>
            ))}
            <button
              type="button"
              className={'os-chip' + (custom ? ' active' : '')}
              onClick={pickCustom}
            >
              <IconClock size={12} style={{ marginInlineEnd: 4 }} />
              بازهٔ سفارشی
            </button>
          </div>
          {custom && (
            <span className="range-picker">
              <span className="range-lbl">از</span>
              <input
                className="rp-range-input"
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                placeholder="۱۴۰۵/۰۶/۰۱"
                maxLength={10}
                value={fromText}
                onChange={(e) => onFromChange(e.target.value)}
              />
              <span className="range-lbl">تا</span>
              <input
                className="rp-range-input"
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                placeholder="۱۴۰۵/۰۶/۱۶"
                maxLength={10}
                value={toText}
                onChange={(e) => onToChange(e.target.value)}
              />
              {rangeErr && <span className="range-err">{rangeErr}</span>}
            </span>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void runReport(period)}
            disabled={loading}
            title="بارگذاری مجدد گزارش"
          >
            <IconRefresh size={14} className={loading ? 'spin' : ''} />
            به‌روزرسانی
          </button>
        </div>
      </div>

      <div className="f-hint" style={{ marginTop: -12 }}>
        مبالغ و تعدادها طبق قانون برنامهٔ مجموع خرید است — سفارش‌های ناموفق، لغو شده و بازپرداخت‌شده (و سبدهای رها شده) در فروش محاسبه نمی‌شوند.
      </div>

      {error && (
        <div className="notice err fade-in">
          <IconAlert size={15} />
          <div style={{ flex: 1 }}>{error}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void runReport(period)}>
            تلاش دوباره
          </button>
        </div>
      )}

      {isMock && !error && (
        <div className="notice amber" style={{ marginTop: 0 }}>
          <IconAlert size={15} />
          <div>گزارش روی دادهٔ آزمایشی (پیش‌نمایش) محاسبه شده است.</div>
        </div>
      )}

      {!r && !error && (
        <div className="stat-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="stat-card">
              <div className="sk" style={{ width: 42, height: 42, borderRadius: 12 }} />
              <div style={{ flex: 1 }}>
                <div className="sk" style={{ height: 11, width: '55%', marginBottom: 8 }} />
                <div className="sk" style={{ height: 15, width: '75%' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {r && tab === 'overview' && <OverviewTab r={r} maxDay={maxDay} />}
      {r && tab === 'customers' && <CustomerRows r={r} />}
      {r && tab === 'products' && <ProductsTab r={r} catalog={catalog ?? []} />}
      {r && tab === 'orders' && <OrdersTab r={r} />}
      {tab === 'stock' && (
        <>
          {catError && (
            <div className="notice err fade-in">
              <IconAlert size={15} />
              <div style={{ flex: 1 }}>بارگذاری کاتالوگ ناموفق بود: {catError}</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setCatalog(null)
                  setCatError(null)
                }}
              >
                تلاش دوباره
              </button>
            </div>
          )}
          {catLoading && catalog === null && (
            <div className="stat-grid">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="stat-card">
                  <div className="sk" style={{ width: 42, height: 42, borderRadius: 12 }} />
                  <div style={{ flex: 1 }}>
                    <div className="sk" style={{ height: 11, width: '55%', marginBottom: 8 }} />
                    <div className="sk" style={{ height: 15, width: '75%' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!catError && catalog && <StockTab catalog={catalog} threshold={threshold} onThreshold={setThresholdAndSave} />}
        </>
      )}

      {r && (
        <div className="f-hint" style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconStore size={14} /> بازه: {faDate(r.from)} تا {faDate(r.to)}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.65 }}>
            <IconClock size={13} /> مقایسه با دورهٔ قبل: {faDate(r.previous.from)} تا {faDate(r.previous.to)}
          </span>
          {r.truncated && (
            <span className="pill pill-dim">برخی سفارش‌ها از سقف بررسی فراتر بودند — اعداد ممکن است کمی کمتر از واقعیت باشند.</span>
          )}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: 'auto' }} onClick={onGoSettings}>
            <IconGear size={13} /> تنظیمات
          </button>
        </div>
      )}
    </div>
  )
}
