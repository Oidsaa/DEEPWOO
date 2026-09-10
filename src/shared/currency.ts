/** برچسب فارسی واحدهای پولی رایج — کلید = کد ووکامرس (بزرگ/کوچک یکسان). */
const CURRENCY_FA: Record<string, string> = {
  IRR: 'ریال',
  IRT: 'تومان',
  TOMAN: 'تومان',
  USD: 'دلار',
  EUR: 'یورو',
  GBP: 'پوند',
  AED: 'درهم',
  TRY: 'لیر',
  SAR: 'ریال سعودی',
  QAR: 'ریال قطر',
  KWD: 'دینار کویت',
  BHD: 'دینار بحرین',
  OMR: 'ریال عمان',
  JPY: 'ین ژاپن',
  CNY: 'یوان',
  RUB: 'روبل',
  AFN: 'افغانی',
  IQD: 'دینار عراق',
  INR: 'روپیه',
  PKR: 'روپیه پاکستان',
  CAD: 'دلار کانادا',
  AUD: 'دلار استرالیا',
}

/**
 * پیش‌فرض تا وقتی واحد فروشگاه از API خوانده نشده — بازار اصلی برنامه ایران است
 * و اکثر فروشگاه‌ها تومان دارند؛ اگر واحد واقعی فرق کند بعد از خواندن عوض می‌شود.
 */
export const DEFAULT_CURRENCY = 'تومان'

/** برچسب فارسی واحد پولی از کد ووکامرس؛ کد ناشناخته خودش برمی‌گردد. */
export function currencyLabel(code: string | null | undefined): string {
  if (!code) return ''
  const c = code.trim()
  if (!c) return ''
  return CURRENCY_FA[c.toUpperCase()] ?? c
}
