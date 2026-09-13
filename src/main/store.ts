/**
 * Tier 1 of the two-tier cache — the local SQLite entity store (node:sqlite,
 * WAL). A faithful port of the WooDesktop cache design: every product,
 * customer and order of the store lives in a local table (full payload JSON +
 * queryable columns) and ALL the UI reads are answered from here without an
 * API call. A background sync worker (sync.ts) keeps the tables fresh via
 * modified_after deltas and upserts through the functions below, which also
 * detect created / updated / status_changed rows into the change_log.
 *
 * Writes made by this app go through the same upserts (silent — the staff
 * action log records those separately), so the store stays consistent
 * immediately after every successful write.
 *
 * The store is bound to one site: a different siteUrl wipes it and the next
 * sync re-baselines. `cache:clear` (بارگذاری مجدد) wipes it too.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import type {
  Customer,
  CustomersResult,
  ListCustomersQuery,
  ListOrdersQuery,
  ListProductsQuery,
  Order,
  OrderStatusTotal,
  OrdersListResult,
  OrdersResult,
  Product,
  ProductCatalog,
  ProductDetail,
  ProductOrdersResult,
  ProductVariation,
  ProductsResult,
  ReportsQuery,
  SalesReport,
  StoreStats,
  SyncChangeEntry,
  SyncChangeQuery,
  SyncChangeResult,
  SyncChangeType,
} from '../shared/types'
import { faStatus } from '../shared/statusLabels'
import { normalizePhone } from '../shared/phone'
import { persianMonthKey } from '../shared/persianMonth'
import { aggregateSalesReport, reportCountsToward, resolveReportWindow } from '../shared/reports'

export type SyncEntity = 'orders' | 'products' | 'customers'
export type UpsertOutcome = 'created' | 'updated' | 'unchanged'

/** Non-trash product statuses kept in the local catalog (listProducts scope). */
export const PRODUCT_STATUSES = ['publish', 'draft', 'private', 'pending']

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  stock_status TEXT NOT NULL DEFAULT '',
  stock_quantity INTEGER,
  manage_stock INTEGER NOT NULL DEFAULT 0,
  total_sales REAL NOT NULL DEFAULT 0,
  date_created TEXT NOT NULL DEFAULT '',
  date_modified_gmt TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS variations (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  stock_status TEXT NOT NULL DEFAULT '',
  stock_quantity INTEGER,
  date_modified_gmt TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_norm TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  date_modified_gmt TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '',
  customer_id INTEGER NOT NULL DEFAULT 0,
  customer_name TEXT NOT NULL DEFAULT '',
  date_created TEXT NOT NULL DEFAULT '',
  date_created_gmt TEXT NOT NULL DEFAULT '',
  date_modified_gmt TEXT NOT NULL DEFAULT '',
  billing_phone TEXT NOT NULL DEFAULT '',
  billing_phone_norm TEXT NOT NULL DEFAULT '',
  billing_email TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL DEFAULT 0,
  variation_id INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  entity TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_modified_cursor INTEGER,
  last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  change_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  actor TEXT,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(date_created DESC);
CREATE INDEX IF NOT EXISTS idx_orders_created_gmt ON orders(date_created_gmt);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variation ON order_items(variation_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone_norm);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_created ON customers(date_created DESC);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_variations_product ON variations(product_id);
CREATE INDEX IF NOT EXISTS idx_change_log_ts ON change_log(id DESC);
`

let db: DatabaseSync | null = null
const stmts = new Map<string, StatementSync>()

function stmt(sql: string): StatementSync {
  if (!db) throw new Error('store is not initialized')
  let s = stmts.get(sql)
  if (!s) {
    s = db.prepare(sql)
    stmts.set(sql, s)
  }
  return s
}

function tx<T>(fn: () => T): T {
  if (!db) throw new Error('store is not initialized')
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

function parse<T>(payload: unknown): T | null {
  if (typeof payload !== 'string' || payload === '') return null
  try {
    return JSON.parse(payload) as T
  } catch {
    return null
  }
}

const utcNow = (): string => new Date().toISOString()

/** GMT modification stamp of a WooCommerce record (delta-sync comparison). */
function modifiedStamp(item: { date_modified_gmt?: string; date_modified?: string }): string {
  return item.date_modified_gmt ?? item.date_modified ?? ''
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Open (and schema-check) the store. When the file belongs to a DIFFERENT
 * site than `siteKey` every table is wiped — cached rows of another store
 * must never leak into this one.
 */
export function initStore(file: string, siteKey: string): void {
  closeStore()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec(SCHEMA)
  // پایگاه‌های قدیمی‌تر ستون actor را ندارند — یک‌بار اضافه می‌شود.
  try {
    db.exec('ALTER TABLE change_log ADD COLUMN actor TEXT')
  } catch {
    /* ستون از قبل وجود دارد */
  }
  const row = stmt('SELECT value FROM meta WHERE key = ?').get('site') as { value?: string } | undefined
  if (!row || row.value !== siteKey) {
    wipeStore()
    stmt('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('site', siteKey)
  }
}

export function closeStore(): void {
  stmts.clear()
  db?.close()
  db = null
}

/** Drop every entity row + sync state + change log (site switch / بارگذاری مجدد). */
export function wipeStore(): void {
  if (!db) return
  tx(() => {
    for (const t of ['products', 'variations', 'customers', 'orders', 'order_items', 'sync_state', 'change_log']) {
      db!.exec('DELETE FROM ' + t)
    }
  })
}

function countOf(entity: 'products' | 'variations' | 'customers' | 'orders'): number {
  const row = stmt(`SELECT COUNT(*) AS c FROM ${entity}`).get() as { c: number }
  return Number(row.c)
}

/* ------------------------------------------------------------------ */
/* Sync state                                                          */
/* ------------------------------------------------------------------ */

export interface SyncRow {
  lastSyncAt: string | null
  cursor: number | null
  lastError: string | null
  itemCount: number
  truncated: boolean
}

export function getSyncRow(entity: SyncEntity): SyncRow {
  const row = stmt('SELECT * FROM sync_state WHERE entity = ?').get(entity) as
    | { last_sync_at: string | null; last_modified_cursor: number | null; last_error: string | null; item_count: number; truncated: number }
    | undefined
  return {
    lastSyncAt: row?.last_sync_at ?? null,
    cursor: row?.last_modified_cursor ?? null,
    lastError: row?.last_error ?? null,
    itemCount: Number(row?.item_count ?? 0),
    truncated: Number(row?.truncated ?? 0) === 1,
  }
}

export function finishSync(
  entity: SyncEntity,
  opts: { cursor?: number; error?: string; truncated?: boolean } = {},
): void {
  const count = entity === 'products' ? countOf('products') : countOf(entity)
  if (opts.error) {
    const prev = getSyncRow(entity)
    stmt(
      `INSERT INTO sync_state (entity, last_sync_at, last_modified_cursor, last_error, item_count, truncated)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity) DO UPDATE SET last_error = excluded.last_error`,
    ).run(
      entity,
      prev.lastSyncAt,
      opts.cursor ?? prev.cursor,
      opts.error,
      prev.itemCount,
      prev.truncated ? 1 : 0,
    )
    return
  }
  const truncated = opts.truncated ? 1 : 0
  stmt(
    `INSERT INTO sync_state (entity, last_sync_at, last_modified_cursor, last_error, item_count, truncated)
     VALUES (?, ?, ?, NULL, ?, ?)
     ON CONFLICT(entity) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       last_modified_cursor = excluded.last_modified_cursor,
       last_error = NULL,
       item_count = excluded.item_count,
       truncated = excluded.truncated`,
  ).run(entity, utcNow(), opts.cursor ?? null, count, truncated)
}

/* ------------------------------------------------------------------ */
/* Change log (تغییرات فروشگاه — detected during sync)                  */
/* ------------------------------------------------------------------ */

const CHANGE_LIMIT = 5000
let changeInserts = 0

/** کارشناسِ فعالِ این گذر سینک — هر تغییرِ ثبت‌شده با همین نام مهر می‌خورد. */
let currentActor: string | null = null

export function setChangeActor(label: string | null): void {
  currentActor = label
}

function addChange(
  entity: SyncEntity,
  entityId: number,
  changeType: SyncChangeType,
  summary: string,
  details = '',
): void {
  stmt(
    'INSERT INTO change_log (entity, entity_id, change_type, summary, details, actor, ts) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(entity, entityId, changeType, summary, details, currentActor, Date.now())
  changeInserts += 1
  if (changeInserts >= 500) {
    changeInserts = 0
    stmt('DELETE FROM change_log WHERE id <= (SELECT id FROM change_log ORDER BY id DESC LIMIT 1 OFFSET ?)').run(
      CHANGE_LIMIT,
    )
  }
}

export function listSyncChanges(q: SyncChangeQuery = {}): SyncChangeResult {
  const perPage = Math.min(200, Math.max(10, q.perPage ?? 50))
  const page = Math.max(1, q.page ?? 1)
  const where: string[] = []
  const params: Array<string | number> = []
  if (q.entity) {
    where.push('entity = ?')
    params.push(q.entity)
  }
  if (q.changeType) {
    where.push('change_type = ?')
    params.push(q.changeType)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const totalRow = stmt(`SELECT COUNT(*) AS c FROM change_log ${whereSql}`).get(...params) as { c: number }
  const rows = stmt(
    `SELECT * FROM change_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
  ).all(...params, perPage, (page - 1) * perPage) as Array<{
    id: number
    entity: string
    entity_id: number
    change_type: string
    summary: string
    details: string
    actor: string | null
    ts: number
  }>
  const entries: SyncChangeEntry[] = rows.map((r) => ({
    id: Number(r.id),
    entity: r.entity as SyncChangeEntry['entity'],
    entityId: Number(r.entity_id),
    changeType: r.change_type as SyncChangeType,
    summary: r.summary,
    details: r.details,
    actor: r.actor ?? null,
    ts: Number(r.ts),
  }))
  return { entries, total: Number(totalRow.c), page, perPage }
}

