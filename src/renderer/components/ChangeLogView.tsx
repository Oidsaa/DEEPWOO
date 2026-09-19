import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChangeLogEntry,
  ChangeLogSection,
  ChangeLogResult,
  ConnState,
  SyncChangeEntry,
  SyncChangeQuery,
  SyncChangeResult,
} from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum } from '../lib/format'
import { useSyncRefresh } from '../lib/liveSync'
import { IconChevronL, IconChevronR, IconClock, IconSearch } from './Icons'

interface Props {
  configured: boolean
  conn: ConnState
  storeName: string | null
  onGoSettings: () => void
}

const PER_PAGE = 50

const SECTIONS: { id: ChangeLogSection | ''; fa: string; cls: string }[] = [
  { id: '', fa: 'همهٔ بخش‌ها', cls: '' },
  { id: 'orders', fa: 'سفارش‌ها', cls: 'pill-indigo' },
  { id: 'products', fa: 'محصولات', cls: 'pill-green' },
  { id: 'customers', fa: 'مشتریان', cls: 'pill-teal' },
  { id: 'warehouses', fa: 'انبارها', cls: 'pill-amber' },
  { id: 'settings', fa: 'تنظیمات', cls: 'pill-dim' },
  { id: 'system', fa: 'سیستم', cls: 'pill-dim' },
]

const sectionMeta = (id: string) => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0]

const ENTITY_META: Record<string, { fa: string; cls: string }> = {
  orders: { fa: 'سفارش‌ها', cls: 'pill-indigo' },
  products: { fa: 'محصولات', cls: 'pill-green' },
  customers: { fa: 'مشتریان', cls: 'pill-teal' },
}

const CHANGE_META: Record<string, { fa: string; cls: string }> = {
  created: { fa: 'ایجاد', cls: 'pill-green' },
  updated: { fa: 'بروزرسانی', cls: 'pill-indigo' },
  status_changed: { fa: 'تغییر وضعیت', cls: 'pill-amber' },
}

