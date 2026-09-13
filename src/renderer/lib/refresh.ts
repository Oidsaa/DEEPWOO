import type { Dispatch, SetStateAction } from 'react'
import { api } from '../api'

type RefreshEntity = 'orders' | 'products' | 'customers'

/**
 * Manual «به‌روزرسانی» — runs the SAME delta pass the background sync worker
 * runs, but just for this view's entity and right now, then reloads the list
 * from the local store. Landing pages stream in live via data:synced pings,
 * so views refresh mid-pass too.
 *
 * When setSyncing is passed, it flips true for the whole pass so the view's
 * refresh button can spin (and stay disabled) until fresh data lands.
 *
 * The full rebuild (wipe the store + complete baseline re-download) is NOT
 * this — it lives in Settings as «بازسازی کامل داده‌ها» for rare recovery
 * cases, since a delta pass can never discover a corrupted/diverged store.
 */
export function forceRefresh(
  entity: RefreshEntity,
  setLoadCount: Dispatch<SetStateAction<number>>,
  setSyncing?: Dispatch<SetStateAction<boolean>>,
): void {
  setSyncing?.(true)
  void api
    .syncNow(entity)
    .catch(() => {})
    .finally(() => {
      setSyncing?.(false)
      setLoadCount((x) => x + 1)
    })
}

/**
 * Reload a view's data WITHOUT any sync — use after a write that the main
 * process has already applied surgically to the local store (e.g. an order
 * status patch). Forcing a pass here would just burn a round-trip.
 */
export function reloadView(setLoadCount: Dispatch<SetStateAction<number>>): void {
  setLoadCount((x) => x + 1)
}
