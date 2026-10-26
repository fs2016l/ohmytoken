import type { BrowserWindow } from 'electron'

/** Explicit show/pin requests may raise the panel without taking keyboard focus. */
export function raisePinnedFloatingWindow(window: BrowserWindow, alwaysOnTop: boolean): void {
  if (!alwaysOnTop || window.isDestroyed()) return
  window.setAlwaysOnTop(true, 'floating')
  // showInactive() can leave an already-visible HWND behind another topmost window.
  if (window.isVisible()) window.moveTop()
}

/** Repair a lost native flag without overtaking screenshot tools or other overlays. */
export function attachFloatingWindowTopmost(
  window: BrowserWindow,
  alwaysOnTop: () => boolean,
): () => void {
  let disposed = false
  let applying = false
  let pending: ReturnType<typeof setImmediate> | undefined
  const restore = (): void => {
    if (disposed || applying || !alwaysOnTop() || window.isDestroyed() || window.isAlwaysOnTop())
      return
    applying = true
    try {
      window.setAlwaysOnTop(true, 'floating')
    } finally {
      applying = false
    }
  }
  const repair = (): void => {
    if (
      disposed ||
      applying ||
      pending ||
      !alwaysOnTop() ||
      window.isDestroyed() ||
      window.isAlwaysOnTop()
    )
      return
    // Leave native show/style updates before restoring the level. Coalesce events
    // and recheck both preference and native flag: a stale repair must not reorder.
    pending = setImmediate(() => {
      pending = undefined
      restore()
    })
    pending.unref()
  }
  const topmostChanged = (_event: Electron.Event, enabled: boolean): void => {
    if (!enabled) repair()
  }
  const dispose = (): void => {
    disposed = true
    clearImmediate(pending)
    pending = undefined
    window.removeListener('show', restore)
    window.removeListener('restore', restore)
    window.removeListener('blur', repair)
    window.removeListener('always-on-top-changed', topmostChanged)
  }
  window.on('show', restore)
  window.on('restore', restore)
  window.on('blur', repair)
  window.on('always-on-top-changed', topmostChanged)
  window.once('closed', dispose)
  restore()
  return restore
}
