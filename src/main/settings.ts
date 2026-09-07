import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/types'

const EMPTY: Settings = { siteUrl: '', consumerKey: '', consumerSecret: '' }

/** Cache tuning defaults (seconds / hours) — mirrored by the Settings UI. */
export const CACHE_DEFAULTS = { listSec: 60, detailSec: 120, reportSec: 300, staleHours: 12 } as const

type CacheKind = 'list' | 'detail' | 'report'

function clampNum(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

function file(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function getSettings(): Settings {
  try {
    const raw = fs.readFileSync(file(), 'utf8')
    const data = JSON.parse(raw)
    return {
      siteUrl: typeof data.siteUrl === 'string' ? data.siteUrl : '',
      consumerKey: typeof data.consumerKey === 'string' ? data.consumerKey : '',
      consumerSecret: typeof data.consumerSecret === 'string' ? data.consumerSecret : '',
      storeName: typeof data.storeName === 'string' ? data.storeName : undefined,
      storeAddress: typeof data.storeAddress === 'string' ? data.storeAddress : undefined,
      storePostcode: typeof data.storePostcode === 'string' ? data.storePostcode : undefined,
      storePhone: typeof data.storePhone === 'string' ? data.storePhone : undefined,
      storeLogo: typeof data.storeLogo === 'string' ? data.storeLogo : undefined,
      noteExclusions: Array.isArray(data.noteExclusions)
        ? (data.noteExclusions as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined,
      productCosts:
        data.productCosts && typeof data.productCosts === 'object' && !Array.isArray(data.productCosts)
          ? Object.fromEntries(
              Object.entries(data.productCosts as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
                .map(([k, v]) => [k, v as number]),
            )
          : undefined,
      lowStockThreshold:
        typeof data.lowStockThreshold === 'number' && Number.isFinite(data.lowStockThreshold)
          ? clampThreshold(data.lowStockThreshold)
          : undefined,
      cacheListSec: clampNum(data.cacheListSec, 5, 86_400, CACHE_DEFAULTS.listSec),
      cacheDetailSec: clampNum(data.cacheDetailSec, 5, 86_400, CACHE_DEFAULTS.detailSec),
      cacheReportSec: clampNum(data.cacheReportSec, 5, 86_400, CACHE_DEFAULTS.reportSec),
      cacheStaleHours: clampNum(data.cacheStaleHours, 0, 168, CACHE_DEFAULTS.staleHours),
    }
  } catch {
    return { ...EMPTY }
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(settings, null, 2), 'utf8')
}

export function clearSettings(): void {
  try {
    fs.rmSync(file(), { force: true })
  } catch {
    /* ignore */
  }
}

/** Normalize and trim user input for a site URL. */
export function sanitizeSettings(input: Settings): Settings {
  return {
    siteUrl: normalizeSiteUrl(input.siteUrl),
    consumerKey: input.consumerKey.trim(),
    consumerSecret: input.consumerSecret.trim(),
    storeName: (input.storeName ?? '').trim() || undefined,
    storeAddress: (input.storeAddress ?? '').trim() || undefined,
    storePostcode: (input.storePostcode ?? '').trim() || undefined,
    storePhone: (input.storePhone ?? '').trim() || undefined,
    storeLogo: (input.storeLogo ?? '').trim() || undefined,
    // One phrase per line from the settings textarea: trimmed, non-empty, deduped.
    noteExclusions: [...new Set((input.noteExclusions ?? []).map((p) => p.trim()).filter(Boolean))],
    // Cost of goods per product id (تومان): keep only positive finite numbers.
    productCosts: Object.fromEntries(
      Object.entries(input.productCosts ?? {})
        .map(([k, v]) => [k.trim(), Number(v)])
        .filter(([, v]) => Number.isFinite(v) && (v as number) > 0),
    ),
    lowStockThreshold:
      typeof input.lowStockThreshold === 'number' && Number.isFinite(input.lowStockThreshold)
        ? clampThreshold(input.lowStockThreshold)
        : undefined,
    cacheListSec: clampNum(input.cacheListSec, 5, 86_400, CACHE_DEFAULTS.listSec),
    cacheDetailSec: clampNum(input.cacheDetailSec, 5, 86_400, CACHE_DEFAULTS.detailSec),
    cacheReportSec: clampNum(input.cacheReportSec, 5, 86_400, CACHE_DEFAULTS.reportSec),
    cacheStaleHours: clampNum(input.cacheStaleHours, 0, 168, CACHE_DEFAULTS.staleHours),
  }
}

/** Cache lifetime for one endpoint weight class, from saved settings (ms). */
export function cacheTtlMs(settings: Settings, kind: CacheKind): number {
  const raw = kind === 'list' ? settings.cacheListSec : kind === 'detail' ? settings.cacheDetailSec : settings.cacheReportSec
  const sec = clampNum(raw, 5, 86_400, CACHE_DEFAULTS[kind === 'list' ? 'listSec' : kind === 'detail' ? 'detailSec' : 'reportSec'])
  return sec * 1000
}

/** Max age of a disk snapshot served on cold start (ms) — 0 disables stale serving. */
export function cacheStaleMs(settings: Settings): number {
  return clampNum(settings.cacheStaleHours, 0, 168, CACHE_DEFAULTS.staleHours) * 60 * 60 * 1000
}

/** حد نصاب موجودی: عدد صحیح بین ۱ تا ۹۹۹۹ (پیش‌فرضِ UI وقتی خالی است: ۵). */
function clampThreshold(n: number): number {
  return Math.min(9999, Math.max(1, Math.round(n)))
}

export function normalizeSiteUrl(input: string): string {
  let s = input.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s.replace(/\/+$/, '')
}
