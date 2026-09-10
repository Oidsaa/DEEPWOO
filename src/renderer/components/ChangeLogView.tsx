import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeLogEntry, ChangeLogSection, ChangeLogResult, ConnState } from '../../shared/types'
import { api } from '../api'
import { faDate, faDigits, faNum } from '../lib/format'
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

const faTime = (ts: number): string => {
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${faDate(d.toISOString())} • ${faDigits(`${hh}:${mm}`)}`
}

export default function ChangeLogView({ configured, conn, storeName, onGoSettings }: Props) {
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
  }, [debounced, load, configured, conn.state])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <div className="page">
      <div className="page-title-row">
        <div>
          <h1 className="page-title">لاگ تغییرات</h1>
          <p className="page-sub">هر اکشنی که کارشناس‌ها روی فروشگاه اعمال کرده‌اند — یکجا از همهٔ دستگاه‌ها{storeName ? ` — ${storeName}` : ''}</p>
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
      ) : (
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
                      <th>جزئیات</th>
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
                          <td className="log-title">{e.title}</td>
                          <td className="log-details">{e.details ?? ''}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="log-foot">
                <div className="log-count">
                  {faNum(total)} ردیف • صفحهٔ {faNum(page)} از {faNum(totalPages)}
                </div>
                <div className="log-pager">
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={page <= 1 || loading}
                    onClick={() => setDebounced((d) => ({ ...d, page: page - 1 }))}
                  >
                    <IconChevronR size={14} />
                    قبلی
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={page >= totalPages || loading}
                    onClick={() => setDebounced((d) => ({ ...d, page: page + 1 }))}
                  >
                    بعدی
                    <IconChevronL size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
