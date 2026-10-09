import { app, type BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  floatingResizeDirections,
  type FloatingResizeDirection,
} from '../../shared/floating-window'

interface FloatingFrameBridge {
  setFloatingFrame: (handle: Buffer, inset: number, enabled: boolean) => void
  beginFloatingResize: (handle: Buffer, direction: number) => boolean
}
let native: FloatingFrameBridge | undefined

export interface FloatingWindowFrame {
  rendererHandles: boolean
  setEnabled: (enabled: boolean) => void
  beginResize: (direction: FloatingResizeDirection) => boolean
}

/** The renderer supplies the hit area and cursor; Windows performs the drag. */
export function attachFloatingWindowFrame(
  window: BrowserWindow,
  inset: number,
): FloatingWindowFrame {
  const fallback: FloatingWindowFrame = {
    rendererHandles: false,
    setEnabled: () => {},
    beginResize: () => false,
  }
  if (process.platform !== 'win32' || !inset) return fallback
  try {
    const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    native ??= createRequire(__filename)(
      join(root, 'window-material', `win32-${process.arch}`, 'window_material.node'),
    ) as FloatingFrameBridge
    const bridge = native
    if (typeof bridge.beginFloatingResize !== 'function')
      throw new Error('The native resize module needs rebuilding')
    const handle = window.getNativeWindowHandle()
    let enabled = true
    const apply = (): void => {
      if (!window.isDestroyed()) bridge.setFloatingFrame(handle, inset, enabled)
    }
    apply()
    // The native input child can be created/replaced after BrowserWindow construction.
    window.webContents.on('did-finish-load', apply)
    window.on('ready-to-show', apply)
    return {
      rendererHandles: true,
      setEnabled(value) {
        enabled = value
        apply()
      },
      beginResize(direction) {
        return !window.isDestroyed() && enabled
          ? bridge.beginFloatingResize(handle, floatingResizeDirections[direction])
          : false
      },
    }
  } catch (error) {
    // An unavailable optional native module must not prevent access to the monitor.
    console.warn('[floating-window] Could not align the native resize frame:', error)
    return fallback
  }
}
