/** Formatter cache: "۱۴۰۴/۰۶" style key for the Persian (Jalali) calendar. */
let jalaliFmt: Intl.DateTimeFormat | null = null

/**
 * Returns the Persian-calendar year/month of a date as a comparable string
 * (e.g. "۱۴۰۴/۰۶"). Used to decide whether an order belongs to the current
 * Persian month. Falls back to a Gregorian key if the locale calendar is
 * unavailable in the runtime.
 */
export function persianMonthKey(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  try {
    if (!jalaliFmt) {
      jalaliFmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric',
        month: '2-digit',
      })
    }
    return jalaliFmt.format(d)
  } catch {
    return String(d.getFullYear()) + '-' + String(d.getMonth() + 1)
  }
}
