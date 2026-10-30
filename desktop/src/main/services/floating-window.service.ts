/**
 * Token 会话悬浮窗服务。
 *
 * 悬浮窗是一个不设置 parent 的独立顶层 BrowserWindow，因此主窗口最小化时
 * 不会跟随隐藏。窗口位置、尺寸、置顶状态和“下次启动时是否恢复显示”单独持久化。
 */
import {
  BrowserWindow,
  ipcMain,
  screen,
  systemPreferences,
  type BrowserWindowConstructorOptions,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../ipc/channels'
import { getAppDataDir } from '../lib/paths'
import { blockDevtoolsShortcuts } from '../lib/devtools-guard'
import {
  FLOATING_WINDOW_INSET,
  floatingWorkspacePath,
  isFloatingResizeDirection,
} from '../../shared/floating-window'
import { FloatingEdgeController } from './floating-edge-controller'
import { attachFloatingWindowFrame, type FloatingWindowFrame } from './floating-window-frame'
import { attachFloatingWindowTopmost, raisePinnedFloatingWindow } from './floating-window-topmost'
import {
  initialFloatingWindowBounds,
  DEFAULT_FLOATING_HEIGHT as DEFAULT_HEIGHT,
  MIN_FLOATING_WIDTH as MIN_WIDTH,
  MIN_FLOATING_HEIGHT as MIN_HEIGHT,
} from './floating-window-bounds'

const stateFile = (): string => join(getAppDataDir(), 'floating-window-state.json')

interface FloatingWindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  visible: boolean
  alwaysOnTop: boolean
  edgeAutoHide: boolean
}

interface FloatingWindowConfig {
  preloadPath: string
  rendererFile: string
  rendererUrl?: string
  getIconPath: () => string
  getMainWindow: () => BrowserWindow | null
  openWorkspace: (path: string) => void
  onVisibilityChanged?: (visible: boolean) => void
  materialOptions?: () => Pick<
    BrowserWindowConstructorOptions,
    'transparent' | 'backgroundColor' | 'visualEffectState'
  >
  windowCreated?: (window: BrowserWindow) => void
  materialTransition?: (window: BrowserWindow, suspended: boolean) => void
}

let floatingWindow: BrowserWindow | null = null
let config: FloatingWindowConfig | null = null
let state: FloatingWindowState = { visible: true, alwaysOnTop: true, edgeAutoHide: true }
let edgeController: FloatingEdgeController | null = null
let stateLoaded = false
let collapsed = false
let expandedHeight = DEFAULT_HEIGHT
let pendingWorkspacePath: string | null = null
let closingForAppQuit = false
let reportedVisibility: boolean | null = null
let floatingTransparent = true
let floatingFrame: FloatingWindowFrame | null = null

function notifyVisibilityChanged(visible: boolean): void {
  if (reportedVisibility === visible) return
  reportedVisibility = visible
  config?.onVisibilityChanged?.(visible)
}

function loadState(): FloatingWindowState {
  try {
    if (existsSync(stateFile())) {
      const parsed = JSON.parse(readFileSync(stateFile(), 'utf-8')) as Partial<FloatingWindowState>
      return {
        x: Number.isFinite(parsed.x) ? parsed.x : undefined,
        y: Number.isFinite(parsed.y) ? parsed.y : undefined,
        width: Number.isFinite(parsed.width) ? parsed.width : undefined,
        height: Number.isFinite(parsed.height) ? parsed.height : undefined,
        // 首次使用默认打开；用户主动关闭后，继续保留已保存的关闭状态。
        visible: parsed.visible !== false,
        // 兼容旧状态文件：未保存该字段时沿用历史行为，默认保持置顶。
        alwaysOnTop: parsed.alwaysOnTop !== false,
        edgeAutoHide: parsed.edgeAutoHide !== false,
      }
    }
  } catch {
    // 文件缺失或损坏时回到默认状态。
  }
  return { visible: true, alwaysOnTop: true, edgeAutoHide: true }
}

function saveState(strict = false): void {
  try {
    const dir = getAppDataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(stateFile(), JSON.stringify(state, null, 2))
  } catch (error) {
    if (strict) throw error
    console.warn('[floating-window] 保存窗口状态失败:', error)
  }
}

function saveBounds(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || edgeController?.adjusting) return
  const bounds = floatingWindow.getBounds()
  state.x = bounds.x
  state.y = bounds.y
  state.width = bounds.width
  if (!collapsed) state.height = bounds.height
  saveState()
}

