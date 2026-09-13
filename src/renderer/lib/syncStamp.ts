import { api } from '../api'

/**
 * Best-known time an entity's data was really synced from WooCommerce. With
 * the local SQLite store this is the sync engine's per-entity stamp (an order
 * list read is served from the store, so "now" is meaningless as a sync time);
 * the old endpoint-prefix cache map is only a fallback.
 *
 * Returns null when unknown (fresh browser demo, no info yet, error) — callers
 * then fall back to the time the response arrived.
 */
export async function lastStoreSync(prefix: string): Promise<Date | null> {
  try {
    const st = await api.getCacheStatus()
    // entity مبنا: سفارش‌ها/مشتریان/محصولات/گزارش‌ها → orders/customers/products.
    const entity = prefix === 'reports' || prefix === 'warehouses-overview' ? (prefix === 'reports' ? 'orders' : 'products') : prefix
    const ent = st.entities?.[entity]
    if (ent?.lastSyncAt) {
      const d = new Date(ent.lastSyncAt)
      if (!Number.isNaN(d.getTime())) return d
    }
    const ts = st.syncedAt[prefix]
    return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? new Date(ts) : null
  } catch {
    return null
  }
}
