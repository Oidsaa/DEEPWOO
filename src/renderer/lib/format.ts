const intFmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 })
const decFmt = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 })

/**
 * Persian label + pill color for every order status, including the
 * store-specific statuses this app has encountered (workflow statuses such
 * as فروش حضوری / تایید فروشگاه / تایید کارگاه and delivery methods).
 * Unknown statuses fall back to the raw slug with a dim pill.
 */
export const ORDER_STATUS_META: Record<string, { fa: string; cls: string }> = {
  completed: { fa: 'تکمیل‌شده', cls: 'pill-green' },
  processing: { fa: 'در حال پردازش', cls: 'pill-teal' },
  'pending-payment': { fa: 'در انتظار پرداخت', cls: 'pill-amber' },
  pending: { fa: 'در انتظار پرداخت', cls: 'pill-amber' },
  'on-hold': { fa: 'در انتظار بررسی', cls: 'pill-indigo' },
  failed: { fa: 'ناموفق', cls: 'pill-red' },
  cancelled: { fa: 'لغو شده', cls: 'pill-red' },
  refunded: { fa: 'بازپرداخت شده', cls: 'pill-indigo' },
  trash: { fa: 'حذف شده', cls: 'pill-dim' },
  // Custom statuses seen on Iranian WooCommerce stores.
  'sale-hazouri': { fa: 'فروش حضوری', cls: 'pill-green' },
  foroshgah: { fa: 'تایید فروشگاه', cls: 'pill-teal' },
  kargah: { fa: 'تایید کارگاه', cls: 'pill-indigo' },
  'courier-delivery': { fa: 'تحویل پیک', cls: 'pill-amber' },
  'post-delivery': { fa: 'تحویل پست', cls: 'pill-dim' },
  'tipax-delivery': { fa: 'تحویل تیپاکس', cls: 'pill-indigo' },
}

/** Persian label + pill color of an order status (fallback = raw slug). */
export function orderStatusMeta(status: string | null | undefined): { fa: string; cls: string } {
  if (!status) return { fa: '—', cls: 'pill-dim' }
  return ORDER_STATUS_META[status] ?? { fa: status.replace(/-/g, ' '), cls: 'pill-dim' }
}

/** Format a number (or numeric string) with Persian digits & grouping. */
export function faNum(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return String(value)
  return Number.isInteger(n) ? intFmt.format(n) : decFmt.format(n)
}

const FA_DIGITS: Record<string, string> = {
  '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴',
  '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹',
}

/** Convert Latin digits in a string (e.g. a phone number) to Persian digits. */
export function faDigits(input: string | null | undefined): string {
  if (!input) return '—'
  return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[d])
}

/** Strip formatting (spaces, dashes, parentheses, leading +) from a phone number. */
export function phoneDigits(input: string | null | undefined): string {
  if (!input) return ''
  return String(input).replace(/[^0-9]/g, '')
}

/**
 * Normalize user-typed numbers: Persian/Arabic digits → Latin, remove
 * thousand separators (٬ , space). Keeps digits and a decimal point.
 */
export function toLatin(input: string | null | undefined): string {
  if (!input) return ''
  return String(input)
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٬,،\s]/g, '')
    .trim()
}

/** Persian (Jalali) calendar date from an ISO string. */
export function faDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(d)
  } catch {
    return iso
  }
}

/** Persian time (HH:MM) of a Date. */
export function faTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' }).format(d)
  } catch {
    return String(d.getHours()) + ':' + String(d.getMinutes()).padStart(2, '0')
  }
}

const PALETTE = [
  ['#2dd4bf', 'rgba(45,212,191,0.16)'],
  ['#818cf8', 'rgba(129,140,248,0.16)'],
  ['#fbbf24', 'rgba(251,191,36,0.16)'],
  ['#f472b6', 'rgba(244,114,182,0.16)'],
  ['#38bdf8', 'rgba(56,189,248,0.16)'],
  ['#34d399', 'rgba(52,211,153,0.16)'],
] as const

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Deterministic accent colors for the initial-avatar of a customer. */
export function avatarPalette(seed: string): { color: string; bg: string } {
  const [color, bg] = PALETTE[hash(seed) % PALETTE.length]
  return { color, bg }
}

const IR = 'ایران'
const COUNTRY_FA: Record<string, string> = {
  IR,
  US: 'آمریکا',
  GB: 'انگلستان',
  CA: 'کانادا',
  AU: 'استرالیا',
  DE: 'آلمان',
  FR: 'فرانسه',
  IT: 'ایتالیا',
  ES: 'اسپانیا',
  NL: 'هلند',
  SE: 'سوئد',
  NO: 'نروژ',
  DK: 'دانمارک',
  AE: 'امارات',
  SA: 'عربستان',
  TR: 'ترکیه',
  IQ: 'عراق',
  AF: 'افغانستان',
  PK: 'پاکستان',
  IN: 'هند',
  RU: 'روسیه',
  UA: 'اوکراین',
  CN: 'چین',
  JP: 'ژاپن',
  AT: 'اتریش',
  CH: 'سوئیس',
  BE: 'بلژیک',
  PL: 'لهستان',
  CZ: 'چک',
  GR: 'یونان',
  PT: 'پرتغال',
  BR: 'برزیل',
  MX: 'مکزیک',
  NZ: 'نیوزیلند',
}

export function countryFa(code?: string | null): string {
  if (!code) return '—'
  const fa = COUNTRY_FA[code.toUpperCase()]
  return fa ?? code.toUpperCase()
}