async function loadFloatingRenderer(window: BrowserWindow): Promise<void> {
  if (!config) throw new Error('悬浮窗尚未配置')
  if (config.rendererUrl) {
    const url = new URL(config.rendererUrl)
    url.searchParams.set('window', 'floating')
    await window.loadURL(url.toString())
    return
  }
  await window.loadFile(config.rendererFile, { query: { window: 'floating' } })
}

function createFloatingWindow(): BrowserWindow {
  if (!config) throw new Error('悬浮窗尚未配置')
  const { size, position, maxHeight } = initialFloatingWindowBounds(state, screen)
  const area = screen.getDisplayMatching({ ...position, ...size }).workArea
  collapsed = false
  expandedHeight = size.height
  const materialOptions = config.materialOptions?.() ?? {}
  floatingTransparent = materialOptions.transparent !== false
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    // A native glass HWND must keep the full client area when edge clipping
    // changes its region. Windows' thick frame otherwise adds side/bottom insets.
    thickFrame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: state.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    minWidth: Math.min(MIN_WIDTH, size.width),
    minHeight: Math.min(MIN_HEIGHT, size.height),
    maxWidth: 900,
    maxHeight,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    ...materialOptions,
    icon: config.getIconPath(),
    webPreferences: {
      preload: config.preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const resizeFrame = attachFloatingWindowFrame(
    window,
    floatingTransparent ? FLOATING_WINDOW_INSET : 0,
  )
  floatingFrame = resizeFrame
  blockDevtoolsShortcuts(window)
  const restoreTopmost = attachFloatingWindowTopmost(window, () => state.alwaysOnTop)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let limitWidth = area.width
  let limitHeight = area.height
  const restoreLimits = (bounds = window.getBounds()): void => {
    const workArea = screen.getDisplayMatching(bounds).workArea
    limitWidth = workArea.width
    limitHeight = workArea.height
    window.setMinimumSize(
      Math.min(MIN_WIDTH, workArea.width),
      Math.min(collapsed ? 64 : MIN_HEIGHT, workArea.height),
    )
    window.setMaximumSize(
      900,
      collapsed ? Math.min(bounds.height, workArea.height) : workArea.height,
    )
  }
  const edge = new FloatingEdgeController(window, {
    enabled: state.edgeAutoHide,
    display: (bounds) => screen.getDisplayMatching(bounds),
    displays: () => screen.getAllDisplays(),
    cursor: () => screen.getCursorScreenPoint(),
    reducedMotion: () => systemPreferences.getAnimationSettings().prefersReducedMotion,
    inset: () => (floatingTransparent ? FLOATING_WINDOW_INSET : 0),
    compositorMotion: process.platform === 'win32' && floatingTransparent,
    changed: (value) => {
      resizeFrame.setEnabled(!value.hidden && !value.transition)
      if (floatingTransparent)
        config?.materialTransition?.(window, value.hidden || !!value.transition)
      // Repair native clipping/material changes without overtaking other overlays.
      if (!value.hidden && value.transition !== 'hiding') restoreTopmost()
      window.webContents.send(IPC.FLOATING_WINDOW_EDGE_CHANGED, value)
    },
    restoreLimits,
  })
  edgeController = edge
  const syncSizeLimits = (): void => {
    if (window.isDestroyed() || edge.adjusting) return
    const workArea = screen.getDisplayMatching(window.getBounds()).workArea
    if (workArea.width !== limitWidth || workArea.height !== limitHeight) restoreLimits()
  }
  const displaysChanged = (): void => {
    edge.displaysChanged()
    syncSizeLimits()
    saveBounds()
  }
  screen.on('display-removed', displaysChanged)
  screen.on('display-metrics-changed', displaysChanged)
  window.on('move', syncSizeLimits)
  window.on('resized', syncSizeLimits)
  window.on('moved', saveBounds)
  window.on('resized', saveBounds)
  // Native macOS dragging can leave the window at its size limit. Keep the
  // docked panel visible until AppKit delivers the end of the resize gesture.
  window.on('will-resize', () => edge.setResizing(true))
  window.on('resized', () => edge.setResizing(false))
  window.on('blur', () => edge.setResizing(false))
  window.on('close', () => {
    saveBounds()
    if (!closingForAppQuit) {
      state.visible = false
      saveState()
      notifyVisibilityChanged(false)
    }
  })
  window.on('closed', () => {
    edge.dispose()
    screen.removeListener('display-removed', displaysChanged)
    screen.removeListener('display-metrics-changed', displaysChanged)
    if (edgeController === edge) edgeController = null
    const wasCurrentWindow = floatingWindow === window
    if (wasCurrentWindow) {
      floatingWindow = null
      floatingFrame = null
    }
    const preserveForNextLaunch = closingForAppQuit
    closingForAppQuit = false
    if (wasCurrentWindow && !preserveForNextLaunch) {
      state.visible = false
      saveState()
      notifyVisibilityChanged(false)
    }
  })
  config.windowCreated?.(window)
  void loadFloatingRenderer(window).catch((error) => {
    console.error('[floating-window] 页面加载失败:', error)
    window.close()
  })
  return window
}

export function configureFloatingWindow(nextConfig: FloatingWindowConfig): void {
  config = nextConfig
  if (!stateLoaded) {
    state = loadState()
    stateLoaded = true
  }
}

export function setFloatingWindowCollapsed(value: boolean, measuredHeight: number): boolean {
  if (typeof value !== 'boolean' || !Number.isFinite(measuredHeight))
    throw new TypeError('Invalid floating window size')
  const window = floatingWindow
  if (!window || window.isDestroyed()) return false
  edgeController?.reveal(false)
  const bounds = window.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  if (value && !collapsed) {
    saveBounds()
    expandedHeight = bounds.height
  }
  collapsed = value
  const height = value
    ? Math.min(area.height, Math.max(64, Math.ceil(measuredHeight)))
    : Math.min(area.height, Math.max(MIN_HEIGHT, expandedHeight))
  if (!value) window.setMaximumSize(900, area.height)
  window.setMinimumSize(
    Math.min(MIN_WIDTH, area.width),
    value ? 64 : Math.min(MIN_HEIGHT, area.height),
  )
  if (value) window.setMaximumSize(900, height)
  window.setBounds({
    height,
    y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
  })
  edgeController?.reanchor()
  saveBounds()
  return collapsed
}

export function shouldRestoreFloatingWindow(): boolean {
  return state.visible
}

/** Windows layered transparency is a creation-time option; preserve the user's window state. */
export function refreshFloatingWindowMaterial(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  const transparent = config?.materialOptions?.().transparent !== false
  if (transparent === floatingTransparent) return
  edgeController?.reveal(false)
  saveBounds()
  const bounds = floatingWindow.getBounds()
  const wasCollapsed = collapsed
  const wasVisible = state.visible
  closingForAppQuit = true
  floatingWindow.destroy()
  if (!wasVisible) return
  floatingWindow = createFloatingWindow()
  if (wasCollapsed) setFloatingWindowCollapsed(true, bounds.height)
  floatingWindow.once('ready-to-show', () => {
    if (state.visible && floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.showInactive()
      raisePinnedFloatingWindow(floatingWindow, state.alwaysOnTop)
      notifyVisibilityChanged(true)
    }
  })
}

export function refreshFloatingWindowIcon(): void {
  if (!floatingWindow || floatingWindow.isDestroyed() || !config) return
  if (process.platform === 'win32') floatingWindow.setIcon(config.getIconPath())
}

export function showFloatingWindow(): void {
  state.visible = true
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    edgeController?.reveal()
    floatingWindow.show()
    floatingWindow.focus()
    raisePinnedFloatingWindow(floatingWindow, state.alwaysOnTop)
    notifyVisibilityChanged(true)
    return
  }
  floatingWindow = createFloatingWindow()
  floatingWindow.once('ready-to-show', () => {
    if (state.visible && floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.show()
      floatingWindow.focus()
      raisePinnedFloatingWindow(floatingWindow, state.alwaysOnTop)
      notifyVisibilityChanged(true)
    }
  })
}

