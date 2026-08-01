/**
 * Token 会话悬浮窗服务。
 *
 * 悬浮窗是一个不设置 parent 的独立顶层 BrowserWindow，因此主窗口最小化时
 * 不会跟随隐藏。窗口位置、尺寸、置顶状态和“下次启动时是否恢复显示”单独持久化。
 */
import { BrowserWindow, ipcMain, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../ipc/channels'
import { getAppDataDir } from '../lib/paths'

const STATE_FILE = join(getAppDataDir(), 'floating-window-state.json')
const DEFAULT_WIDTH = 500
const DEFAULT_HEIGHT = 720
const MIN_WIDTH = 400
const MIN_HEIGHT = 520

interface FloatingWindowState {
  x?: number
  y?: number
  width?: number
  height?: number
  visible: boolean
  alwaysOnTop: boolean
}

interface FloatingWindowConfig {
  preloadPath: string
  rendererFile: string
  rendererUrl?: string
  iconPath: string
}

let floatingWindow: BrowserWindow | null = null
let config: FloatingWindowConfig | null = null
const state = loadState()
let closingForAppQuit = false

function loadState(): FloatingWindowState {
  try {
    if (existsSync(STATE_FILE)) {
      const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as Partial<FloatingWindowState>
      return {
        x: typeof parsed.x === 'number' ? parsed.x : undefined,
        y: typeof parsed.y === 'number' ? parsed.y : undefined,
        width: typeof parsed.width === 'number' ? parsed.width : undefined,
        height: typeof parsed.height === 'number' ? parsed.height : undefined,
        visible: parsed.visible === true,
        // 兼容旧状态文件：未保存该字段时沿用历史行为，默认保持置顶。
        alwaysOnTop: parsed.alwaysOnTop !== false,
      }
    }
  } catch {
    // 文件缺失或损坏时回到默认状态。
  }
  return { visible: false, alwaysOnTop: true }
}

function saveState(): void {
  try {
    const dir = getAppDataDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch (error) {
    console.warn('[floating-window] 保存窗口状态失败:', error)
  }
}

function saveBounds(): void {
  if (!floatingWindow || floatingWindow.isDestroyed()) return
  const bounds = floatingWindow.getBounds()
  state.x = bounds.x
  state.y = bounds.y
  state.width = bounds.width
  state.height = bounds.height
  saveState()
}

function initialSize(): { width: number; height: number } {
  return {
    width: Math.max(MIN_WIDTH, state.width ?? DEFAULT_WIDTH),
    height: Math.max(MIN_HEIGHT, state.height ?? DEFAULT_HEIGHT),
  }
}

function isSavedPositionVisible(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      x < area.x + area.width - 40 &&
      x + width > area.x + 40 &&
      y < area.y + area.height - 40 &&
      y + height > area.y + 40
    )
  })
}

function initialPosition(size: { width: number; height: number }): { x: number; y: number } {
  if (
    typeof state.x === 'number' &&
    typeof state.y === 'number' &&
    isSavedPositionVisible(state.x, state.y, size.width, size.height)
  ) {
    return { x: state.x, y: state.y }
  }
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x + area.width - size.width - 24, y: area.y + 24 }
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
  const size = initialSize()
  const position = initialPosition(size)
  const window = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: position.x,
    y: position.y,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: state.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidth: 900,
    maxHeight: 1100,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: '#00000000',
    icon: config.iconPath,
    webPreferences: {
      preload: config.preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (state.alwaysOnTop) window.setAlwaysOnTop(true, 'floating')
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.on('moved', saveBounds)
  window.on('resized', saveBounds)
  window.on('close', () => {
    saveBounds()
    if (!closingForAppQuit) {
      state.visible = false
      saveState()
    }
  })
  window.on('closed', () => {
    floatingWindow = null
    closingForAppQuit = false
  })
  void loadFloatingRenderer(window).catch((error) => {
    console.error('[floating-window] 页面加载失败:', error)
    window.close()
  })
  return window
}

export function configureFloatingWindow(nextConfig: FloatingWindowConfig): void {
  config = nextConfig
}

export function shouldRestoreFloatingWindow(): boolean {
  return state.visible
}

export function showFloatingWindow(): void {
  state.visible = true
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.show()
    floatingWindow.focus()
    return
  }
  floatingWindow = createFloatingWindow()
  floatingWindow.once('ready-to-show', () => {
    if (state.visible && floatingWindow && !floatingWindow.isDestroyed()) {
      floatingWindow.show()
      floatingWindow.focus()
    }
  })
}

export function closeFloatingWindow(): void {
  state.visible = false
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) floatingWindow.close()
}

export function isFloatingWindowVisible(): boolean {
  return !!floatingWindow && !floatingWindow.isDestroyed() && floatingWindow.isVisible()
}

export function isFloatingWindowAlwaysOnTop(): boolean {
  if (floatingWindow && !floatingWindow.isDestroyed()) return floatingWindow.isAlwaysOnTop()
  return state.alwaysOnTop
}

export function setFloatingWindowAlwaysOnTop(alwaysOnTop: boolean): boolean {
  state.alwaysOnTop = alwaysOnTop
  saveState()
  if (floatingWindow && !floatingWindow.isDestroyed()) {
    floatingWindow.setAlwaysOnTop(alwaysOnTop, alwaysOnTop ? 'floating' : 'normal')
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
  ipcMain.handle(IPC.FLOATING_WINDOW_SHOW, () => showFloatingWindow())
  ipcMain.handle(IPC.FLOATING_WINDOW_CLOSE, () => closeFloatingWindow())
  ipcMain.handle(IPC.FLOATING_WINDOW_IS_VISIBLE, () => isFloatingWindowVisible())
  ipcMain.handle(IPC.FLOATING_WINDOW_GET_ALWAYS_ON_TOP, () => isFloatingWindowAlwaysOnTop())
  ipcMain.handle(IPC.FLOATING_WINDOW_SET_ALWAYS_ON_TOP, (_event, alwaysOnTop: unknown) => {
    if (typeof alwaysOnTop !== 'boolean') throw new TypeError('悬浮窗置顶状态必须是 boolean')
    return setFloatingWindowAlwaysOnTop(alwaysOnTop)
  })
}
