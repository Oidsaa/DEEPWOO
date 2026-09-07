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
