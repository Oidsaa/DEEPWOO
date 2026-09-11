import { useEffect, useState } from 'react'
import type { AccountsSnapshot, ConnectionResult, ConnState, OrderStatusTotal, Product, Settings, WarehouseDef } from '../../shared/types'
import { DEFAULT_WAREHOUSES, slugifyWarehouseId } from '../../shared/warehouses'
import { api } from '../api'
import { faDigits, ORDER_STATUS_META, toLatin } from '../lib/format'
import { useCurrency } from '../lib/currency'
import { applyAppearance } from '../lib/theme'
import {
  IconAlert,
  IconCheck,
  IconClock,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconLink,
  IconMoon,
  IconNote,
  IconPlus,
  IconPrint,
  IconRefresh,
  IconSearch,
  IconShield,
  IconStore,
  IconSun,
  IconTag,
  IconTrash,
  IconUpload,
  IconUsers,
} from './Icons'

/* ------------------------------------------------------------------ */
/* Store-logo helpers (file → downscaled data URL, stored in settings) */
/* ------------------------------------------------------------------ */

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('خواندن فایل ناموفق بود'))
    fr.readAsDataURL(file)
  })
}

/** Downscale an image to ≤500px wide so settings.json stays small. */
async function pickLogoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('فایل تصویر معتبر نیست'))
      im.src = url
    })
    const maxW = 500
    const scale = Math.min(1, maxW / (img.naturalWidth || 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('پردازش تصویر ممکن نیست')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface Props {
  settings: Settings | null
  conn: ConnState
  onSaved: () => Promise<void>
  /** بعد از افزودن/حذف اکانت: تنظیمات و وضعیت اتصال در App تازه شود (بدون پرش از تنظیمات). */
  onAccountsChanged?: () => Promise<void>
}

/** رنگ‌های آمادهٔ تأکیدی — علاوه بر انتخابگر رنگ دلخواه. */
const ACCENT_PRESETS: Array<{ name: string; hex: string }> = [
  { name: 'فیروزه‌ای (پیش‌فرض)', hex: '#2dd4bf' },
  { name: 'آبی', hex: '#3b82f6' },
  { name: 'نیلی', hex: '#6366f1' },
  { name: 'بنفش', hex: '#8b5cf6' },
  { name: 'صورتی', hex: '#ec4899' },
  { name: 'سرخ', hex: '#f43f5e' },
  { name: 'نارنجی', hex: '#f97316' },
  { name: 'سبز', hex: '#22c55e' },
]

/** Options for the per-warehouse order-status select — exactly the statuses registered on the store. */
function statusOptions(site: OrderStatusTotal[] | null): Array<{ slug: string; label: string }> {
  if (site) {
    return site.map((s) => ({
      slug: s.slug,
      label: ORDER_STATUS_META[s.slug]?.fa ?? (s.name && s.name !== s.slug ? s.name : s.slug.replace(/-/g, ' ')),
    }))
  }
  return Object.entries(ORDER_STATUS_META).map(([slug, m]) => ({ slug, label: m.fa }))
}

export default function SettingsView({ settings, conn, onSaved, onAccountsChanged }: Props) {
  const cur = useCurrency()
  const [form, setForm] = useState<Settings>({ siteUrl: '', consumerKey: '', consumerSecret: '' })
  const [showSecret, setShowSecret] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null)
  const [armClear, setArmClear] = useState(false)
  // Cost-of-goods (قیمت تمام‌شده) editor: search → rows with a cost input each.
  const [costQuery, setCostQuery] = useState('')
  const [costRows, setCostRows] = useState<Product[] | null>(null)
  const [costLoading, setCostLoading] = useState(false)
  const [costErr, setCostErr] = useState<string | null>(null)
  const [siteStatuses, setSiteStatuses] = useState<OrderStatusTotal[] | null>(null)
  // اکانت‌های کارشناس: فهرست + فرم افزودن.
  const [accounts, setAccounts] = useState<AccountsSnapshot | null>(null)
  const [acctBusy, setAcctBusy] = useState<string | null>(null)
  const [acctErr, setAcctErr] = useState<string | null>(null)
  const [acctOk, setAcctOk] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newCk, setNewCk] = useState('')
  const [newCs, setNewCs] = useState('')

  const refreshAccounts = () => {
    api
      .listAccounts()
      .then((snap) => {
        setAccounts(snap)
        // فرم اتصال باید همیشه کلیدهای اکانتِ فعال را نشان دهد.
        setForm((f) => ({ ...f, accounts: snap.accounts, activeAccountId: snap.activeId ?? undefined }))
      })
      .catch(() => setAccounts(null))
  }

  useEffect(() => {
    refreshAccounts()
  }, [])

  useEffect(() => {
    let alive = true
    api
      .listOrderStatusTotals()
      .then((list) => {
        if (!alive) return
        const usable = list.filter((s) => s.slug !== 'trash')
        setSiteStatuses(usable.length > 0 ? usable : null)
      })
      .catch(() => {
        if (alive) setSiteStatuses(null)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

  // Debounced product search for the cost editor (fires on the demo/real listProducts).
  useEffect(() => {
    setCostErr(null)
    if (costQuery.trim().length === 0) {
      setCostRows(null)
      setCostLoading(false)
      return
    }
    setCostLoading(true)
    const t = window.setTimeout(() => {
      api
        .listProducts({ search: costQuery.trim(), perPage: 15 })
        .then((res) => setCostRows(res.products))
        .catch((e) => {
          setCostRows(null)
          setCostErr(e instanceof Error ? e.message : String(e))
        })
        .finally(() => setCostLoading(false))
    }, 380)
    return () => window.clearTimeout(t)
  }, [costQuery])

  /** Set/update the unit cost (تومان) of one product in the settings draft. */
  const setUnitCost = (id: number, raw: string) => {
    const n = Number(toLatin(raw))
    setForm((f) => {
      const next = { ...(f.productCosts ?? {}) }
      if (Number.isFinite(n) && n > 0) next[String(id)] = Math.round(n)
      else delete next[String(id)]
      return { ...f, productCosts: next }
    })
  }

  const costCount = Object.keys(form.productCosts ?? {}).length

  useEffect(() => {
    if (!savedFlash) return
    const t = window.setTimeout(() => setSavedFlash(false), 2600)
    return () => window.clearTimeout(t)
  }, [savedFlash])

  useEffect(() => {
    if (!armClear) return
    const t = window.setTimeout(() => setArmClear(false), 4000)
    return () => window.clearTimeout(t)
  }, [armClear])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  /* ---- ظاهر برنامه (تم + رنگ تأکیدی) با پیش‌نمایش فوری ---- */

  const setTheme = (t: 'dark' | 'light') => {
    set('theme', t)
    applyAppearance(t, form.accentColor)
  }

  const setAccent = (hex?: string) => {
    set('accentColor', hex)
    applyAppearance(form.theme, hex)
  }

  // اگر کاربر بدون ذخیره از تنظیمات خارج شود، ظاهرِ ذخیره‌شده برمی‌گردد.
  useEffect(() => {
    return () => applyAppearance(settings?.theme, settings?.accentColor)
  }, [settings?.theme, settings?.accentColor])

  /* ---- انبارها (multi-warehouse definitions) ---- */

  const warehouses: WarehouseDef[] = form.warehouses ?? DEFAULT_WAREHOUSES

  const updateWh = (idx: number, patch: Partial<WarehouseDef>) => {
    setForm((f) => ({
      ...f,
      warehouses: (f.warehouses ?? DEFAULT_WAREHOUSES).map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    }))
  }

  const addWh = () => {
    setForm((f) => {
      const list = f.warehouses ?? DEFAULT_WAREHOUSES
      if (list.length >= 8) return f
      return { ...f, warehouses: [...list, { id: '', name: '' }] }
    })
  }

  const removeWh = (idx: number) => {
    setForm((f) => ({ ...f, warehouses: (f.warehouses ?? DEFAULT_WAREHOUSES).filter((_, i) => i !== idx) }))
  }

  /** Only ONE warehouse receives the quick-order (سفارش سریع) allocations. */
  const setQuickWh = (idx: number) => {
    setForm((f) => ({
      ...f,
      warehouses: (f.warehouses ?? DEFAULT_WAREHOUSES).map((w, i) => ({
        ...w,
        quickOrder: i === idx ? true : undefined,
      })),
    }))
  }

  const validate = (): string | null => {
    if (!form.siteUrl.trim()) return 'آدرس سایت را وارد کنید.'
    if (!form.consumerKey.trim()) return 'کلید مصرف‌کننده (Consumer Key) را وارد کنید.'
    if (!form.consumerSecret.trim()) return 'رمز مصرف‌کننده (Consumer Secret) را وارد کنید.'
    const url = /^https?:\/\//i.test(form.siteUrl.trim())
      ? form.siteUrl.trim()
      : 'https://' + form.siteUrl.trim()
    try {
      new URL(url)
    } catch {
      return 'آدرس سایت معتبر نیست.'
    }
    return null
  }

  const handleSave = async () => {
    const err = validate()
    setValidation(err)
    if (err) return
    setSaving(true)
    try {
      await api.saveSettings(form)
      setSavedFlash(true)
      setTestResult(null)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const err = validate()
    setValidation(err)
    if (err) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.testConnection(form)
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      set('storeLogo', await pickLogoDataUrl(file))
    } catch {
      try {
        set('storeLogo', await readAsDataUrl(file))
      } catch {
        setValidation('انتخاب لوگو ناموفق بود؛ فایل تصویر دیگری را امتحان کنید.')
      }
    }
  }

  const handleClear = async () => {
    if (!armClear) {
      setArmClear(true)
      return
    }
    await api.clearSettings()
    setArmClear(false)
    setTestResult(null)
    setSavedFlash(false)
    await onSaved()
  }

  /* ---- اکانت‌های کارشناس: افزودن / حذف ---- */

  const handleAddAccount = async () => {
    if (!newCk.trim() || !newCs.trim()) {
      setAcctErr('کلید و رمز API اکانت جدید الزامی است.')
      return
    }
    setAcctBusy('add')
    setAcctErr(null)
    setAcctOk(false)
    try {
      const snap = await api.addAccount({ label: newLabel, consumerKey: newCk, consumerSecret: newCs })
      setAccounts(snap)
      setNewLabel('')
      setNewCk('')
      setNewCs('')
      setAddOpen(false)
      setAcctOk(true)
      if (onAccountsChanged) await onAccountsChanged()
      refreshAccounts()
    } catch (e) {
      setAcctErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAcctBusy(null)
    }
  }

  const handleRemoveAccount = async (id: string) => {
    setAcctBusy(id)
    setAcctErr(null)
    setAcctOk(false)
    try {
      const snap = await api.removeAccount(id)
      setAccounts(snap)
      if (onAccountsChanged) await onAccountsChanged()
      refreshAccounts()
    } catch (e) {
      setAcctErr(e instanceof Error ? e.message : String(e))
    } finally {
      setAcctBusy(null)
    }
  }

  useEffect(() => {
    if (!acctOk) return
    const t = window.setTimeout(() => setAcctOk(false), 4200)
    return () => window.clearTimeout(t)
  }, [acctOk])

  return (
    <div className="page fade-in">
      <div className="page-head">
        <div>
          <h1 className="page-title">تنظیمات</h1>
          <div className="page-sub">اتصال امن به API ووکامرس فروشگاه شما</div>
        </div>
      </div>

      {validation && (
        <div className="notice err">
          <IconAlert size={17} />
          <div>{validation}</div>
        </div>
      )}

      <div className="settings-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">اتصال به فروشگاه</div>
              <div className="panel-sub">کلیدهای REST API ووکامرس را وارد کنید</div>
            </div>
            <div className="chip">
              <IconStore size={13} />
              ووکامرس REST API v3
            </div>
          </div>

          <div className="form-body">
            <div className="field">
              <label className="lbl" htmlFor="siteUrl">
                آدرس سایت <span className="req">*</span>
              </label>
              <input
                id="siteUrl"
                className="input ltr"
                type="text"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://example.com"
                value={form.siteUrl}
                onChange={(e) => set('siteUrl', e.target.value)}
              />
              <span className="f-hint">
                آدرس سایت فروشگاه (بدون نیاز به ذکر wp-json)؛ مسیر
                <span className="code-hint"> /wp-json/wc/v3 </span>
                به‌صورت خودکار اضافه می‌شود.
              </span>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="ck">
                کلید مصرف‌کننده (Consumer Key) <span className="req">*</span>
              </label>
              <input
                id="ck"
                className="input ltr code-hint"
                type="text"
                dir="ltr"
                autoComplete="off"
                spellCheck={false}
                placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                value={form.consumerKey}
                onChange={(e) => set('consumerKey', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="cs">
                رمز مصرف‌کننده (Consumer Secret) <span className="req">*</span>
              </label>
              <div className="input-wrap">
                <input
                  id="cs"
                  className="input ltr code-hint"
                  type={showSecret ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={form.consumerSecret}
                  onChange={(e) => set('consumerSecret', e.target.value)}
                />
                <button
                  type="button"
                  className="eye-btn"
                  aria-label={showSecret ? 'پنهان کردن' : 'نمایش'}
                  onClick={() => setShowSecret((v) => !v)}
                >
                  {showSecret ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                </button>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={handleTest} disabled={testing || saving}>
                {testing ? <IconRefresh size={16} className="spin" /> : <IconLink size={16} />}
                {testing ? 'در حال بررسی…' : 'تست اتصال'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>

            {testResult && (
              <div className={'notice ' + (testResult.ok ? 'ok' : 'err')}>
                {testResult.ok ? <IconCheck size={17} /> : <IconAlert size={17} />}
                <div>{testResult.message}</div>
              </div>
            )}

            {!testResult && conn.state === 'fail' && (
              <div className="notice err">
                <IconAlert size={17} />
                <div>{conn.message}</div>
              </div>
            )}

            <div className="notice info">
              <IconShield size={17} />
              <div>
                کلیدها فقط روی همین دستگاه ذخیره می‌شوند و هرگز از برنامه خارج نمی‌شوند. توصیه می‌شود دسترسی کلید را روی
                «خواندن» (Read) قرار دهید؛ برای «افزودن مشتری» هم کلید باید دسترسی «خواندن/نوشتن» (Read/Write) داشته باشد.
              </div>
            </div>

            <div className="danger-zone">
              <div className="dz-txt">
                <div className="dz-title">پاک‌سازی تنظیمات</div>
                کلیدهای ذخیره‌شده و اطلاعات اتصال از این دستگاه حذف می‌شود.
              </div>
              <button
                type="button"
                className={'btn btn-sm ' + (armClear ? 'btn-danger-ghost' : 'btn-ghost')}
                onClick={handleClear}
              >
                <IconTrash size={14} />
                {armClear ? 'برای تأیید دوباره کلیک کنید' : 'پاک کردن تنظیمات'}
              </button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">راهنمای گام‌به‌گام اتصال</div>
              <div className="panel-sub">ساخت کلید API از پیشخوان ووکامرس</div>
            </div>
          </div>
          <div style={{ padding: '8px 22px 22px' }}>
            <ol className="steps">
              <li>
                در پیشخوان وردپرس به مسیر <b>ووکامرس ← تنظیمات ← پیشرفته ← REST API</b> بروید.
              </li>
              <li>
                روی <b>افزودن کلید</b> کلیک کنید؛ نام دلخواه بگذارید و دسترسی را روی <b>خواندن/نوشتن (Read/Write)</b> تنظیم کنید
                و کاربر را روی <b>کاربر</b> بگذارید.
              </li>
              <li>
                بعد از ثبت، <b>Consumer Key</b> و <b>Consumer Secret</b> نمایش داده می‌شوند — آن‌ها را کپی و در فرم
                کناری وارد کنید.
              </li>
              <li>
                روی <b>ذخیره تنظیمات</b> بزنید؛ اگر همه‌چیز درست باشد، اتصال به‌صورت خودکار بررسی و مشتریان در بخش
                «مشتریان» نمایش داده می‌شوند.
              </li>
            </ol>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">اکانت‌های کارشناس</div>
              <div className="panel-sub">
                چند کارشناس می‌توانند روی همین دستگاه کار کنند — سوئیچ سریع از پایین سایدبار («کارشناس: نام»)
              </div>
            </div>
            <div className="chip">
              <IconUsers size={13} />
              {accounts?.accounts.length ? faDigits(String(accounts.accounts.length)) + ' اکانت' : '—'}
            </div>
          </div>

          <div className="form-body">
            {acctErr && (
              <div className="notice err">
                <IconAlert size={17} />
                <div>{acctErr}</div>
              </div>
            )}
            {acctOk && (
              <div className="notice ok fade-in">
                <IconCheck size={17} />
                <div>اکانت کارشناس اضافه شد و فعال شد.</div>
              </div>
            )}

            {accounts && accounts.accounts.length > 0 ? (
              <div className="acct-list">
                {accounts.accounts.map((a) => {
                  const isActive = a.id === accounts.activeId
                  return (
                    <div key={a.id} className={'acct-row' + (isActive ? ' active' : '')}>
                      <span className={'acct-dot' + (isActive ? ' on' : '')} />
                      <div className="acct-main">
                        <span className="acct-name">{a.label}</span>
                        <span className="acct-key" dir="ltr">
                          ck_••••{a.consumerKey.slice(-6)}
                        </span>
                      </div>
                      {isActive ? (
                        <span className="pill pill-green">فعال</span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost btn-danger-ghost"
                          disabled={acctBusy !== null}
                          onClick={() => handleRemoveAccount(a.id)}
                        >
                          {acctBusy === a.id ? <IconRefresh size={14} className="spin" /> : <IconTrash size={14} />}
                          حذف
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="empty-sub">هنوز اکانتی ثبت نشده — با ذخیرهٔ فرم «اتصال به فروشگاه»، اکانت فعلی ساخته می‌شود.</div>
            )}

            <div className="f-hint">
              فرم «اتصال به فروشگاه» همیشه کلیدهای <b>اکانت فعال</b> را ویرایش می‌کند. برای اکانت دوم، کلید API جداگانه
              (با کاربر وردپرس همان کارشناس) بسازید و اینجا اضافه کنید تا لاگ تغییرات و «سفارش‌های من» به درستی به او
              نسبت داده شود.
            </div>

            {!addOpen ? (
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(true)} disabled={acctBusy !== null}>
                  <IconPlus size={16} />
                  افزودن اکانت کارشناس
                </button>
              </div>
            ) : (
              <div className="acct-add-form">
                <div className="field">
                  <label className="lbl" htmlFor="acct-label">
                    نام کارشناس (اختیاری)
                  </label>
                  <input
                    id="acct-label"
                    className="input"
                    type="text"
                    placeholder="مثلاً: انبار — اگر خالی بماند نام صاحب کلید استفاده می‌شود"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="lbl" htmlFor="acct-ck">
                    کلید مصرف‌کننده (Consumer Key) <span className="req">*</span>
                  </label>
                  <input
                    id="acct-ck"
                    className="input ltr code-hint"
                    type="text"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={newCk}
                    onChange={(e) => setNewCk(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="lbl" htmlFor="acct-cs">
                    رمز مصرف‌کننده (Consumer Secret) <span className="req">*</span>
                  </label>
                  <input
                    id="acct-cs"
                    className="input ltr code-hint"
                    type="password"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={newCs}
                    onChange={(e) => setNewCs(e.target.value)}
                  />
                </div>
                <div className="form-actions">
                  <button type="button" className="btn btn-primary" onClick={handleAddAccount} disabled={acctBusy !== null}>
                    {acctBusy === 'add' ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                    {acctBusy === 'add' ? 'در حال بررسی کلیدها…' : 'افزودن اکانت'}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setAddOpen(false)} disabled={acctBusy !== null}>
                    انصراف
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">سرعت و کش داده‌ها</div>
              <div className="panel-sub">تعادل بین تازگی داده و سرعت باز شدن منوها را خودتان تنظیم کنید</div>
            </div>
            <div className="chip">
              <IconClock size={13} />
              کش WooCommerce
            </div>
          </div>

          <div className="form-body">
            <div className="notice info" style={{ marginTop: 0 }}>
              <IconClock size={17} />
              <div>
                داده‌های خوانده‌شده از فروشگاه تا این مدت‌ها کش می‌شوند؛ با هر تغییر یا «به‌روزرسانی» در برنامه، کش همان لحظه
                پاک می‌شود. عدد بزرگ‌تر یعنی ورود به منوها سریع‌تر و درخواست کمتر به ووکامرس، ولی ممکن است داده تا همان
                مدت قدیمی دیده شود. پس از ذخیره، کش فعلی پاک و از نو ساخته می‌شود.
              </div>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="cacheListSec">
                نگهداری فهرست‌ها (ثانیه)
              </label>
              <input
                id="cacheListSec"
                className="input ltr"
                type="number"
                dir="ltr"
                min={5}
                max={86400}
                inputMode="numeric"
                placeholder="60"
                value={String(form.cacheListSec ?? 60)}
                onChange={(e) =>
                  set('cacheListSec', e.target.value.trim() === '' ? undefined : Number(toLatin(e.target.value)))
                }
              />
              <span className="f-hint">مشتریان، سفارش‌ها و محصولات — پیش‌فرض ۶۰</span>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="cacheDetailSec">
                جزئیات و تاریخچه (ثانیه)
              </label>
              <input
                id="cacheDetailSec"
                className="input ltr"
                type="number"
                dir="ltr"
                min={5}
                max={86400}
                inputMode="numeric"
                placeholder="120"
                value={String(form.cacheDetailSec ?? 120)}
                onChange={(e) =>
                  set('cacheDetailSec', e.target.value.trim() === '' ? undefined : Number(toLatin(e.target.value)))
                }
              />
              <span className="f-hint">یادداشت‌ها، تاریخچهٔ سفارش مشتری/محصول و آمار فروشگاه — پیش‌فرض ۱۲۰</span>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="cacheReportSec">
                گزارش‌های فروش (ثانیه)
              </label>
              <input
                id="cacheReportSec"
                className="input ltr"
                type="number"
                dir="ltr"
                min={5}
                max={86400}
                inputMode="numeric"
                placeholder="300"
                value={String(form.cacheReportSec ?? 300)}
                onChange={(e) =>
                  set('cacheReportSec', e.target.value.trim() === '' ? undefined : Number(toLatin(e.target.value)))
                }
              />
              <span className="f-hint">گزارشات، کاتالوگ و جزئیات محصول — پیش‌فرض ۳۰۰</span>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="cacheStaleHours">
                سن مجاز کش در شروع دوبارهٔ برنامه (ساعت)
              </label>
              <input
                id="cacheStaleHours"
                className="input ltr"
                type="number"
                dir="ltr"
                min={0}
                max={168}
                inputMode="numeric"
                placeholder="12"
                value={String(form.cacheStaleHours ?? 12)}
                onChange={(e) =>
                  set('cacheStaleHours', e.target.value.trim() === '' ? undefined : Number(toLatin(e.target.value)))
                }
              />
              <span className="f-hint">
                پس از بستن و باز کردن برنامه، دادهٔ کش تا این چند ساعتِ گذشته همان لحظه نمایش داده و در پس‌زمینه تازه می‌شود؛
                ۰ یعنی همیشه فقط دادهٔ کاملاً تازه — پیش‌فرض ۱۲
              </span>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات کش'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">ظاهر برنامه</div>
              <div className="panel-sub">
                تم روشن/تیره و رنگ اصلی رابط کاربری — تغییرات فوراً پیش‌نمایش می‌شوند و با «ذخیره» ماندگار می‌شوند
              </div>
            </div>
            <div className="chip">
              <IconDroplet size={13} />
              پیش‌نمایش فوری
            </div>
          </div>

          <div className="form-body">
            <div className="appear-grid">
              <div className="field">
                <label className="lbl">تم</label>
                <div className="theme-seg">
                  <button
                    type="button"
                    className={'theme-opt' + ((form.theme ?? 'dark') === 'dark' ? ' active' : '')}
                    onClick={() => setTheme('dark')}
                  >
                    <IconMoon size={15} />
                    تیره
                  </button>
                  <button
                    type="button"
                    className={'theme-opt' + (form.theme === 'light' ? ' active' : '')}
                    onClick={() => setTheme('light')}
                  >
                    <IconSun size={15} />
                    روشن
                  </button>
                </div>
                <span className="f-hint">تم روشن، ظاهری مینیمال با پس‌زمینهٔ روشن و متن تیره است.</span>
              </div>

              <div className="field">
                <label className="lbl">رنگ اصلی (تأکیدی)</label>
                <div className="accent-row">
                  {ACCENT_PRESETS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      className={'accent-swatch' + ((form.accentColor ?? '').toLowerCase() === c.hex ? ' active' : '')}
                      style={{ background: c.hex }}
                      title={c.name}
                      aria-label={c.name}
                      onClick={() => setAccent(c.hex)}
                    />
                  ))}
                  <label className="accent-custom" title="انتخاب رنگ دلخواه">
                    <IconDroplet size={14} />
                    <input
                      type="color"
                      value={form.accentColor ?? '#2dd4bf'}
                      onChange={(e) => setAccent(e.target.value)}
                    />
                  </label>
                  {form.accentColor && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAccent(undefined)}>
                      رنگ پیش‌فرض
                    </button>
                  )}
                </div>
                <span className="f-hint">
                  رنگ دکمه‌ها، منوی فعال و عناصر تأکیدی در هر دو تم — فقط روی همین دستگاه ذخیره می‌شود.
                </span>
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره ظاهر'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">اطلاعات رسید</div>
              <div className="panel-sub">
                نام، آدرس، لوگو و تماس فروشگاه — روی رسید فروشگاه و رسید پستی چاپ می‌شود (اختیاری)
              </div>
            </div>
            <div className="chip">
              <IconPrint size={13} />
              چاپ رسید
            </div>
          </div>

          <div className="form-body">
            <div className="field">
              <label className="lbl" htmlFor="storeName">
                نام فروشگاه
              </label>
              <input
                id="storeName"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="مثلاً: فروشگاه دیجیتال پارس"
                value={form.storeName ?? ''}
                onChange={(e) => set('storeName', e.target.value)}
              />
              <span className="f-hint">اگر خالی باشد، دامنهٔ سایت روی رسیدها نمایش داده می‌شود.</span>
            </div>

            <div className="field">
              <label className="lbl">لوگوی فروشگاه</label>
              <div className="logo-row">
                <div className="logo-preview">
                  {form.storeLogo ? (
                    <>
                      <img src={form.storeLogo} alt="لوگوی فروشگاه" />
                      <button
                        type="button"
                        className="btn-icon logo-del"
                        aria-label="حذف لوگو"
                        onClick={() => set('storeLogo', undefined)}
                      >
                        <IconTrash size={14} />
                      </button>
                    </>
                  ) : (
                    <span className="logo-empty">لوگویی انتخاب نشده</span>
                  )}
                </div>
                <label className="btn btn-ghost btn-sm file-btn">
                  <IconUpload size={14} />
                  {form.storeLogo ? 'تغییر لوگو' : 'انتخاب لوگو'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    onChange={handleLogoChange}
                    hidden
                  />
                </label>
              </div>
              <span className="f-hint">
                همین لوگو بالای سایدبار و روی رسیدها نمایش داده می‌شود؛ تصویر مربعی با پس‌زمینهٔ شفاف بهتر است و
                به‌صورت خودکار تا عرض ۵۰۰ پیکسل کوچک می‌شود.
              </span>
            </div>

            <div className="field">
              <label className="lbl" htmlFor="storeAddress">
                آدرس فروشگاه
              </label>
              <input
                id="storeAddress"
                className="input"
                type="text"
                autoComplete="off"
                placeholder="استان، شهر، خیابان، پلاک"
                value={form.storeAddress ?? ''}
                onChange={(e) => set('storeAddress', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="storePostcode">
                کدپستی فروشگاه
              </label>
              <input
                id="storePostcode"
                className="input ltr"
                type="text"
                dir="ltr"
                autoComplete="off"
                placeholder="1234567890"
                value={form.storePostcode ?? ''}
                onChange={(e) => set('storePostcode', e.target.value)}
              />
            </div>

            <div className="field">
              <label className="lbl" htmlFor="storePhone">
                شماره پشتیبانی
              </label>
              <input
                id="storePhone"
                className="input ltr"
                type="text"
                dir="ltr"
                autoComplete="off"
                placeholder="021-91000000"
                value={form.storePhone ?? ''}
                onChange={(e) => set('storePhone', e.target.value)}
              />
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">تنظیمات یادداشت سفارش</div>
              <div className="panel-sub">
                یادداشت‌های رسید انبارداری — هر یادداشتی که شامل یکی از این جملات باشد، چاپ نمی‌شود
              </div>
            </div>
            <div className="chip">
              <IconNote size={13} />
              رسید انبارداری
            </div>
          </div>

          <div className="form-body">
            <div className="field">
              <label className="lbl" htmlFor="noteExclusions">
                جملات حذف‌شده از یادداشت‌ها
              </label>
              <textarea
                id="noteExclusions"
                className="input"
                rows={7}
                placeholder={'هر جمله در یک خط؛ مثلاً:\nلطفاً پیش از ارسال تماس بگیرید\nمتن یادداشت تبلیغاتی'}
                // Keep empty lines while editing so Enter/Shift+Enter moves to the
                // next line naturally; trimming/cleanup happens on save.
                value={(form.noteExclusions ?? []).join('\n')}
                onChange={(e) =>
                  set('noteExclusions', e.target.value.split(/\r?\n/).map((p) => p.trim()))
                }
              />
              <span className="f-hint">
                یادداشت مدیر فروشگاه و یادداشت مشتری که شامل هرکدام از این جملات باشد، روی رسید انبارداری نمایش داده
                نمی‌شود. یادداشت‌های سیستمی به‌هرحال چاپ نمی‌شوند. برای اعمال، «ذخیره تنظیمات» را بزنید.
              </span>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">قیمت تمام‌شدهٔ کالاها</div>
              <div className="panel-sub">
                قیمت خرید هر کالا ({cur}) — مبنای محاسبهٔ سود ناخالص در گزارشات. با جستجو کالا را پیدا و قیمت را ثبت
                کنید.
              </div>
            </div>
            <div className="chip">
              <IconTag size={13} />
              {faDigits(String(costCount))} کالا قیمت دارد
            </div>
          </div>

          <div className="form-body">
            <div className="field">
              <label className="lbl" htmlFor="costSearch">
                جستجوی کالا (نام یا کد)
              </label>
              <div className="input-wrap">
                <input
                  id="costSearch"
                  className="input"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="مثلاً: پیراهن مردانه یا SKU"
                  value={costQuery}
                  onChange={(e) => setCostQuery(e.target.value)}
                />
                <span className="eye-btn" style={{ cursor: 'default' }}>
                  {costLoading ? <IconRefresh size={16} className="spin" /> : <IconSearch size={16} />}
                </span>
              </div>
              <span className="f-hint">
                برای هر واحد کالا قیمت خرید را وارد کنید؛ خالی گذاشتن یعنی این کالا هنوز قیمت تمام‌شده ندارد (سودش در
                گزارش «سود ناخالص» محاسبه نمی‌شود). تغییرات با «ذخیره تنظیمات» ثبت می‌شود.
              </span>
            </div>

            {costErr && (
              <div className="notice err">
                <IconAlert size={15} />
                <div>{costErr}</div>
              </div>
            )}

            {costRows && costRows.length > 0 && (
              <div className="cost-rows">
                {costRows.map((p) => {
                  const val = form.productCosts?.[String(p.id)]
                  return (
                    <div className="cost-row" key={p.id}>
                      <div className="cost-row-name">
                        <span className="qo-match-name">{p.name}</span>
                        {p.sku ? <span className="qo-match-sub" dir="ltr">{p.sku}</span> : null}
                      </div>
                      <div className="cost-row-in">
                        <input
                          className="input cost-input"
                          dir="ltr"
                          inputMode="decimal"
                          placeholder="قیمت خرید…"
                          value={val ? String(val) : ''}
                          onChange={(e) => setUnitCost(p.id, e.target.value)}
                        />
                        <span className="f-hint">{cur}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {costRows && costRows.length === 0 && (
              <div className="notice info">
                <IconSearch size={15} />
                <div>کالایی با این نام پیدا نشد.</div>
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">انبارهای فروشگاه</div>
              <div className="panel-sub">
                موجودی هر انبار به تفکیک محصولات و ترکیبات در «انبارها» ثبت می‌شود؛ اینجا انبارها را تعریف کنید.
              </div>
            </div>
          </div>
          <div className="form-body">
            <div className="tbl-wrap">
              <table className="tbl tbl-whdefs">
                <thead>
                  <tr>
                    <th>نام انبار</th>
                    <th>شناسه (لاتین)</th>
                    <th>وضعیت سفارش این انبار</th>
                    <th>سفارش سریع</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '18px 0' }}>
                        هنوز انباری تعریف نشده است
                      </td>
                    </tr>
                  ) : (
                    warehouses.map((w, idx) => (
                      <tr key={idx}>
                        <td>
                          <input
                            className="input"
                            value={w.name}
                            placeholder="مثلاً انبار کارگاه"
                            onChange={(e) => updateWh(idx, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            className="input wh-id-input"
                            dir="ltr"
                            value={w.id}
                            placeholder="kargah"
                            onChange={(e) => updateWh(idx, { id: e.target.value.replace(/\s+/g, '-').toLowerCase() })}
                            onBlur={(e) => updateWh(idx, { id: slugifyWarehouseId(e.target.value) })}
                          />
                        </td>
                        <td>
                          <select
                            className="sel"
                            value={w.orderStatus ?? ''}
                            onChange={(e) => updateWh(idx, { orderStatus: e.target.value || undefined })}
                          >
                            <option value="">— بدون وضعیت —</option>
                            {statusOptions(siteStatuses).map((s) => (
                              <option key={s.slug} value={s.slug}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="wh-quick-cell">
                          <label className="wh-quick">
                            <input
                              type="radio"
                              name="quick-wh"
                              checked={w.quickOrder === true}
                              onChange={() => setQuickWh(idx)}
                            />
                            <span>تخصیص فروش حضوری به این انبار</span>
                          </label>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn-icon"
                            title="حذف انبار"
                            aria-label="حذف انبار"
                            onClick={() => removeWh(idx)}
                          >
                            <IconTrash size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div>
              <button type="button" className="btn btn-ghost" onClick={addWh} disabled={warehouses.length >= 8}>
                <IconPlus size={15} />
                افزودن انبار
              </button>
              <span className="f-hint" style={{ marginInlineStart: 10 }}>
                حداکثر ۸ انبار
              </span>
            </div>

            <div className="notice amber">
              <IconAlert size={16} />
              <div>
                شناسهٔ انبار نام متای موجودی روی سایت است — پس از ثبت انبارداری، تغییر آن یعنی موجودی‌های قبلی ناپدید
                به‌نظر می‌رسند. این تعریف باید روی دستگاه همهٔ انباردارها دقیقاً یکسان باشد.
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? <IconRefresh size={16} className="spin" /> : <IconCheck size={16} />}
                {saving ? 'در حال ذخیره…' : 'ذخیره تنظیمات'}
              </button>
              {savedFlash && (
                <span className="save-msg">
                  <IconCheck size={14} />
                  ذخیره شد
                </span>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