export function closeFloatingWindow(): void {
  state.visible = false
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close()
  notifyVisibilityChanged(false)
}

export async function resetFloatingWindowPreferences(): Promise<void> {
  const window = floatingWindow
  if (window && !window.isDestroyed()) {
    await new Promise<void>((resolve) => {
      window.once('closed', () => resolve())
      window.destroy()
    })
  }
  state = { visible: false, alwaysOnTop: true, edgeAutoHide: true }
  stateLoaded = true
  collapsed = false
  expandedHeight = DEFAULT_HEIGHT
  pendingWorkspacePath = null
  saveState(true)
  notifyVisibilityChanged(false)
}

export function isFloatingWindowVisible(): boolean {
  return (
    state.visible && !!floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()
  )
}

/** Trusted main-process commands share the pending navigation used when restoring a window. */
export function openMainWorkspace(path: string): void {
  pendingWorkspacePath = path
  config?.openWorkspace(path)
}

export function isFloatingWindowAlwaysOnTop(): boolean {
  return state.alwaysOnTop
}

export function setFloatingWindowAlwaysOnTop(alwaysOnTop: boolean): boolean {
  state.alwaysOnTop = alwaysOnTop
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    if (alwaysOnTop) raisePinnedFloatingWindow(floatingWindow, true)
    else floatingWindow.setAlwaysOnTop(false, 'normal')
  }
  return state.alwaysOnTop
}

