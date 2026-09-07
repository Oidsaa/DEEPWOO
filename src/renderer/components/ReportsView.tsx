import { useCallback, useEffect, useState } from 'react'
import type { ConnState, SalesReport } from '../../shared/types'
import { api, isMock } from '../api'
import { faDate, faNum, orderStatusMeta } from '../lib/format'
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
  IconWallet,
} from './Icons'

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

export default function ReportsView({ configured, conn, storeName, onGoSettings }: Props) {
  const [days, setDays] = useState(30)
  /** «فروش» = existing sales overview؛ «سود ناخالص» = gross-profit breakdown. */
  const [tab, setTab] = useState<'sales' | 'gross'>('sales')
  const [report, setReport] = useState<SalesReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (d: number) => {
      if (!configured) return
      setLoading(true)
      setError(null)
      try {
        setReport(await api.getReports({ days: d }))
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
    void load(days)
  }, [days, load])

  if (!configured) {
    return (
      <div className="page">
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber" style={{ marginInline: 'auto' }}>
              <IconChart size={28} />
            </div>
            <div className="empty-title">گزارشات فروش</div>
            <div className="empty-sub">
              برای مشاهدهٔ گزارش فروش و محصولات، ابتدا فروشگاه و کلیدهای API را در تنظیمات وارد کنید.
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
  const avg = r && r.totals.orders > 0 ? r.totals.revenue / r.totals.orders : 0
  // Previous equal-length window (same rule): its own avg = revenue / orders.
  const prevAvg = r && r.previous.orders > 0 ? r.previous.revenue / r.previous.orders : 0
  const maxDay = r ? Math.max(1, ...r.daily.map((d) => d.total)) : 1

  const dayLabelEvery = r ? Math.max(1, Math.ceil(r.daily.length / 12)) : 1

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="page-title">گزارشات</div>
          <div className="page-sub">
            گزارش فروش و محصولات فروشگاه «{storeName ?? 'ووکامرس'}»{' '}
            {conn.state === 'fail' ? '· اتصال برقرار نیست' : ''}
          </div>
        </div>
        <div className="toolbar" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <div className="rp-tabs">
            <button
              type="button"
              className={'rp-tab' + (tab === 'sales' ? ' active' : '')}
              onClick={() => setTab('sales')}
            >
              <IconChart size={14} />
              فروش
            </button>
            <button
              type="button"
              className={'rp-tab' + (tab === 'gross' ? ' active' : '')}
              onClick={() => setTab('gross')}
            >
              <IconWallet size={14} />
              سود ناخالص
            </button>
          </div>
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              className={'os-chip' + (days === p.days ? ' active' : '')}
              onClick={() => setDays(p.days)}
            >
              {p.fa}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void load(days)}
            disabled={loading}
            title="بارگذاری مجدد گزارش"
          >
            <IconRefresh size={14} className={loading ? 'spin' : ''} />
            به‌روزرسانی
          </button>
        </div>
      </div>

      <div className="f-hint" style={{ marginTop: -12 }}>
        مبالغ و تعدادها طبق قانون برنامهٔ مجموع خرید است — سفارش‌های ناموفق، لغو شده و بازپرداخت‌شده در نظر گرفته
        نمی‌شوند.
      </div>

      {error && (
        <div className="notice err fade-in">
          <IconAlert size={15} />
          <div style={{ flex: 1 }}>{error}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(days)}>
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

      {r && (tab === 'gross' ? (
        <GrossPanel r={r} onGoSettings={onGoSettings} />
      ) : (
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
                <GrowthChip cur={r.totals.revenue} prev={r.previous.revenue} />
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
                <GrowthChip cur={r.totals.orders} prev={r.previous.orders} />
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-ic t-amber">
                <IconLayers size={19} />
              </div>
              <div>
                <div className="stat-label">میانگین هر سفارش</div>
                <div className="stat-value">{faNum(Math.round(avg))}</div>
                <div className="stat-hint">تومان به ازای هر سفارش</div>
                <GrowthChip cur={avg} prev={prevAvg} />
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
                <div className="rp-chart" dir="ltr">
                  {r.daily.map((d, i) => {
                    const h = d.total > 0 ? Math.max(3, (d.total / maxDay) * 100) : 1.5
                    return (
                      <div className="rp-bar-col" key={d.date} title={`${faDate(d.date)} — ${faNum(d.total)} تومان · ${faNum(d.orders)} سفارش`}>
                        <div className="rp-bar-track">
                          <div className="rp-bar" style={{ height: h + '%' }} />
                        </div>
                        {(i % dayLabelEvery === 0 || i === r.daily.length - 1) && (
                          <div className="rp-bar-label">{faNum(Number(d.date.slice(8, 10)))}</div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <div className="qo-duo">
            {/* وضعیت سفارش */}
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

            {/* روش پرداخت */}
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
                          <span className="rp-row-val num">
                            {faNum(p.total)} تومان
                          </span>
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

          <div className="qo-duo">
            {/* پرفروش‌ترین محصولات */}
            <section className="panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">پرفروش‌ترین محصولات</div>
                  <div className="panel-sub">۱۰ محصول برتر بازه — بر اساس مبلغ فروش</div>
                </div>
              </div>
              <div className="rp-body">
                {r.products.length === 0 ? (
                  <div className="pd-empty">در این بازه محصولی فروخته نشده است.</div>
                ) : (
                  <div className="rp-prods">
                    {r.products.map((p, i) => {
                      const share = r.totals.revenue > 0 ? (p.revenue / r.totals.revenue) * 100 : 0
                      return (
                        <div className="rp-prod" key={p.id}>
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
                            <span className="qo-match-sub" style={{ textAlign: 'left' }}>
                              {share >= 0.1 ? share.toLocaleString('fa-IR', { maximumFractionDigits: 1 }) : '<۰٫۱'}٪ از فروش
                            </span>
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>

            {/* شهرها */}
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
              {r.truncated && (
                <div className="notice amber" style={{ margin: '0 16px 14px' }}>
                  <IconAlert size={15} />
                  <div>حجم سفارش‌های بازه از سقف بررسی فراتر رفت — اعداد ممکن است کمی کمتر از واقعیت باشند.</div>
                </div>
              )}
            </section>
          </div>

          <div className="f-hint" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <IconStore size={14} />
              بازه: {faDate(r.from)} تا {faDate(r.to)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.65 }}>
              <IconClock size={13} />
              مقایسه با دورهٔ قبل: {faDate(r.previous.from)} تا {faDate(r.previous.to)}
            </span>
          </div>
        </>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* سود ناخالص — reads تنظیمات productCosts (cost of goods per product). */
/* ------------------------------------------------------------------ */

function GrossPanel({ r, onGoSettings }: { r: SalesReport; onGoSettings: () => void }) {
  const p = r.profit
  const covered = p.coveredRevenue > 0
  return (
    <>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-ic t-teal">
            <IconWallet size={19} />
          </div>
          <div>
            <div className="stat-label">سود ناخالص بازه</div>
            <div className="stat-value">{covered ? faNum(p.grossProfit) : '—'}</div>
            <div className="stat-hint">فروش کالاهای دارای قیمت تمام‌شده، منهای بهای آن‌ها</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-amber">
            <IconLayers size={19} />
          </div>
          <div>
            <div className="stat-label">حاشیهٔ سود</div>
            <div className="stat-value">{p.marginPct === null ? '—' : faNum(p.marginPct) + '٪'}</div>
            <div className="stat-hint">سود ناخالص ÷ فروش کالاهای پوشش‌داده‌شده</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-indigo">
            <IconBox size={19} />
          </div>
          <div>
            <div className="stat-label">بهای تمام‌شده</div>
            <div className="stat-value">{faNum(p.cogs)}</div>
            <div className="stat-hint">جمع قیمت خرید کالاهای فروخته‌شده</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-ic t-teal">
            <IconBag size={19} />
          </div>
          <div>
            <div className="stat-label">فروش کالاها</div>
            <div className="stat-value">{faNum(p.coveredRevenue)}</div>
            <div className="stat-hint">
              {p.uncoveredRevenue > 0 ? `+ ${faNum(p.uncoveredRevenue)} تومان بدون قیمت` : 'همهٔ فروش پوشش داده شد'}
            </div>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">سود هر کالا</div>
            <div className="panel-sub">
              ردیف‌ها بر پایهٔ قیمت تمام‌شدهٔ ثبت‌شده در تنظیمات — کالاهای بدون قیمت در انتها با علامت «بدون قیمت»
            </div>
          </div>
          <span className="qo-cust-picked">
            <IconTag size={13} />
            {p.rows.length > 0
              ? `${p.uncoveredProducts === 0 ? '' : `${faNum(p.uncoveredProducts)} کالا بدون قیمت · `}${faNum(p.rows.length)} ردیف`
              : '—'}
          </span>
        </div>

        {p.uncoveredProducts > 0 && (
          <div className="notice amber" style={{ margin: '0 16px 10px' }}>
            <IconAlert size={15} />
            <div style={{ flex: 1 }}>
              {faNum(p.uncoveredProducts)} کالای فروخته‌شده قیمت تمام‌شده ندارند ({faNum(p.uncoveredRevenue)} تومان فروش) —
              سود آن‌ها در جمع سود ناخالص محاسبه نشده است.
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onGoSettings}>
              <IconGear size={14} />
              ثبت قیمت در تنظیمات
            </button>
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
            <div>تعداد کالاها بیش از سقف نمایش است — ردیف‌های برتر (بر اساس سود) نشان داده شده‌اند.</div>
          </div>
        )}
      </section>

      {!covered && p.uncoveredProducts === 0 && (
        <div className="notice info">
          <IconStore size={15} />
          <div style={{ flex: 1 }}>
            برای محاسبهٔ سود ناخالص، قیمت تمام‌شدهٔ (قیمت خرید) کالاها را در تنظیمات ثبت کنید.
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onGoSettings}>
            <IconGear size={14} />
            رفتن به تنظیمات
          </button>
        </div>
      )}
    </>
  )
}
/* ------------------------------------------------------------------ */
/* رشد نسبت به دورهٔ قبل (هم‌طول) — «compare with previous period».    */
/* ------------------------------------------------------------------ */

/** Percentage growth of `cur` vs the previous window; null when prev = 0. */
function growthOf(cur: number, prev: number): number | null {
  if (prev <= 0) return null
  return ((cur - prev) / prev) * 100
}

/** Small chip on a stat card showing the change vs the previous window. */
function GrowthChip({ cur, prev }: { cur: number; prev: number }) {
  const g = growthOf(cur, prev)
  if (g === null) {
    return (
      <span className="stat-delta flat" title="دورهٔ قبل در این بازه سفارشی نداشت">
        — نسبت به دورهٔ قبل
      </span>
    )
  }
  const cls = g > 0.05 ? 'up' : g < -0.05 ? 'down' : 'flat'
  const arrow = g > 0.05 ? '▲' : g < -0.05 ? '▼' : '●'
  const abs = Math.abs(g)
  const txt = abs >= 100 ? faNum(Math.round(abs)) : faNum(Math.round(abs * 10) / 10)
  return (
    <span className={'stat-delta ' + cls} title="نسبت به دورهٔ هم‌طول قبلی">
      {arrow} {txt}٪ نسبت به دورهٔ قبل
    </span>
  )
}