/* ------------------------------------------------------------------ */
/* Upserts (sync worker + app writes)                                  */
/* ------------------------------------------------------------------ */

function customerNameOf(o: Order, accountName: string | null): string {
  const billingName = [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ').trim()
  if (billingName) return billingName
  if (accountName) return accountName
  if (!o.customer_id) return 'مشتری مهمان'
  return 'مشتری #' + o.customer_id
}

function orderRows(o: Order): { name: string; phone: string; email: string; total: number } {
  const billingName = [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ').trim()
  const name = billingName || (o.customer_id ? 'مشتری #' + o.customer_id : 'مشتری مهمان')
  return {
    name,
    phone: String(o.billing?.phone ?? ''),
    email: String(o.billing?.email ?? ''),
    total: Number(o.total) || 0,
  }
}

export function upsertOrder(o: Order, opts: { silent?: boolean } = {}): UpsertOutcome {
  if (!o || !Number.isFinite(Number(o.id))) return 'unchanged'
  const row = stmt('SELECT status, date_modified_gmt FROM orders WHERE id = ?').get(o.id) as
    | { status: string; date_modified_gmt: string }
    | undefined
  const stamp = modifiedStamp(o)
  if (row && row.date_modified_gmt && stamp && row.date_modified_gmt >= stamp) return 'unchanged'
  const statusChanged = !!row && row.status !== o.status
  // Display-name enrichment from the local customers table (no API).
  let accountName: string | null = null
  if (o.customer_id) {
    const c = stmt('SELECT payload FROM customers WHERE id = ?').get(o.customer_id) as { payload: string } | undefined
    if (c) {
      const cust = parse<Customer>(c.payload)
      accountName = [cust?.first_name, cust?.last_name].filter(Boolean).join(' ').trim() || null
    }
  }
  const r = orderRows(o)
  tx(() => {
    stmt(
      `INSERT INTO orders (id, number, status, total, currency, customer_id, customer_name,
        date_created, date_created_gmt, date_modified_gmt, billing_phone, billing_phone_norm,
        billing_email, payload, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         number = excluded.number, status = excluded.status, total = excluded.total,
         currency = excluded.currency, customer_id = excluded.customer_id,
         customer_name = excluded.customer_name, date_created = excluded.date_created,
         date_created_gmt = excluded.date_created_gmt, date_modified_gmt = excluded.date_modified_gmt,
         billing_phone = excluded.billing_phone, billing_phone_norm = excluded.billing_phone_norm,
         billing_email = excluded.billing_email, payload = excluded.payload, synced_at = excluded.synced_at`,
    ).run(
      o.id,
      String(o.number ?? o.id),
      o.status,
      r.total,
      String(o.currency ?? ''),
      Number(o.customer_id) || 0,
      customerNameOf(o, accountName),
      String(o.date_created ?? ''),
      String(o.date_created_gmt ?? ''),
      stamp,
      r.phone,
      normalizePhone(r.phone),
      r.email.toLowerCase(),
      JSON.stringify(o),
      utcNow(),
    )
    stmt('DELETE FROM order_items WHERE order_id = ?').run(o.id)
    for (const l of o.line_items ?? []) {
      stmt(
        'INSERT INTO order_items (order_id, product_id, variation_id, quantity, line_total) VALUES (?, ?, ?, ?, ?)',
      ).run(
        o.id,
        Number(l.product_id) || 0,
        Number(l.variation_id) || 0,
        Number(l.quantity) || 0,
        Number(l.total) || 0,
      )
    }
  })
  if (!opts.silent) {
    const label = '#' + (o.number || o.id)
    if (!row) addChange('orders', o.id, 'created', 'سفارش جدید: ' + label, r.name)
    else if (statusChanged)
      addChange('orders', o.id, 'status_changed', 'تغییر وضعیت سفارش ' + label, faStatus(row.status) + ' ← ' + faStatus(o.status))
    else addChange('orders', o.id, 'updated', 'بروزرسانی سفارش ' + label, r.name)
  }
  return row ? 'updated' : 'created'
}

export function upsertCustomer(c: Customer, opts: { silent?: boolean } = {}): UpsertOutcome {
  if (!c || !Number.isFinite(Number(c.id))) return 'unchanged'
  const row = stmt('SELECT date_modified_gmt FROM customers WHERE id = ?').get(c.id) as
    | { date_modified_gmt: string }
    | undefined
  const stamp = modifiedStamp(c)
  if (row && row.date_modified_gmt && stamp && row.date_modified_gmt >= stamp) return 'unchanged'
  const phone = String(c.billing?.phone ?? '')
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || c.email || '#' + c.id
  tx(() => {
    stmt(
      `INSERT INTO customers (id, email, first_name, last_name, username, phone, phone_norm,
        date_created, date_modified_gmt, payload, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email, first_name = excluded.first_name, last_name = excluded.last_name,
         username = excluded.username, phone = excluded.phone, phone_norm = excluded.phone_norm,
         date_created = excluded.date_created, date_modified_gmt = excluded.date_modified_gmt,
         payload = excluded.payload, synced_at = excluded.synced_at`,
    ).run(
      c.id,
      String(c.email ?? '').toLowerCase(),
      String(c.first_name ?? ''),
      String(c.last_name ?? ''),
      String(c.username ?? ''),
      phone,
      normalizePhone(phone),
      String(c.date_created ?? ''),
      stamp,
      JSON.stringify(c),
      utcNow(),
    )
    // The account's display name may fill order rows that only knew «مشتری #id».
    if (name) {
      stmt(
        `UPDATE orders SET customer_name = ? WHERE customer_id = ? AND customer_name LIKE 'مشتری #%'`,
      ).run(name, c.id)
    }
  })
  if (!opts.silent) {
    if (!row) addChange('customers', c.id, 'created', 'مشتری جدید: ' + name)
    else addChange('customers', c.id, 'updated', 'بروزرسانی مشتری: ' + name)
  }
  return row ? 'updated' : 'created'
}

export function upsertProduct(p: Product, opts: { silent?: boolean } = {}): UpsertOutcome {
  if (!p || !Number.isFinite(Number(p.id))) return 'unchanged'
  const row = stmt('SELECT status, date_modified_gmt FROM products WHERE id = ?').get(p.id) as
    | { status: string; date_modified_gmt: string }
    | undefined
  const stamp = modifiedStamp(p)
  if (row && row.date_modified_gmt && stamp && row.date_modified_gmt >= stamp) return 'unchanged'
  const statusChanged = !!row && row.status !== p.status
  stmt(
    `INSERT INTO products (id, name, sku, price, status, type, stock_status, stock_quantity,
      manage_stock, total_sales, date_created, date_modified_gmt, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, sku = excluded.sku, price = excluded.price, status = excluded.status,
       type = excluded.type, stock_status = excluded.stock_status, stock_quantity = excluded.stock_quantity,
       manage_stock = excluded.manage_stock, total_sales = excluded.total_sales,
       date_created = excluded.date_created, date_modified_gmt = excluded.date_modified_gmt,
       payload = excluded.payload, synced_at = excluded.synced_at`,
  ).run(
    p.id,
    String(p.name ?? ''),
    String(p.sku ?? ''),
    String(p.price ?? ''),
    String(p.status ?? ''),
    String(p.type ?? ''),
    String(p.stock_status ?? ''),
    typeof p.stock_quantity === 'number' ? Math.round(p.stock_quantity) : null,
    p.manage_stock === true ? 1 : 0,
    Number(p.total_sales) || 0,
    String(p.date_created ?? ''),
    stamp,
    JSON.stringify(p),
    utcNow(),
  )
  if (!opts.silent) {
    if (!row) addChange('products', p.id, 'created', 'محصول جدید: ' + p.name)
    else if (statusChanged)
      addChange('products', p.id, 'status_changed', 'تغییر وضعیت محصول: ' + p.name, faStatus(row.status) + ' ← ' + faStatus(p.status))
    else addChange('products', p.id, 'updated', 'بروزرسانی محصول: ' + p.name)
  }
  return row ? 'updated' : 'created'
}

export function upsertVariation(productId: number, v: ProductVariation): void {
  if (!v || !Number.isFinite(Number(v.id))) return
  const row = stmt('SELECT date_modified_gmt FROM variations WHERE id = ?').get(v.id) as
    | { date_modified_gmt: string }
    | undefined
  const stamp = modifiedStamp(v)
  if (row && row.date_modified_gmt && stamp && row.date_modified_gmt >= stamp) return
  stmt(
    `INSERT INTO variations (id, product_id, sku, price, stock_status, stock_quantity,
      date_modified_gmt, payload, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       product_id = excluded.product_id, sku = excluded.sku, price = excluded.price,
       stock_status = excluded.stock_status, stock_quantity = excluded.stock_quantity,
       date_modified_gmt = excluded.date_modified_gmt, payload = excluded.payload,
       synced_at = excluded.synced_at`,
  ).run(
    v.id,
    productId,
    String(v.sku ?? ''),
    String(v.price ?? ''),
    String(v.stock_status ?? ''),
    typeof v.stock_quantity === 'number' ? Math.round(v.stock_quantity) : null,
    stamp,
    JSON.stringify(v),
    utcNow(),
  )
}

/** Drop local rows whose id is no longer in the store's id list. */
export function deleteMissingOrders(ids: Set<number>): number {
  const local = stmt('SELECT id FROM orders').all() as Array<{ id: number }>
  const gone = local.map((r) => Number(r.id)).filter((id) => !ids.has(id))
  tx(() => {
    for (const id of gone) {
      stmt('DELETE FROM orders WHERE id = ?').run(id)
      stmt('DELETE FROM order_items WHERE order_id = ?').run(id)
    }
  })
  return gone.length
}

/** Per-status delete diff for the product catalog. */
export function deleteMissingProducts(status: string, ids: Set<number>): number {
  const local = stmt('SELECT id FROM products WHERE status = ?').all(status) as Array<{ id: number }>
  const gone = local.map((r) => Number(r.id)).filter((id) => !ids.has(id))
  tx(() => {
    for (const id of gone) {
      stmt('DELETE FROM products WHERE id = ?').run(id)
      stmt('DELETE FROM variations WHERE product_id = ?').run(id)
    }
  })
  return gone.length
}

/** After a fresh variation walk of one product, drop combinations that vanished. */
export function replaceVariationsOf(productId: number, ids: Set<number>): void {
  const local = stmt('SELECT id FROM variations WHERE product_id = ?').all(productId) as Array<{ id: number }>
  const gone = local.map((r) => Number(r.id)).filter((id) => !ids.has(id))
  tx(() => {
    for (const id of gone) stmt('DELETE FROM variations WHERE id = ?').run(id)
  })
}

/* ------------------------------------------------------------------ */
/* Reads — every query the UI needs, answered locally                  */
/* ------------------------------------------------------------------ */

const PURCHASE_EXCLUDED = "('failed', 'cancelled', 'refunded')"

export function getOrderById(id: number): Order | null {
  const row = stmt('SELECT payload, customer_name FROM orders WHERE id = ?').get(id) as
    | { payload: string; customer_name: string }
    | undefined
  const o = parse<Order>(row?.payload)
  if (o && row) o.customer_name = row.customer_name
  return o
}

export function ordersByIds(ids: number[]): Order[] {
  if (ids.length === 0) return []
  const out: Order[] = []
  for (const id of ids) {
    const o = getOrderById(id)
    if (o) out.push(o)
  }
  return out
}

/** Newest `limit` orders (payload parsed) — feeds the warehouse reconcile pass. */
export function recentOrders(limit: number): Order[] {
  const rows = stmt('SELECT payload FROM orders ORDER BY date_created DESC LIMIT ?').all(limit) as Array<{
    payload: string
  }>
  return rows.map((r) => parse<Order>(r.payload)).filter((o): o is Order => !!o)
}

/** All orders created inside a GMT window (ISO bounds, [from, to)). */
export function ordersInWindow(fromIso: string, toIso: string): Order[] {
  const rows = stmt(
    'SELECT payload FROM orders WHERE date_created_gmt >= ? AND date_created_gmt < ? ORDER BY date_created ASC',
  ).all(fromIso, toIso) as Array<{ payload: string }>
  return rows.map((r) => parse<Order>(r.payload)).filter((o): o is Order => !!o)
}

export function listOrders(q: ListOrdersQuery = {}): OrdersListResult {
  // Bulk print (exact ids) — the print flow may reference orders older than
  // the visible page; serve the exact ids in the requested order.
  if (q.include && q.include.length > 0) {
    const orders = q.include.map((id) => getOrderById(id)).filter((o): o is Order => !!o)
    return { orders, total: orders.length, totalPages: 1, page: 1, perPage: orders.length }
  }

  const search = (q.search ?? '').trim().toLowerCase()
  const status = (q.status ?? '').trim()
  const where: string[] = []
  const params: Array<string | number> = []
  if (status) {
    where.push('status = ?')
    params.push(status)
  }
  if (search) {
    where.push("(number LIKE ? OR customer_name LIKE ? OR billing_phone_norm LIKE ? OR billing_email LIKE ?)")
    const like = '%' + search + '%'
    params.push(like, like, like, like)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const perPage = Math.min(100, Math.max(1, q.perPage ?? 50))
  const page = Math.max(1, q.page ?? 1)
  const totalRow = stmt(`SELECT COUNT(*) AS c FROM orders ${whereSql}`).get(...params) as { c: number }
  const rows = stmt(
    `SELECT payload, customer_name FROM orders ${whereSql} ORDER BY date_created DESC LIMIT ? OFFSET ?`,
  ).all(...params, perPage, (page - 1) * perPage) as Array<{ payload: string; customer_name: string }>
  const orders = rows
    .map((r) => {
      const o = parse<Order>(r.payload)
      if (o) o.customer_name = r.customer_name
      return o
    })
    .filter((o): o is Order => !!o)
  return {
    orders,
    total: Number(totalRow.c),
    totalPages: Math.max(1, Math.ceil(Number(totalRow.c) / perPage)),
    page,
    perPage,
  }
}

const CUSTOMER_AGG = `
  SELECT o.customer_id AS cid, COUNT(*) AS cnt,
         SUM(CASE WHEN o.status NOT IN ${PURCHASE_EXCLUDED} THEN o.total ELSE 0 END) AS spent,
         MAX(CASE WHEN o.status NOT IN ${PURCHASE_EXCLUDED} AND o.date_created >= ? THEN 1 ELSE 0 END) AS this_month
  FROM orders o WHERE o.customer_id > 0 GROUP BY o.customer_id`

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Local-naive ISO of the first day of the current Persian month (month-key walk). */
function persianMonthStartIso(): string {
  const now = new Date()
  const key = persianMonthKey(now)
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  for (let i = 0; i < 40; i++) {
    const prev = new Date(d)
    prev.setDate(prev.getDate() - 1)
    if (persianMonthKey(prev) !== key) break
    d.setTime(prev.getTime())
  }
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T00:00:00`
}

interface CustomerAggRow {
  cid: number
  cnt: number
  spent: number | null
  this_month: number | null
}

function customerAggregates(): Map<number, { cnt: number; spent: number; thisMonth: boolean }> {
  const rows = stmt(CUSTOMER_AGG).all(persianMonthStartIso()) as unknown as CustomerAggRow[]
  const map = new Map<number, { cnt: number; spent: number; thisMonth: boolean }>()
  for (const r of rows) {
    map.set(Number(r.cid), { cnt: Number(r.cnt), spent: round2(Number(r.spent) || 0), thisMonth: Number(r.this_month) === 1 })
  }
  return map
}

function decorateCustomer(c: Customer, agg: { cnt: number; spent: number } | undefined): Customer {
  if (!agg) return { ...c, orders_count: 0, total_spent: '0' }
  return { ...c, orders_count: agg.cnt, total_spent: String(agg.spent) }
}

export function findCustomersByPhone(phone: string): Customer[] {
  const norm = normalizePhone(phone)
  if (!norm) return []
  const agg = customerAggregates()
  const tail = norm.length >= 10 ? norm.slice(-10) : norm
  const rows = stmt(
    `SELECT payload FROM customers WHERE phone_norm = ? OR substr(phone_norm, -10) = ? ORDER BY date_created DESC`,
  ).all(norm, tail) as Array<{ payload: string }>
  return rows
    .map((r) => parse<Customer>(r.payload))
    .filter((c): c is Customer => !!c)
    .map((c) => decorateCustomer(c, agg.get(c.id)))
}

export function listCustomers(q: ListCustomersQuery = {}): CustomersResult {
  if (q.phone) {
    const matches = findCustomersByPhone(q.phone)
    return { customers: matches, total: matches.length, totalPages: 1, page: 1, perPage: Math.max(1, matches.length) }
  }
  const search = (q.search ?? '').trim().toLowerCase()
  const where: string[] = []
  const params: Array<string | number> = []
  if (search) {
    where.push('(first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone_norm LIKE ? OR username LIKE ?)')
    const like = '%' + search + '%'
    params.push(like, like, like, like, like)
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const perPage = Math.min(100, Math.max(1, q.perPage ?? 100))
  const page = Math.max(1, q.page ?? 1)
  const totalRow = stmt(`SELECT COUNT(*) AS c FROM customers ${whereSql}`).get(...params) as { c: number }
  const rows = stmt(
    `SELECT payload FROM customers ${whereSql} ORDER BY date_created DESC LIMIT ? OFFSET ?`,
  ).all(...params, perPage, (page - 1) * perPage) as Array<{ payload: string }>
  const agg = customerAggregates()
  const customers = rows
    .map((r) => parse<Customer>(r.payload))
    .filter((c): c is Customer => !!c)
    .map((c) => decorateCustomer(c, agg.get(c.id)))
  return { customers, total: Number(totalRow.c), totalPages: Math.max(1, Math.ceil(Number(totalRow.c) / perPage)), page, perPage }
}

export function customerOrders(customerId: number): OrdersResult {
  const rows = stmt(
    'SELECT payload, customer_name FROM orders WHERE customer_id = ? ORDER BY date_created DESC LIMIT 100',
  ).all(customerId) as Array<{ payload: string; customer_name: string }>
  const orders = rows
    .map((r) => {
      const o = parse<Order>(r.payload)
      if (o) o.customer_name = r.customer_name
      return o
    })
    .filter((o): o is Order => !!o)
  const aggRow = stmt(
    `SELECT SUM(CASE WHEN status NOT IN ${PURCHASE_EXCLUDED} THEN total ELSE 0 END) AS spent FROM orders WHERE customer_id = ?`,
  ).get(customerId) as { spent: number | null }
  const truncated = getSyncRow('orders').truncated
  return {
    orders,
    total: orders.length,
    page: 1,
    perPage: 100,
    purchaseSum: round2(Number(aggRow.spent) || 0),
    purchaseSumTruncated: truncated,
  }
}

export function listProducts(q: ListProductsQuery = {}): ProductsResult {
  const requested = (q.status ?? '').trim()
  const search = (q.search ?? '').trim().toLowerCase()
  const stock = (q.stockStatus ?? '').trim()
  const statuses = requested ? [requested] : PRODUCT_STATUSES
  const placeholders = statuses.map(() => '?').join(',')

  // Widget scope: search + publication status (the stock segment is ignored so
  // the stat widgets always describe the whole filtered catalog).
  const scopeWhere = [`status IN (${placeholders})`]
  const scopeParams: Array<string | number> = [...statuses]
  if (search) {
    scopeWhere.push('(name LIKE ? OR sku LIKE ?)')
    const like = '%' + search + '%'
    scopeParams.push(like, like)
  }
  const scopeSql = 'WHERE ' + scopeWhere.join(' AND ')
  const statsRow = stmt(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN stock_status = 'instock' THEN 1 ELSE 0 END) AS instock,
            SUM(CASE WHEN stock_status = 'outofstock' THEN 1 ELSE 0 END) AS outofstock,
            SUM(total_sales) AS total_sales
     FROM products ${scopeSql}`,
  ).get(...scopeParams) as { total: number; instock: number | null; outofstock: number | null; total_sales: number | null }

  const rowsWhere = [...scopeWhere]
  const rowsParams = [...scopeParams]
  if (stock) {
    rowsWhere.push('stock_status = ?')
    rowsParams.push(stock)
  }
  const perPage = Math.min(100, Math.max(1, q.perPage ?? 100))
  const page = Math.max(1, q.page ?? 1)
  const totalRow = stmt(`SELECT COUNT(*) AS c FROM products WHERE ${rowsWhere.join(' AND ')}`).get(...rowsParams) as {
    c: number
  }
  const rows = stmt(
    `SELECT payload FROM products WHERE ${rowsWhere.join(' AND ')} ORDER BY date_created DESC LIMIT ? OFFSET ?`,
  ).all(...rowsParams, perPage, (page - 1) * perPage) as Array<{ payload: string }>
  const products = rows.map((r) => parse<Product>(r.payload)).filter((p): p is Product => !!p)
  const total = Number(totalRow.c)
  return {
    products,
    total,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
    page,
    perPage,
    totalAll: Number(statsRow.total),
    inStock: Number(statsRow.instock ?? 0),
    outOfStock: Number(statsRow.outofstock ?? 0),
    totalSales: round2(Number(statsRow.total_sales) || 0),
  }
}

export function catalog(): ProductCatalog {
  const rows = stmt('SELECT payload FROM products ORDER BY date_created DESC').all() as Array<{ payload: string }>
  const products = rows.map((r) => parse<Product>(r.payload)).filter((p): p is Product => !!p)
  return { products, total: products.length, truncated: getSyncRow('products').truncated }
}

export function productDetail(productId: number): ProductDetail | null {
  const row = stmt('SELECT payload FROM products WHERE id = ?').get(productId) as { payload: string } | undefined
  const product = parse<Product>(row?.payload)
  if (!product) return null
  const variations =
    product.type === 'variable'
      ? (stmt('SELECT payload FROM variations WHERE product_id = ? ORDER BY id ASC').all(productId) as Array<{
          payload: string
        }>)
          .map((r) => parse<ProductVariation>(r.payload))
          .filter((v): v is ProductVariation => !!v)
      : []
  return { product, variations }
}

export function productOrders(productId: number): ProductOrdersResult {
  const rows = stmt(
    'SELECT DISTINCT o.payload AS payload FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = ?',
  ).all(productId) as Array<{ payload: string }>
  const all = rows.map((r) => parse<Order>(r.payload)).filter((o): o is Order => !!o)
  const valid = all.filter((o) => reportCountsToward(o.status))
  const unitsSold = valid.reduce(
    (acc, o) => acc + o.line_items.filter((l) => (l.product_id ?? productId) === productId).reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    0,
  )
  const revenueSum = round2(valid.reduce((acc, o) => acc + (Number(o.total) || 0), 0))
  return {
    orders: valid,
    total: valid.length,
    unitsSold,
    revenueSum,
    excluded: all.length - valid.length,
    revenueTruncated: false,
    truncated: getSyncRow('orders').truncated,
  }
}

export function statusTotals(): OrderStatusTotal[] {
  const rows = stmt('SELECT status, COUNT(*) AS c FROM orders GROUP BY status').all() as Array<{
    status: string
    c: number
  }>
  return rows
    .filter((r) => r.status && r.status !== 'trash')
    .map((r) => ({ slug: r.status, name: faStatus(r.status), total: Number(r.c) }))
    .sort((a, b) => b.total - a.total)
}

export function storeStats(): StoreStats {
  const agg = customerAggregates()
  let sum = 0
  let monthCustomers = 0
  for (const a of agg.values()) {
    sum += a.spent
    if (a.thisMonth) monthCustomers += 1
  }
  return {
    totalCustomers: countOf('customers'),
    sum: round2(sum),
    monthCustomers,
    partial: false,
    truncated: getSyncRow('customers').truncated,
    computedAt: new Date().toISOString(),
  }
}

export function salesReport(query: ReportsQuery, costs?: Record<string, number>): SalesReport {
  const { fromMs, toMs, days } = resolveReportWindow(query)
  const from = new Date(fromMs)
  const to = new Date(toMs + 1)
  const prevFrom = new Date(from)
  prevFrom.setDate(prevFrom.getDate() - days)
  const cur = ordersInWindow(from.toISOString(), to.toISOString())
  const prev = ordersInWindow(prevFrom.toISOString(), from.toISOString())
  return {
    ...aggregateSalesReport(cur, days, fromMs, toMs, costs, prev),
    truncated: getSyncRow('orders').truncated,
  }
}

/** Grouped variations of every variable product (warehouses snapshot source). */
export function allVariations(): Map<number, ProductVariation[]> {
  const rows = stmt('SELECT product_id, payload FROM variations ORDER BY id ASC').all() as Array<{
    product_id: number
    payload: string
  }>
  const map = new Map<number, ProductVariation[]>()
  for (const r of rows) {
    const v = parse<ProductVariation>(r.payload)
    if (!v) continue
    const pid = Number(r.product_id)
    const list = map.get(pid)
    if (list) list.push(v)
    else map.set(pid, [v])
  }
  return map
}

/**
 * Fold a stock write (انبارداری save / تخصیص) into the stored row of one
 * product or combination. The site is the source of truth — callers pass the
 * values from the PUT response, so the local row matches what the store kept.
 * date_modified_gmt is intentionally left alone: the next delta upsert must
 * still be able to apply a newer site stamp.
 */
export function patchNodeStock(
  productId: number,
  variationId: number | null,
  patch: { stock?: number | null; stockStatus?: string; meta?: Record<string, number> },
): void {
  const id = variationId ?? productId
  const table = variationId == null ? 'products' : 'variations'
  const row = stmt(`SELECT payload FROM ${table} WHERE id = ?`).get(id) as { payload: string } | undefined
  const node = parse<Product | ProductVariation>(row?.payload)
  if (!node) return
  if (typeof patch.stock === 'number') node.stock_quantity = patch.stock
  if (patch.stockStatus) node.stock_status = patch.stockStatus
  if (patch.meta && Object.keys(patch.meta).length > 0) {
    const md = (node.meta_data ?? []).map((m) => ({ ...m }))
    for (const [key, value] of Object.entries(patch.meta)) {
      const i = md.findIndex((m) => m.key === key)
      if (i >= 0) md[i] = { ...md[i], value }
      else md.push({ key, value })
    }
    node.meta_data = md
  }
  stmt(`UPDATE ${table} SET payload = ?, stock_quantity = ?, stock_status = ? WHERE id = ?`).run(
    JSON.stringify(node),
    typeof node.stock_quantity === 'number' ? node.stock_quantity : null,
    String(node.stock_status ?? ''),
    id,
  )
}
