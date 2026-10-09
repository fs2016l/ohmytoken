import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { getAppDataDir } from '../lib/paths'
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

export function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  try {
    const state = { ...window.getNormalBounds(), isMaximized: window.isMaximized() }
    mkdirSync(getAppDataDir(), { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(state, null, 2))
  } catch {
    /* Retain the previous valid snapshot on disk failure. */
  }
}

export function trackWindowState(window: BrowserWindow): void {
  window.on('close', () => saveWindowState(window))
}
