import type { Dispatch, SetStateAction } from 'react'
import { api } from '../api'

/**
 * Manual «به‌روزرسانی» / «بارگذاری مجدد» action.
 *
 * View components reload their list by bumping a local `loadCount` state; that
 * refetch normally hits the desktop TTL cache (main process), so a manual
 * refresh would never see orders placed on the site in the meantime. This
 * clears the cache first, making the next read hit WooCommerce for real.
 * In the browser demo `clearCache` is a no-op, so it degrades to a plain
 * reload there.
 */
export function forceRefresh(setLoadCount: Dispatch<SetStateAction<number>>): void {
  void api.clearCache().finally(() => setLoadCount((x) => x + 1))
}

/**
 * Reload a view's data WITHOUT wiping the cache — use after a write that the
 * main process has already applied surgically to its cached data (e.g. an
 * order status patch). Wiping here would force a full store re-download.
 */
export function reloadView(setLoadCount: Dispatch<SetStateAction<number>>): void {
  setLoadCount((x) => x + 1)
}
