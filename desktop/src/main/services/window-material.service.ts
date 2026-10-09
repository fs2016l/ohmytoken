import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  type BrowserWindowConstructorOptions,
  type IpcMainInvokeEvent,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { release } from 'node:os'
import { createRequire } from 'node:module'
import {
  DEFAULT_MATERIAL,
  MATERIAL_IPC,
  materialBackend,
  materialPreferences,
  type MaterialPreferences,
  type WindowMaterialState,
} from '../../shared/window-material'
import {
  applyWindowMaterial,
  materialWindowOptions,
  type MaterialNativeBridge,
} from './window-material-core'

type WindowKind = 'main' | 'floating'
interface AttachedWindow {
  kind: WindowKind
  transparent: boolean
  moving: boolean
  suspended: boolean
  state: WindowMaterialState
}
let preferences: MaterialPreferences | undefined
let native: MaterialNativeBridge | null | undefined
const attached = new Map<BrowserWindow, AttachedWindow>()
const changes = new Set<() => void>()
const preferenceFile = (): string => join(app.getPath('userData'), 'window-material.json')
function getPreferences(): MaterialPreferences {
  if (!preferences) {
    try {
      preferences = materialPreferences(JSON.parse(readFileSync(preferenceFile(), 'utf8')))
    } catch {
      preferences = { ...DEFAULT_MATERIAL }
    }
  }
  return preferences
}
function nativeBridge(): MaterialNativeBridge | null {
  if (native !== undefined) return native
  native = null
  if (process.platform !== 'win32' && process.platform !== 'darwin') return native
  try {
    const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    const path = join(
      root,
      'window-material',
      `${process.platform}-${process.arch}`,
      'window_material.node',
    )
    if (existsSync(path)) native = createRequire(__filename)(path) as MaterialNativeBridge
  } catch (error) {
    console.warn(
      '[window-material] Native material unavailable:',
      error instanceof Error ? error.message : String(error),
    )
  }
  return native
}
function backend() {
  let available = false
  try {
    available = nativeBridge()?.status().available ?? false
  } catch {
    /* Fall back. */
  }
  return materialBackend(process.platform, release(), available)
}
/** BrowserWindow transparency cannot be changed after creation on Windows. */
export function windowMaterialOptions(
  kind: WindowKind,
): Pick<BrowserWindowConstructorOptions, 'transparent' | 'backgroundColor' | 'visualEffectState'> {
  return materialWindowOptions(kind, getPreferences(), backend())
}
function apply(window: BrowserWindow, data: AttachedWindow): void {
  if (window.isDestroyed()) return
  const next = applyWindowMaterial(window, getPreferences(), {
    platform: process.platform,
    release: release(),
    accessibility: nativeTheme,
    native: nativeBridge(),
    floating: data.kind === 'floating',
    transparent: data.transparent,
    moving: data.moving,
    suspended: data.suspended,
  })
  const changed = JSON.stringify(next) !== JSON.stringify(data.state)
  data.state = next
  if (changed && !window.webContents.isLoadingMainFrame())
    window.webContents.send(MATERIAL_IPC.CHANGED, next)
}
function applyAll(): void {
  for (const [window, data] of attached) apply(window, data)
}
export function attachWindowMaterial(window: BrowserWindow, kind: WindowKind): void {
  const data: AttachedWindow = {
    kind,
    transparent: windowMaterialOptions(kind).transparent === true,
    moving: false,
    suspended: false,
    state: {
      preferences: { ...getPreferences() },
      backend: backend(),
      active: false,
      reason: null,
    },
  }
  attached.set(window, data)
  const refresh = (): void => apply(window, data)
  window.once('ready-to-show', refresh)
  window.on('show', refresh)
  window.on('restore', refresh)
  window.webContents.on('did-finish-load', () => {
    refresh()
    window.webContents.send(MATERIAL_IPC.CHANGED, data.state)
  })
  // Use the native move/resize loop; avoid Acrylic's expensive Win10 live recomposition.
  if (
    data.state.backend === 'windows-accent' ||
    (process.platform === 'win32' && kind === 'floating')
  ) {
    window.hookWindowMessage(0x0231, () => {
      data.moving = true
      setImmediate(refresh)
    })
    window.hookWindowMessage(0x0232, () => {
      data.moving = false
      setImmediate(refresh)
    })
  }
  if (process.platform === 'win32') {
    window.hookWindowMessage(0x001a, () => setImmediate(refresh))
    window.hookWindowMessage(0x031e, () => setImmediate(refresh))
  }
  window.once('closed', () => {
    attached.delete(window)
  })
}
export function suspendFloatingWindowMaterial(window: BrowserWindow, suspended: boolean): void {
  const data = attached.get(window)
  if (!data || data.kind !== 'floating' || data.suspended === suspended) return
  data.suspended = suspended
  apply(window, data)
}
export function onWindowMaterialChanged(callback: () => void): () => void {
  changes.add(callback)
  return () => {
    changes.delete(callback)
  }
}
export function getWindowMaterialPreferences(): MaterialPreferences {
  return getPreferences()
}
export function registerWindowMaterialIpc(): void {
  if (nativeTheme.themeSource !== getPreferences().appearance)
    nativeTheme.themeSource = getPreferences().appearance
  function sender(event: IpcMainInvokeEvent): { window: BrowserWindow; data: AttachedWindow } {
    const window = BrowserWindow.fromWebContents(event.sender)
    const data = window && attached.get(window)
    if (!window || !data || event.senderFrame !== event.sender.mainFrame)
      throw new Error('Unknown material window')
    return { window, data }
  }
  ipcMain.handle(MATERIAL_IPC.GET, (event) => {
    const { window, data } = sender(event)
    apply(window, data)
    return data.state
  })
  ipcMain.handle(MATERIAL_IPC.SET, (event, input: unknown) => {
    const { window, data } = sender(event)
    const next = materialPreferences(input, getPreferences())
    if (
      next.style !== preferences!.style ||
      next.appearance !== preferences!.appearance ||
      next.palette !== preferences!.palette
    ) {
      mkdirSync(app.getPath('userData'), { recursive: true })
      writeFileSync(preferenceFile(), JSON.stringify(next), 'utf8')
      preferences = next
      if (nativeTheme.themeSource !== next.appearance) nativeTheme.themeSource = next.appearance
      applyAll()
      // Refresh any live floating window after the shared preference changes.
      for (const callback of changes) callback()
    } else apply(window, data)
    return data.state
  })
  let accessibility = ''
  nativeTheme.on('updated', () => {
    const key = `${nativeTheme.prefersReducedTransparency}:${nativeTheme.inForcedColorsMode}:${nativeTheme.shouldUseHighContrastColors}`
    if (accessibility === key) return
    accessibility = key
    applyAll()
  })
}
