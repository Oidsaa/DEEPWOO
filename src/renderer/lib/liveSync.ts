import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * Live-refresh wiring for the background sync (سینک پس‌زمینه): the main
 * process broadcasts «data:synced» whenever a sync pass lands data — including
 * throttled pings WHILE a walk is still paging, so a first-run baseline
 * streams rows into open lists instead of leaving them empty for minutes.
 *
 * One module-level subscription feeds every mounted view; each view bumps its
 * own local load counter, so search/filter/page state survives refetches.
 */
let version = 0
const listeners = new Set<() => void>()
let subscribed = false

function ensureSubscribed(): void {
  if (subscribed) return
  subscribed = true
  api.onSynced(() => {
    version += 1
    for (const fn of listeners) fn()
  })
}

/** Returns a counter that ticks whenever synced data changed — put it in load effects. */
export function useSyncRefresh(): number {
  const [v, setV] = useState(version)
  useEffect(() => {
    ensureSubscribed()
    const fn = () => setV(version)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return v
}