/** 应用退出时直接销毁窗口，同时保留 visible=true，便于下次启动恢复用户选择。 */
export function destroyFloatingWindowForAppQuit(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  closingForAppQuit = true
  saveBounds()
  floatingWindow.destroy()
}

export function registerFloatingWindowIpc(): void {
  const requireFloatingSender = (event: Electron.IpcMainInvokeEvent): void => {
    if (
      event.sender !== floatingWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Not the floating window')
  }
  ipcMain.handle(IPC.FLOATING_WINDOW_RESIZE_HANDLES, (event) => {
    requireFloatingSender(event)
    return floatingFrame?.rendererHandles ?? false
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_BEGIN_RESIZE, (event, direction: unknown) => {
    requireFloatingSender(event)
    if (!isFloatingResizeDirection(direction)) throw new TypeError('Invalid resize direction')
    if (collapsed && direction !== 'left' && direction !== 'right') return false
    const started = floatingFrame?.beginResize(direction) ?? false
    // Windows only queues its native mouse-down message; a quick release can
    // cancel it before resizing starts. Its will-resize event sets the flag.
    if (started && process.platform === 'darwin') edgeController?.setResizing(true)
    return started
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_SHOW, () => showFloatingWindow())
  ipcMain.handle(IPC.FLOATING_WINDOW_CLOSE, () => closeFloatingWindow())
  ipcMain.handle(IPC.FLOATING_WINDOW_RESET_PREFERENCES, (event) => {
    if (
      event.sender !== config?.getMainWindow()?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Resetting preferences requires the main window')
    return resetFloatingWindowPreferences()
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_IS_VISIBLE, () => isFloatingWindowVisible())
  ipcMain.handle(IPC.FLOATING_WINDOW_GET_ALWAYS_ON_TOP, () => isFloatingWindowAlwaysOnTop())
  ipcMain.handle(IPC.FLOATING_WINDOW_SET_ALWAYS_ON_TOP, (_event, alwaysOnTop: unknown) => {
    if (typeof alwaysOnTop !== 'boolean') throw new TypeError('悬浮窗置顶状态必须是 boolean')
    return setFloatingWindowAlwaysOnTop(alwaysOnTop)
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_GET_COLLAPSED, () => collapsed)
  ipcMain.handle(
    IPC.FLOATING_WINDOW_EDGE_GET,
    () => edgeController?.snapshot ?? { enabled: state.edgeAutoHide, edge: null, hidden: false },
  )
  ipcMain.handle(IPC.FLOATING_WINDOW_EDGE_SET, (event, enabled: unknown) => {
    if (event.sender !== floatingWindow?.webContents) throw new Error('Not the floating window')
    if (typeof enabled !== 'boolean') throw new TypeError('Invalid edge auto-hide preference')
    state.edgeAutoHide = enabled
    saveState()
    return edgeController?.setEnabled(enabled)
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_EDGE_INTERACTION, (event, active: unknown) => {
    if (event.sender !== floatingWindow?.webContents) throw new Error('Not the floating window')
    if (typeof active !== 'boolean') throw new TypeError('Invalid interaction state')
    edgeController?.setInteracting(active)
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_EDGE_REVEAL, (event) => {
    requireFloatingSender(event)
    edgeController?.reveal()
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_EDGE_MOTION_DONE, (event, id: unknown) => {
    if (
      event.sender !== floatingWindow?.webContents ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Not the floating window')
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      throw new TypeError('Invalid edge motion id')
    edgeController?.completeMotion(id)
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_SET_COLLAPSED, (event, value: boolean, height: number) => {
    if (event.sender !== floatingWindow?.webContents) throw new Error('Not the floating window')
    return setFloatingWindowCollapsed(value, height)
  })
  ipcMain.handle(IPC.FLOATING_WINDOW_OPEN_WORKSPACE, (event, destination: unknown) => {
    requireFloatingSender(event)
    openMainWorkspace(floatingWorkspacePath(destination))
  })
  ipcMain.handle(IPC.WORKSPACE_NAVIGATION_TAKE, (event) => {
    if (event.sender !== config?.getMainWindow()?.webContents) return null
    const path = pendingWorkspacePath
    pendingWorkspacePath = null
    return path
  })
}
