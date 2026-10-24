import { ipcMain, screen, type BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getAppDataDir } from '../lib/paths'
import { IPC } from '../ipc/channels'
import { WINDOW_CHROME_HEIGHT } from '../../shared/window-chrome'
import {
  fitMainWindow,
  type SavedWindowState,
  type WindowFrameSize,
} from '../../shared/window-geometry'

export type WindowState = ReturnType<typeof fitMainWindow>

// Resolve after Electron is ready; importing this service must not access app paths.
function stateFile(): string {
  return join(getAppDataDir(), 'window-state.json')
}

export function loadWindowState(frame?: WindowFrameSize): WindowState {
  let saved: SavedWindowState = {}
  try {
    if (existsSync(stateFile())) {
      const parsed: unknown = JSON.parse(readFileSync(stateFile(), 'utf-8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        saved = parsed as SavedWindowState
    }
  } catch {
    /* A malformed state never prevents opening the app. */
  }
  const hasPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y)
  const display = hasPosition
    ? screen.getDisplayNearestPoint({ x: saved.x!, y: saved.y! })
    : screen.getPrimaryDisplay()
  return fitMainWindow(saved, display.workArea, frame)
}

export function saveWindowState(window: BrowserWindow, strict = false): void {
  try {
    if (window.isDestroyed()) throw new Error('Main window is closed')
    const state = { ...window.getNormalBounds(), isMaximized: window.isMaximized() }
    mkdirSync(getAppDataDir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(state, null, 2))
  } catch (error) {
    if (strict) throw error
    /* Retain the previous valid snapshot on disk failure. */
  }
}

function waitForWindowTransition(
  window: NodeJS.EventEmitter,
  event: 'restore' | 'leave-full-screen' | 'unmaximize',
  transition: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer)
      window.removeListener(event, done)
      window.removeListener('closed', closed)
    }
    const done = (): void => {
      cleanup()
      resolve()
    }
    const closed = (): void => {
      cleanup()
      reject(new Error('Main window closed while restoring defaults'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Main window did not finish ${event}`))
    }, 5000)
    window.once(event, done)
    window.once('closed', closed)
    try {
      transition()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export async function resetMainWindowPreferences(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) throw new Error('Main window is closed')
  const display = screen.getDisplayMatching(window.getBounds())
  if (window.isMinimized()) await waitForWindowTransition(window, 'restore', () => window.restore())
  if (window.isFullScreen())
    await waitForWindowTransition(window, 'leave-full-screen', () => window.setFullScreen(false))
  if (window.isMaximized())
    await waitForWindowTransition(window, 'unmaximize', () => window.unmaximize())

  // Match the initial window's content size, measuring the frame after leaving maximized/fullscreen.
  const outer = window.getBounds()
  const content = window.getContentBounds()
  const defaults = fitMainWindow({}, display.workArea, {
    width: outer.width - content.width,
    height:
      outer.height - content.height + (process.platform === 'win32' ? WINDOW_CHROME_HEIGHT : 0),
  })
  window.setMinimumSize(defaults.minWidth, defaults.minHeight)
  window.setBounds({ x: defaults.x, y: defaults.y, width: defaults.width, height: defaults.height })
  // A failed write must keep the settings dialog retryable instead of reporting success.
  saveWindowState(window, true)
}

export function registerWindowStateIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.MAIN_WINDOW_RESET_PREFERENCES, async (event) => {
    const window = getWindow()
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error('Unknown main window sender')
    await resetMainWindowPreferences(window)
  })
}

export function trackWindowState(window: BrowserWindow): void {
  window.on('close', () => saveWindowState(window))
}
