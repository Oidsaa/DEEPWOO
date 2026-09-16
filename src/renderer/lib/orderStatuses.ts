import { useSyncExternalStore } from 'react'
import type { OrderStatusTotal } from '../../shared/types'
import { api } from '../api'
import { ORDER_STATUS_META } from './format'

/**
 * نام وضعیت‌های سفارش — همیشه از سایت (فهرست واقعی wc_get_order_statuses).
 * برنامه هیچ وضعیتی نمی‌سازد و نامی را تغییر نمی‌دهد؛ ORDER_STATUS_META فقط
 * رنگ قرص (pill) را می‌دهد و تا رسیدن فهرست سایت، نام موقت است.
 */
let names: Record<string, string> = {}
let version = 0
const listeners = new Set<() => void>()
let lastFetch = 0
let inflight: Promise<void> | null = null

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function emit(): void {
  version += 1
  for (const l of listeners) l()
}

/** ورود فهرست وضعیت‌های سایت (خروجی listOrderStatusTotals) به فروشگاه نام‌ها. */
export function adoptOrderStatuses(list: OrderStatusTotal[] | null | undefined): void {
  if (!list || list.length === 0) return
  let changed = false
  const next = { ...names }
  for (const s of list) {
    if (!s?.slug) continue
    const name = (s.name ?? '').trim()
    if (name && name !== s.slug && next[s.slug] !== name) {
      next[s.slug] = name
      changed = true
    }
  }
  if (!changed) return
  names = next
  emit()
}

/** نام نمایشی یک وضعیت: نام سایت ← برچسب شناخته‌شده ← خود اسلاگ. */
export function statusFa(slug: string | null | undefined): string {
  if (!slug) return '—'
  return names[slug] ?? ORDER_STATUS_META[slug]?.fa ?? slug.replace(/-/g, ' ')
}

/** رنگ قرص وضعیت — صرفاً ظاهری و مستقل از نام. */
export function statusCls(slug: string | null | undefined): string {
  if (!slug) return 'pill-dim'
  return ORDER_STATUS_META[slug]?.cls ?? 'pill-dim'
}

export function statusMeta(slug: string | null | undefined): { fa: string; cls: string } {
  if (!slug) return { fa: '—', cls: 'pill-dim' }
  return { fa: statusFa(slug), cls: statusCls(slug) }
}

/** نسخهٔ ری‌اکت‌ساز — رندر مجدد وقتی فهرست سایت می‌رسد. */
export function useOrderStatusMeta(status: string | null | undefined): { fa: string; cls: string } {
  useSyncExternalStore(subscribe, () => version)
  return statusMeta(status)
}

/** خواندن یک‌بارهٔ فهرست سایت (TTL ۶۰ ثانیه) — خوراک adoptOrderStatuses. */
export function refreshOrderStatuses(): Promise<void> {
  if (inflight) return inflight
  if (Date.now() - lastFetch < 60_000) return Promise.resolve()
  inflight = api
    .listOrderStatusTotals()
    .then((list) => {
      lastFetch = Date.now()
      adoptOrderStatuses(list)
    })
    .catch(() => {})
    .finally(() => {
      inflight = null
    })
  return inflight
}
