/**
 * استان‌های ایران — همان فهرست رسمی ووکامرس (i18n/states.php برای IR):
 * مقدار ارسالی به سفارش، کدِ استاندارد است تا ووکامرس نام فارسی را خودش
 * در سفارش/صورت‌حساب نمایش دهد (دقیقاً مثل فرم تسویهٔ خود سایت).
 */
export const IR_PROVINCES: Array<{ code: string; fa: string }> = [
  { code: 'KHZ', fa: 'خوزستان' },
  { code: 'THR', fa: 'تهران' },
  { code: 'ILM', fa: 'ایلام' },
  { code: 'BHR', fa: 'بوشهر' },
  { code: 'ADL', fa: 'اردبیل' },
  { code: 'ESF', fa: 'اصفهان' },
  { code: 'YZD', fa: 'یزد' },
  { code: 'KRH', fa: 'کرمانشاه' },
  { code: 'KRN', fa: 'کرمان' },
  { code: 'HDN', fa: 'همدان' },
  { code: 'GZN', fa: 'قزوین' },
  { code: 'ZJN', fa: 'زنجان' },
  { code: 'LRS', fa: 'لرستان' },
  { code: 'ABZ', fa: 'البرز' },
  { code: 'EAZ', fa: 'آذربایجان شرقی' },
  { code: 'WAZ', fa: 'آذربایجان غربی' },
  { code: 'CHB', fa: 'چهارمحال و بختیاری' },
  { code: 'SKH', fa: 'خراسان جنوبی' },
  { code: 'RKH', fa: 'خراسان رضوی' },
  { code: 'NKH', fa: 'خراسان شمالی' },
  { code: 'SMN', fa: 'سمنان' },
  { code: 'FRS', fa: 'فارس' },
  { code: 'QHM', fa: 'قم' },
  { code: 'KRD', fa: 'کردستان' },
  { code: 'KBD', fa: 'کهگیلویه و بویراحمد' },
  { code: 'GLS', fa: 'گلستان' },
  { code: 'GIL', fa: 'گیلان' },
  { code: 'MZN', fa: 'مازندران' },
  { code: 'MKZ', fa: 'مرکزی' },
  { code: 'HRZ', fa: 'هرمزگان' },
  { code: 'SBN', fa: 'سیستان و بلوچستان' },
]

/** نام فارسی استان از روی کد استاندارد ووکامرس؛ برای مقدار ناشناخته همان ورودی برمی‌گردد. */
export function provinceFa(code?: string): string {
  const v = (code ?? '').trim()
  if (!v) return ''
  const hit =
    IR_PROVINCES.find((p) => p.code.toLowerCase() === v.toLowerCase()) ??
    IR_PROVINCES.find((p) => SITE_PROVINCE_CODES[p.code] === v)
  return hit ? hit.fa : v
}

/* کدهای عددی افزونهٔ استان‌های سایت (از GET data/countries؛ main.ts هنگام ثبت،
 * کد استاندارد را با نگاشت نام‌محورِ زنده به همین کدها تبدیل می‌کند). این جدول
 * فقط برای «نمایش» و بازگرداندن به کد استاندارد است. */
export const SITE_PROVINCE_CODES: Record<string, string> = {
  KHZ: '591',
  THR: '510',
  ILM: '740',
  BHR: '748',
  ADL: '723',
  ESF: '447',
  YZD: '1137',
  KRH: '948',
  KRN: '909',
  HDN: '1116',
  GZN: '875',
  ZJN: '714',
  LRS: '1046',
  ABZ: '495',
  EAZ: '392',
  WAZ: '359',
  CHB: '780',
  SKH: '814',
  RKH: '546',
  NKH: '802',
  SMN: '830',
  FRS: '620',
  QHM: '887',
  KRD: '895',
  KBD: '972',
  GLS: '987',
  GIL: '1009',
  MZN: '675',
  MKZ: '1066',
  HRZ: '1092',
  SBN: '844',
}

/** یکسان‌سازی نام استان برای تطبیق متنی (ي/ک عربی → فارسی، نیم‌فاصله/فاصله و «و» حذف). */
export function normProvinceName(v: string): string {
  return v
    .replace(/\u064a/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u200c/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t !== 'و')
    .join('')
}

/** کد استاندارد استان از هر شکلی — کد استاندارد، کد عددی سایت یا نام فارسی. */
export function provinceStd(v?: string): string {
  const s = (v ?? '').trim()
  if (!s) return ''
  const std = IR_PROVINCES.find((p) => p.code.toLowerCase() === s.toLowerCase())
  if (std) return std.code
  const bySite = IR_PROVINCES.find((p) => SITE_PROVINCE_CODES[p.code] === s)
  if (bySite) return bySite.code
  const byFa = IR_PROVINCES.find((p) => normProvinceName(p.fa) === normProvinceName(s))
  return byFa ? byFa.code : s
}