const faTime = (ts: number): string => {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${faDate(d.toISOString())} • ${faDigits(`${hh}:${mm}`)}`
}

/** بستهٔ مشترک سربرگ + تب‌ها — یک تب اکشن‌های کارشناس‌ها، یک تب تغییراتِ سینک. */
export default function ChangeLogView({ configured, conn, storeName, onGoSettings }: Props) {
  const [tab, setTab] = useState<'staff' | 'store'>('staff')

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">لاگ تغییرات</h1>
          <p className="page-sub">
            اکشن‌های کارشناس‌ها و تغییرات تشخیص‌داده‌شده از فروشگاه — یکجا
            {storeName ? ` — ${storeName}` : ''}
          </p>
        </div>
        <div className="theme-seg">
          <button type="button" className={'theme-opt' + (tab === 'staff' ? ' active' : '')} onClick={() => setTab('staff')}>
            اکشن‌های کارشناس‌ها
          </button>
          <button type="button" className={'theme-opt' + (tab === 'store' ? ' active' : '')} onClick={() => setTab('store')}>
            تغییرات فروشگاه
          </button>
        </div>
      </div>

      {!configured ? (
        <div className="panel">
          <div className="empty">
            <div className="empty-ic amber">
              <IconClock size={30} />
            </div>
            <div className="empty-title">اتصال به فروشگاه برقرار نیست</div>
            <div className="empty-sub">
              برای ثبت و نمایش لاگ تغییرات، ابتدا در تنظیمات کلید API را وارد کنید و به فروشگاه متصل شوید.
            </div>
            <button type="button" className="btn btn-primary" onClick={onGoSettings}>
              رفتن به تنظیمات
            </button>
          </div>
        </div>
      ) : tab === 'staff' ? (
        <StaffLog conn={conn} />
      ) : (
        <StoreChanges />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* تب ۱ — اکشن‌های کارشناس‌ها (لاگ مشترک برنامه)                          */
/* ------------------------------------------------------------------ */

function StaffLog({ conn }: { conn: ConnState }) {
  const [entries, setEntries] = useState<ChangeLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [users, setUsers] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [user, setUser] = useState('')
  const [section, setSection] = useState<ChangeLogSection | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const [debounced, setDebounced] = useState({ search: '', user: '', section: '' as ChangeLogSection | '', page: 1 })

  const load = useCallback(async (q: typeof debounced) => {
    const mySeq = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const r: ChangeLogResult = await api.getChangeLog({
        page: q.page,
        perPage: PER_PAGE,
        search: q.search || undefined,
        user: q.user || undefined,
        section: q.section || undefined,
      })
      if (seq.current !== mySeq) return
      setEntries(r.entries)
      setTotal(r.total)
      setUsers(r.users)
      setPage(r.page)
    } catch (err) {
      if (seq.current !== mySeq) return
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
      setTotal(0)
    } finally {
      if (seq.current === mySeq) setLoading(false)
    }
  }, [])

  // کاربر تایپ می‌کند → جستجو با تأخیر کوتاه؛ تغییر فیلترها از صفحهٔ اول.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebounced((d) => ({ ...d, search, user, section, page: 1 }))
    }, 280)
    return () => window.clearTimeout(t)
  }, [search, user, section])

  useEffect(() => {
    void load(debounced)
  }, [debounced, load, conn.state])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="panel">
      <div className="toolbar log-toolbar">
        <div className="search">
          <span className="search-ic">
            <IconSearch size={15} />
          </span>
          <input
            type="text"
            placeholder="جستجو در اکشن‌ها و جزئیات…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="sel" value={user} onChange={(e) => setUser(e.target.value)}>
          <option value="">همهٔ کارشناس‌ها</option>
          {users.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select
          className="sel"
          value={section}
          onChange={(e) => setSection(e.target.value as ChangeLogSection | '')}
        >
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fa}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="empty">
          <div className="empty-ic amber">
            <IconClock size={30} />
          </div>
          <div className="empty-title">خواندن لاگ ممکن نشد</div>
          <div className="empty-sub">{error}</div>
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconClock size={30} />
          </div>
          <div className="empty-title">در حال خواندن لاگ…</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconClock size={30} />
          </div>
          <div className="empty-title">تغییری ثبت نشده</div>
          <div className="empty-sub">
            {search || user || section
              ? 'با این فیلترها ردیفی پیدا نشد؛ فیلترها را ساده‌تر کنید.'
              : 'از این پس، هر تغییری که کارشناس‌ها اعمال کنند همین‌جا ثبت می‌شود.'}
          </div>
        </div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl tbl-log">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>کارشناس</th>
                  <th>بخش</th>
                  <th>اکشن</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const meta = sectionMeta(e.section)
                  return (
                    <tr key={`${e.ts}-${i}`}>
                      <td className="log-time">{faTime(e.ts)}</td>
                      <td>{e.user}</td>
                      <td>
                        <span className={`pill ${meta.cls}`}>{meta.fa}</span>
                      </td>
                      <td className="log-title">
                        {e.title}
                        {e.details ? <span className="log-sub">{e.details}</span> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <LogFoot total={total} page={page} totalPages={totalPages} loading={loading} onPage={(p) => setDebounced((d) => ({ ...d, page: p }))} />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* تب ۲ — تغییرات فروشگاه (تغییرات تشخیص‌داده‌شده هنگام سینک)              */
/* ------------------------------------------------------------------ */

function StoreChanges() {
  const [entries, setEntries] = useState<SyncChangeEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [entity, setEntity] = useState<'' | 'orders' | 'products' | 'customers'>('')
  const [changeType, setChangeType] = useState<SyncChangeQuery['changeType']>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const syncBump = useSyncRefresh()

  const load = useCallback(async (q: SyncChangeQuery) => {
    const mySeq = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const r: SyncChangeResult = await api.getSyncChanges({ perPage: PER_PAGE, ...q })
      if (seq.current !== mySeq) return
      setEntries(r.entries)
      setTotal(r.total)
      setPage(r.page)
    } catch (err) {
      if (seq.current !== mySeq) return
      setError(err instanceof Error ? err.message : String(err))
      setEntries([])
      setTotal(0)
    } finally {
      if (seq.current === mySeq) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load({ page: 1, entity: entity || undefined, changeType: changeType || undefined })
  }, [load, entity, changeType, syncBump])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="panel">
      <div className="toolbar log-toolbar">
        <select
          className="sel"
          value={entity}
          onChange={(e) => setEntity(e.target.value as typeof entity)}
        >
          <option value="">همهٔ موجودیت‌ها</option>
          <option value="orders">سفارش‌ها</option>
          <option value="products">محصولات</option>
          <option value="customers">مشتریان</option>
        </select>
        <select
          className="sel"
          value={changeType ?? ''}
          onChange={(e) => setChangeType((e.target.value || undefined) as SyncChangeQuery['changeType'])}
        >
          <option value="">همهٔ تغییرها</option>
          <option value="created">ایجاد</option>
          <option value="updated">بروزرسانی</option>
          <option value="status_changed">تغییر وضعیت</option>
        </select>
        <div className="log-count" style={{ marginInlineStart: 'auto' }}>
          {faNum(total)} ردیف
        </div>
      </div>

      {error ? (
        <div className="empty">
          <div className="empty-ic amber">
            <IconClock size={30} />
          </div>
          <div className="empty-title">خواندن تغییرات ممکن نشد</div>
          <div className="empty-sub">{error}</div>
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconClock size={30} />
          </div>
          <div className="empty-title">در حال خواندن تغییرات…</div>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty">
          <div className="empty-ic">
            <IconClock size={30} />
          </div>
          <div className="empty-title">تغییری ثبت نشده</div>
          <div className="empty-sub">
            {entity || changeType
              ? 'با این فیلترها ردیفی پیدا نشد؛ فیلترها را ساده‌تر کنید.'
              : 'سینک پس‌زمینه هر تغییرِ سفارش، محصول و مشتریِ فروشگاه را همین‌جا ثبت می‌کند.'}
          </div>
        </div>
      ) : (
        <>
          <div className="tbl-wrap">
            <table className="tbl tbl-log">
              <thead>
                <tr>
                  <th>زمان</th>
                  <th>موجودیت</th>
                  <th>نوع</th>
                  <th>تغییر</th>
                  <th>لحاظ‌شده توسط</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const em = ENTITY_META[e.entity] ?? { fa: e.entity, cls: 'pill-dim' }
                  const cm = CHANGE_META[e.changeType] ?? { fa: e.changeType, cls: 'pill-dim' }
                  return (
                    <tr key={e.id}>
                      <td className="log-time">{faTime(e.ts)}</td>
                      <td>
                        <span className={`pill ${em.cls}`}>{em.fa}</span>
                      </td>
                      <td>
                        <span className={`pill ${cm.cls}`}>{cm.fa}</span>
                      </td>
                      <td className="log-title">
                        {e.summary}
                        <span className="log-details"> — {faNum(e.entityId)}</span>
                        {e.details ? <span className="log-sub">{e.details}</span> : null}
                      </td>
                      <td className="log-actor">{e.actor ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <LogFoot
            total={total}
            page={page}
            totalPages={totalPages}
            loading={loading}
            onPage={(p) => {
              setPage(p)
              void load({ page: p, entity: entity || undefined, changeType: changeType || undefined })
            }}
          />
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pager مشترک                                                          */
/* ------------------------------------------------------------------ */

function LogFoot({
  total,
  page,
  totalPages,
  loading,
  onPage,
}: {
  total: number
  page: number
  totalPages: number
  loading: boolean
  onPage: (page: number) => void
}) {
  return (
    <div className="log-foot">
      <div className="log-count">
        {faNum(total)} ردیف • صفحهٔ {faNum(page)} از {faNum(totalPages)}
      </div>
      <div className="log-pager">
        <button type="button" className="btn btn-sm btn-ghost" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          <IconChevronR size={14} />
          قبلی
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
        >
          بعدی
          <IconChevronL size={14} />
        </button>
      </div>
    </div>
  )
}
