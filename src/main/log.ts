/**
 * Change log (لاگ تغییرات) — append-only record of every WRITE action performed
 * through this app, attributed to the کارشناس who performed it (the display
 * name of the API key's owner, resolved via wp/v2/users/me).
 *
 * Entries live in <userData>/change-log.json: loaded once at startup, appended
 * in memory, saved debounced. The file is bounded — beyond MAX_ENTRIES the
 * oldest rows are pruned on the next save. Logging NEVER throws: a failing
 * log must not break the action it records.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ChangeLogEntry, ChangeLogQuery, ChangeLogResult } from '../shared/types'

const MAX_ENTRIES = 20_000
const SAVE_DEBOUNCE_MS = 400

let filePath: string | null = null
let entries: ChangeLogEntry[] = []
let loaded = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

/** Load the on-disk log (call once at startup, before any IPC runs). */
export function initLog(dir: string): void {
  filePath = path.join(dir, 'change-log.json')
  entries = []
  loaded = true
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const data = JSON.parse(raw) as unknown
    if (Array.isArray(data)) {
      entries = data.filter(
        (e): e is ChangeLogEntry =>
          !!e && typeof (e as ChangeLogEntry).ts === 'number' && typeof (e as ChangeLogEntry).user === 'string',
      )
    }
  } catch {
    /* missing/corrupt file — start empty */
  }
}

/** Record one action. Fire-and-forget safe. */
export function appendLog(entry: Omit<ChangeLogEntry, 'ts'> & { ts?: number }): void {
  if (!loaded) return
  entries.push({
    ts: entry.ts ?? Date.now(),
    user: entry.user,
    section: entry.section,
    action: entry.action,
    title: entry.title,
    details: entry.details,
    target: entry.target,
  })
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
  scheduleSave()
}

/** Paged/filtered view for the UI (newest first). */
export function queryLog(q: ChangeLogQuery): ChangeLogResult {
  const search = (q.search ?? '').trim().toLowerCase()
  let list = [...entries].reverse()
  if (q.user) list = list.filter((e) => e.user === q.user)
  if (q.section) list = list.filter((e) => e.section === q.section)
  if (search) {
    list = list.filter(
      (e) =>
        e.title.toLowerCase().includes(search) ||
        (e.details ?? '').toLowerCase().includes(search) ||
        (e.target ?? '').toLowerCase().includes(search) ||
        e.user.toLowerCase().includes(search),
    )
  }
  const perPage = Math.min(200, Math.max(10, q.perPage ?? 50))
  const page = Math.max(1, q.page ?? 1)
  const users = [...new Set(entries.map((e) => e.user))].sort((a, b) => a.localeCompare(b, 'fa'))
  return {
    entries: list.slice((page - 1) * perPage, page * perPage),
    total: list.length,
    page,
    perPage,
    users,
  }
}

function scheduleSave(): void {
  if (!filePath) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS)
}

function saveNow(): void {
  if (!filePath) return
  try {
    const tmp = filePath + '.tmp'
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(entries), 'utf8')
    fs.renameSync(tmp, filePath)
  } catch {
    /* disk full/permissions — keep running with the in-memory log */
  }
}

/** Synchronously persist the log now (used on app quit). */
export function flushLog(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (loaded) saveNow()
}
