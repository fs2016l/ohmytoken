import { reactive, toRaw, watch } from 'vue'
import {
  createBoundedBrowsingState,
  type BrowsingPageSnapshot,
  type BrowsingValue,
} from '@shared/browsing-state'

let snapshot = createBoundedBrowsingState()
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const inFlight = new Set<Promise<void>>()
let initialized = false
let resetting = false

export async function initializeBrowsingState(): Promise<void> {
  if (initialized) return
  initialized = true
  try {
    snapshot = createBoundedBrowsingState(await window.api.readBrowsingState())
    // Discard the retired auto-favorite intent before any page restores its state.
    const retiredIntent = 'discovery-favorite-intent'
    if (snapshot.get(retiredIntent)?.state.targetType) {
      snapshot.delete(retiredIntent)
      await window.api.writeBrowsingState(retiredIntent, { state: {}, scroll: {} })
    }
  } catch (error) {
    console.error('[browsing-state] Restore failed', error)
    // A transient IPC failure must not prevent the application from opening.
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) void flushBrowsingState()
  })
  window.addEventListener('pagehide', () => {
    void flushBrowsingState()
  })
}

function page(key: string): BrowsingPageSnapshot {
  return snapshot.get(key) ?? { state: {}, scroll: {} }
}

function persist(key: string): void {
  const timer = pending.get(key)
  if (timer) clearTimeout(timer)
  pending.delete(key)
  const saved = snapshot.get(key)
  if (!saved) return
  const value = structuredClone(saved)
  const request = window.api
    .writeBrowsingState(key, value)
    .catch((error: unknown) => console.error('[browsing-state] Save failed', error))
    .finally(() => inFlight.delete(request))
  inFlight.add(request)
}

function remember(key: string, value: BrowsingPageSnapshot): void {
  try {
    for (const evicted of snapshot.write(key, value)) {
      const timer = pending.get(evicted)
      if (timer) clearTimeout(timer)
      pending.delete(evicted)
    }
    schedule(key)
  } catch (error) {
    console.error('[browsing-state] Snapshot too large or invalid', error)
  }
}

function schedule(key: string): void {
  if (resetting) return
  const timer = pending.get(key)
  if (timer) clearTimeout(timer)
  pending.set(
    key,
    setTimeout(() => persist(key), 120),
  )
}

/** Only filters, selection and paging; never credentials or scanned conversations. */
export function usePageState<T extends Record<string, BrowsingValue>>(key: string, defaults: T): T {
  const state = reactive({ ...defaults, ...page(key).state }) as T
  watch(
    state,
    () => {
      remember(key, { ...page(key), state: JSON.parse(JSON.stringify(toRaw(state))) })
    },
    { deep: true, flush: 'sync' },
  )
  return state
}

export function savePageScroll(key: string, scrollKey: string, top: number, left = 0): void {
  const current = page(key)
  remember(key, {
    ...current,
    scroll: {
      ...current.scroll,
      [scrollKey]: { top: Math.max(0, top), left: Math.max(0, left) },
    },
  })
}

export function getPageScroll(key: string, scrollKey: string) {
  return page(key).scroll[scrollKey] ?? { top: 0, left: 0 }
}

export async function flushBrowsingState(): Promise<void> {
  if (resetting) return
  for (const key of pending.keys()) persist(key)
  await Promise.all(inFlight)
}

/** Stop old KeepAlive pages and unload events from restoring filters before the renderer reloads. */
export async function resetBrowsingState(): Promise<void> {
  await flushBrowsingState()
  resetting = true
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  try {
    await Promise.all(inFlight)
    const saved = await window.api.readBrowsingState()
    // Normal background saves tolerate IPC errors; a reset must not reload with an unsaved draft.
    const feedback = snapshot.get('settings-feedback') ?? saved['settings-feedback']
    if (feedback) await window.api.writeBrowsingState('settings-feedback', feedback)
    for (const key of Object.keys(saved)) {
      if (key === 'settings-feedback') continue
      await window.api.writeBrowsingState(key, { state: {}, scroll: {} })
    }
    snapshot = createBoundedBrowsingState(feedback ? { 'settings-feedback': feedback } : undefined)
  } catch (error) {
    resetting = false
    throw error
  }
}
