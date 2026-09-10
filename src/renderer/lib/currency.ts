import { useEffect, useState } from 'react'
import { api } from '../api'
import { faNum } from './format'
import { DEFAULT_CURRENCY } from '../../shared/currency'

let cached: string | null = null
let pending: Promise<string> | null = null

function load(): Promise<string> {
  if (!pending) {
    pending = api
      .getCurrency()
      .then((c) => {
        cached = (c || '').trim() || DEFAULT_CURRENCY
        return cached
      })
      .catch(() => {
        pending = null
        return DEFAULT_CURRENCY
      })
  }
  return pending
}

/**
 * واحد پولی فروشگاه (از API ووکامرس خوانده می‌شود) — تا رسیدن جواب، پیش‌فرض
 * «تومان» نمایش داده می‌شود و بعد در جا عوض می‌شود. یک بار برای کل برنامه
 * خوانده و بین همهٔ کامپوننت‌ها مشترک است.
 */
export function useCurrency(): string {
  const [cur, setCur] = useState(cached ?? DEFAULT_CURRENCY)
  useEffect(() => {
    if (cached) return
    let alive = true
    void load().then((c) => {
      if (alive) setCur(c)
    })
    return () => {
      alive = false
    }
  }, [])
  return cur
}

/** مبلغ با رقم فارسی + واحد پولی — «۱٬۲۴۰٬۰۰۰ تومان». */
export function money(n: number | string | null | undefined, cur: string): string {
  const v = faNum(n)
  return cur ? `${v} ${cur}` : v
}
