import { useEffect, useState } from 'react'
import type { ConnectionResult, ConnState, Settings } from '../../shared/types'
import { api } from '../api'
import {
  IconAlert,
  IconCheck,
  IconEye,
  IconEyeOff,
  IconLink,
  IconPrint,
  IconRefresh,
  IconShield,
  IconStore,
  IconTrash,
  IconUpload,
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
}

export default function SettingsView({ settings, conn, onSaved }: Props) {
  const [form, setForm] = useState<Settings>({ siteUrl: '', consumerKey: '', consumerSecret: '' })
  const [showSecret, setShowSecret] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null)
  const [armClear, setArmClear] = useState(false)

  useEffect(() => {
    if (settings) setForm(settings)
  }, [settings])

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
                تصویر مربعی با پس‌زمینهٔ شفاف بهتر است؛ به‌صورت خودکار تا عرض ۵۰۰ پیکسل کوچک می‌شود.
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

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">ساخت کلید API</div>
              <div className="panel-sub">راهنمای گام‌به‌گام از پیشخوان ووکامرس</div>
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
      </div>
    </div>
  )
}
