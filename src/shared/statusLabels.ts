/** Persian labels of WooCommerce order statuses (unknown slugs stay as-is). */
export const FA_STATUS: Record<string, string> = {
  pending: 'در انتظار پرداخت',
  processing: 'در حال انجام',
  'on-hold': 'در انتظار بررسی',
  completed: 'انجام شده',
  cancelled: 'لغو شده',
  refunded: 'مسترد شده',
  failed: 'ناموفق',
  'sale-hazouri': 'فروش حضوری',
}

export function faStatus(s: string): string {
  return FA_STATUS[s] ?? s
}
