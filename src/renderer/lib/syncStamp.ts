import { api } from '../api'

/**
 * Best-known time the store was actually fetched for an endpoint prefix
 * (customers, orders, products, reports, …). On a cache hit this is older than
 * "now" — which is exactly the point of the «آخرین همگام‌سازی» badge: it shows
 * when the data really came from WooCommerce, not when the cache served it.
 *
 * Returns null when unknown (fresh browser demo, no cache info yet, error) —
 * callers then fall back to the time the response arrived.
 */
export async function lastStoreSync(prefix: string): Promise<Date | null> {
  try {
    const st = await api.getCacheStatus()
    const ts = st.syncedAt[prefix]
    return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? new Date(ts) : null
  } catch {
    return null
  }
}
