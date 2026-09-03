import type { ApiBridge } from '../shared/types'
import { mockApi } from './lib/mock'

declare global {
  interface Window {
    api?: ApiBridge
  }
}

const hasWindow = typeof window !== 'undefined'

/**
 * Contexts without the preload bridge, split by how the page is served:
 *  - file://  → the PACKAGED desktop app, whose preload failed to attach.
 *    This must NEVER silently fall back to demo data — show a clear error.
 *  - http(s)  → plain browser, a dev-server page, or an embedded webview
 *    (e.g. the app preview). No bridge exists by design there, so the real
 *    API is unreachable and only demo data is possible (clearly labeled).
 */
export const bridgeMissing = hasWindow && !window.api && window.location.protocol === 'file:'

export const demoMode = hasWindow && !window.api && !bridgeMissing

/** True when the demo (mock) data source is in use. */
export const isMock = demoMode

/** Used when no real bridge exists; callers must gate on demoMode/bridgeMissing first. */
export const api: ApiBridge = window.api ?? mockApi
