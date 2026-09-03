import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '../shared/types'

const EMPTY: Settings = { siteUrl: '', consumerKey: '', consumerSecret: '' }

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
  }
}

export function normalizeSiteUrl(input: string): string {
  let s = input.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s.replace(/\/+$/, '')
}
