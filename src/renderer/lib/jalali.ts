/**
 * Jalali (Persian calendar) ⇄ Gregorian helpers for the report's «بازهٔ
 * سفارشی» date fields. Conversion goes through Intl's built-in persian
 * calendar (en-US numerals), so there is no hand-rolled jalaali math here.
 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

const FA_LATIN: Record<string, string> = {
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
}

function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => FA_LATIN[d] ?? d)
}

/** Persian (Jalali) year/month/day of a LOCAL Date — [y, m, d] or null. */
export function jalaliTuple(d: Date): [number, number, number] | null {
  if (Number.isNaN(d.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(d)
    const v: Record<string, number> = {}
    for (const p of parts) if (p.type === 'year' || p.type === 'month' || p.type === 'day') v[p.type] = Number(p.value)
    if (!v.year || !v.month || !v.day) return null
    return [v.year, v.month, v.day]
  } catch {
    return null
  }
}

function localKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Gregorian local-date key YYYY-MM-DD of a Jalali date — or null when invalid. */
export function jalaliToLocalKey(input: string): string | null {
  const nums = toLatinDigits(input)
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
  if (nums.length < 3) return null
  const [jy, jm, jd] = nums
  if (jy < 1200 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null
  // The Jalali year jy spans roughly Jan of (jy+621) → Mar of (jy+622) in the
  // Gregorian calendar; walk that window's local days until Intl agrees.
  const gy0 = jy + 621
  for (let i = 0; i < 800; i++) {
    const d = new Date(gy0, 0, 1 + i)
    const t = jalaliTuple(d)
    if (!t) continue
    if (t[0] === jy && t[1] === jm && t[2] === jd) return localKeyOf(d)
    if (t[0] > jy) break
  }
  return null
}

/** «1405/06/16» of a Gregorian local-date key — or null when the key is bad. */
export function localKeyToJalali(key: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const t = jalaliTuple(d)
  if (!t) return null
  return `${t[0]}/${pad2(t[1])}/${pad2(t[2])}`
}

/** Gregorian local-date key YYYY-MM-DD of today minus `daysAgo` days. */
export function localKeyDaysAgo(daysAgo: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return localKeyOf(d)
}
