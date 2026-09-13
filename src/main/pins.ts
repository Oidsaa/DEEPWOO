import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * رمزهای شخصی اکانت‌های کارشناس — نگهبان سوئیچ اکانت.
 *
 * جدا از settings.json نگهداری می‌شود تا در گردش ذخیرهٔ فرم تنظیمات (که اکانت‌ها
 * را ردیف می‌کند) گم نشود. فقط هش scrypt با نمک تصادفی ذخیره می‌شود؛ خودِ رمز
 * هیچ‌جا نوشته نمی‌شود. این محافظتِ درون‌برنامه‌ای است (هر کارشناس فقط اکانت خودش
 * را باز کند) — فایل کلیدها روی همین دستگاه است و در برابر دسترسی مستقیم به دیسک
 * دفاعی ندارد.
 */

const PIN_MIN = 4
const PIN_MAX = 32

interface PinRecord {
  salt: string
  hash: string
}

let pins: Record<string, PinRecord> | null = null

function file(): string {
  return path.join(app.getPath('userData'), 'account-pins.json')
}

function all(): Record<string, PinRecord> {
  if (pins) return pins
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'))
    pins = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, PinRecord>) : {}
  } catch {
    pins = {}
  }
  return pins
}

function persist(): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(all(), null, 2), 'utf8')
}

/** رمز ورودی را تمیز و اعتبارسنجی می‌کند؛ خطای فارسی برای نمایش در UI. */
export function normalizePin(raw: unknown): string {
  const v = String(raw ?? '').trim()
  if (v.length < PIN_MIN) throw new Error(`رمز باید حداقل ${PIN_MIN} کاراکتر باشد.`)
  if (v.length > PIN_MAX) throw new Error(`رمز حداکثر ${PIN_MAX} کاراکتر است.`)
  return v
}

export function hasPin(id: string): boolean {
  return !!all()[id]
}

export function verifyPin(id: string, raw: unknown): boolean {
  const rec = all()[id]
  if (!rec) return false
  const v = String(raw ?? '').trim()
  const hash = crypto.scryptSync(v, rec.salt, 32).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(rec.hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function setPin(id: string, raw: unknown): void {
  const v = normalizePin(raw)
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(v, salt, 32).toString('hex')
  all()[id] = { salt, hash }
  persist()
}

export function clearPin(id: string): void {
  if (!all()[id]) return
  delete all()[id]
  persist()
}
