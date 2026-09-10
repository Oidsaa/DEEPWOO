import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeLogEntry, ChangeLogSection, ConnState } from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum } from '../lib/format'
import { useCurrency } from '../lib/currency'
import { IconBag, IconGrid, IconWallet } from './Icons'

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  userName: string | null
  onGoSettings: () => void
  onOpenLog: () => void
}

const SECTIONS: { id: ChangeLogSection | ''; fa: string; cls: string }[] = [
  { id: '', fa: 'عمومی', cls: 'pill-dim' },
  { id: 'orders', fa: 'سفارش‌ها', cls: 'pill-indigo' },
  { id: 'products', fa: 'محصولات', cls: 'pill-green' },
  { id: 'customers', fa: 'مشتریان', cls: 'pill-teal' },
  { id: 'warehouses', fa: 'انبارها', cls: 'pill-amber' },
  { id: 'settings', fa: 'تنظیمات', cls: 'pill-dim' },
  { id: 'system', fa: 'سیستم', cls: 'pill-dim' },
]

const sectionMeta = (id: string) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]

const faTime = (ts: number): string => {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${faDate(d.toISOString())} • ${faDigits(`${hh}:${mm}`)}`
}

const jalaliFullFmt = new Intl.DateTimeFormat('fa-IR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/** «پنجشنبه، ۱۹ شهریور ۱۴۰۵» — ترتیب را خودش می‌چیند چون fa-ICU سال را اول می‌گذارد. */
function jalaliLabel(d: Date): string {
  try {
    const p = jalaliFullFmt.formatToParts(d)
    const get = (t: string) => p.find((x) => x.type === t)?.value ?? ''
    return `${get('weekday')}، ${get('day')} ${get('month')} ${get('year')}`
  } catch {
    return jalaliFullFmt.format(d)
  }
}

/** ماه و روز شمسی به عدد لاتین — برای یافتن مناسبت روز. */
const jalaliPartsFmt = new Intl.DateTimeFormat('en-u-ca-persian', { month: 'numeric', day: 'numeric' })

/** مناسبت‌های رسمی تقویم شمسی — کلید «ماه/روز» جلالی. */
const OCCASIONS: Record<string, string> = {
  '1/1': 'جشن نوروز — آغاز سال نو',
  '1/2': 'عید نوروز',
  '1/3': 'عید نوروز',
  '1/4': 'عید نوروز',
  '1/12': 'روز جمهوری اسلامی',
  '1/13': 'سیزده‌بدر — روز طبیعت',
  '1/20': 'بزرگداشت سعدی',
  '1/21': 'بزرگداشت سعدی',
  '1/25': 'بزرگداشت عطار',
  '1/29': 'روز ارتش جمهوری اسلامی',
  '2/1': 'بزرگداشت سهروردی — روز زمین پاک',
  '2/3': 'بزرگداشت شیخ بهایی',
  '2/10': 'روز ملی خلیج فارس',
  '2/11': 'روز جهانی کارگر',
  '2/25': 'بزرگداشت فردوسی و پاسداشت زبان فارسی',
  '2/28': 'بزرگداشت خیام',
  '3/3': 'آزادسازی خرمشهر — روز مقاومت و پیروزی',
  '3/14': 'رحلت امام خمینی',
  '3/15': 'قیام ۱۵ خرداد',
  '4/7': 'روز قوهٔ قضاییه',
  '4/10': 'روز صنعت و معدن',
  '4/14': 'روز قلم',
  '4/25': 'روز بهزیستی و تأمین اجتماعی',
  '5/17': 'روز خبرنگار',
  '6/1': 'روز پزشک — بزرگداشت ابوعلی سینا',
  '6/13': 'روز تعاون',
  '6/27': 'روز شعر و ادب فارسی — بزرگداشت شهریار',
  '6/31': 'آغاز جنگ تحمیلی — هفتهٔ دفاع مقدس',
  '7/7': 'بزرگداشت مولوی — روز آتش‌نشانی',
  '7/13': 'روز نیروی انتظامی',
  '7/20': 'بزرگداشت حافظ',
  '8/1': 'روز آمار و برنامه‌ریزی',
  '8/13': 'روز دانش‌آموز',
  '8/24': 'روز کتاب و کتاب‌خوانی',
  '9/7': 'روز نیروی دریایی',
  '9/13': 'روز بیمه',
  '9/16': 'روز دانشجو',
  '9/30': 'شب یلدا (چله)',
  '10/5': 'روز ایمنی در برابر زلزله',
  '10/8': 'روز نیروی هوایی',
  '11/12': 'بازگشت امام خمینی به ایران',
  '11/22': 'پیروزی انقلاب اسلامی — دههٔ فجر',
  '12/5': 'روز مهندسی — بزرگداشت خواجه نصیرالدین طوسی',
  '12/15': 'روز درختکاری',
  '12/25': 'بزرگداشت پروین اعتصامی',
  '12/29': 'ملی شدن صنعت نفت',
}

function occasionOf(d: Date): string | null {
  try {
    const parts = jalaliPartsFmt.formatToParts(d)
    const m = Number(parts.find((p) => p.type === 'month')?.value)
    const day = Number(parts.find((p) => p.type === 'day')?.value)
    if (!m || !day) return null
    return OCCASIONS[`${m}/${day}`] ?? null
  } catch {
    return null
  }
}

/**Page through the user's own order-create entries and total their amounts. */
async function sumMyOrders(user: string): Promise<{ count: number; sum: number; error: string | null }> {
  let sum = 0
  try {
    const first = await api.getChangeLog({ user, section: 'orders', action: 'order-create', page: 1, perPage: 200 })
    for (const e of first.entries) sum += typeof e.amount === 'number' ? e.amount : 0
    const totalPages = Math.min(25, Math.ceil(first.total / 200))
    for (let p = 2; p <= totalPages; p++) {
      const r = await api.getChangeLog({ user, section: 'orders', action: 'order-create', page: p, perPage: 200 })
      for (const e of r.entries) sum += typeof e.amount === 'number' ? e.amount : 0
    }
    return { count: first.total, sum, error: null }
  } catch (err) {
    return { count: 0, sum: 0, error: err instanceof Error ? err.message : String(err) }
  }
}

export default function DashboardView({ configured, conn, storeName, userName, onGoSettings, onOpenLog }: Props) {
  const cur = useCurrency()
  const [now, setNow] = useState(() => new Date())
  const [recent, setRecent] = useState<ChangeLogEntry[] | null>(null)
  const [stats, setStats] = useState<{ count: number; sum: number; error: string | null } | null>(null)
  const seq = useRef(0)

  // ساعت زنده — هر ثانیه تیک می‌خورد (زمان محلی دستگاه، همگام با ساعت ایران).
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    const mySeq = ++seq.current
    setRecent(null)
    setStats(null)
    try {
      const r = await api.getChangeLog({ page: 1, perPage: 10, user: userName || undefined })
      if (seq.current !== mySeq) return
      setRecent(r.entries.slice(0, 5))
    } catch {
      if (seq.current === mySeq) setRecent([])
    }
    if (userName) {
      const s = await sumMyOrders(userName)
      if (seq.current === mySeq) setStats(s)
    }
  }, [userName])

  useEffect(() => {
    void load()
  }, [load, configured, conn.state])

  const clock = () => {
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    return faDigits(`${hh}:${mm}:${ss}`)
  }

  const dateLabel = jalaliLabel(now)
  const occ = occasionOf(now)

  return (
    <div className="page">
      {!configured ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber">
              <IconGrid size={30} />
            </div>
            <div className="empty-title">پیشخوان هنوز به فروشگاه وصل نیست</div>
            <div className="empty-sub">
              برای خوش‌آمدگویی، آمار سفارش‌های شما و آخرین اکشن‌ها، ابتدا در تنظیمات کلید API را وارد کنید.
            </div>
            <button type="button" className="chip-btn" onClick={onGoSettings}>
              رفتن به تنظیمات
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* خوش‌آمد + تقویم و ساعت ایرانی — تاریخ و ساعت راست‌چین */}
          <div className="panel dash-hero">
            <div className="dash-datebox">
              <div className="dash-date">{dateLabel}</div>
              <div className="dash-clock" dir="ltr">
                {clock()}
              </div>
              {occ && <div className="dash-occ">{occ}</div>}
            </div>
            <div className="dash-hello">
              <div className="dash-hello-title">
                سلام، {userName?.trim() || 'کارشناس'}
              </div>
              <div className="dash-hello-sub">
                به پیشخوان فروشگاه «{storeName ?? 'ووکامرس'}» خوش آمدید — همه‌چیز از این‌جا یک نگاه روشن است.
              </div>
            </div>
          </div>

          {/* آمار سفارش‌های دستیِ خود کارشناس */}
          <div className="dash-cards">
            <div className="panel dash-card">
              <div className="dash-card-ic indigo">
                <IconBag size={22} />
              </div>
              <div>
                <div className="dash-card-num">
                  {stats === null ? '…' : stats.error ? '—' : faNum(stats.count)}
                </div>
                <div className="dash-card-lbl">سفارش‌هایی که خودم ثبت کرده‌ام</div>
              </div>
            </div>
            <div className="panel dash-card">
              <div className="dash-card-ic teal">
                <IconWallet size={22} />
              </div>
              <div>
                <div className="dash-card-num">
                  {stats === null ? '…' : stats.error ? '—' : `${faNum(stats.sum)} ${cur}`}
                </div>
                <div className="dash-card-lbl">مجموع مبلغ سفارش‌های من</div>
              </div>
            </div>
          </div>
          {stats?.error ? <div className="dash-warn">خواندن آمار سفارش‌ها ممکن نشد: {stats.error}</div> : null}
          {!userName ? (
            <div className="dash-warn">
              کارشناسِ این دستگاه شناسایی نشد — برای نمایش آمار سفارش‌های خودتان، در تنظیمات دوباره به فروشگاه وصل شوید.
            </div>
          ) : null}

          {/* ۵ اکشن آخر */}
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">آخرین اکشن‌های شما</div>
                <div className="panel-sub">۵ تغییر آخر که روی فروشگاه اعمال کرده‌اید</div>
              </div>
              <button type="button" className="chip-btn" onClick={onOpenLog}>
                همهٔ اکشن‌ها
              </button>
            </div>
            {recent === null ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconGrid size={26} />
                </div>
                <div className="empty-title">در حال خواندن اکشن‌ها…</div>
              </div>
            ) : recent.length === 0 ? (
              <div className="empty">
                <div className="empty-ic">
                  <IconGrid size={26} />
                </div>
                <div className="empty-title">هنوز اکشنی از شما ثبت نشده</div>
                <div className="empty-sub">
                  با اولین تغییری که در فروشگاه اعمال کنید، همین‌جا دیده می‌شود.
                </div>
              </div>
            ) : (
              <div className="dash-list">
                {recent.map((e, i) => {
                  const meta = sectionMeta(e.section)
                  return (
                    <div className="dash-row" key={`${e.ts}-${i}`}>
                      <span className="dash-row-time">{faTime(e.ts)}</span>
                      <span className="dash-row-title">{e.title}</span>
                      <span className={`pill ${meta.cls}`}>{meta.fa}</span>
                      <span className="dash-row-user">{e.user}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
