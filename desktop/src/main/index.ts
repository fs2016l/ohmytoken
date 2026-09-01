import { is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { IPC } from './ipc/channels'
import { registerIpcHandlers, stopSseService } from './ipc/handlers'
import { initDataStorage } from './services/data-storage.service'
import { getAccessToken } from './services/auth.service'
import { ensureAgentClientRegistered } from './services/client-registration.service'
import {
  initializeDiagnosticLogging,
  recordDiagnosticEvent,
  registerGlobalDiagnosticHandlers,
  reportDiagnosticError,
} from './services/diagnostic-log.service'
import {
  closeFloatingWindow,
  configureFloatingWindow,
  destroyFloatingWindowForAppQuit,
  isFloatingWindowVisible,
  registerFloatingWindowIpc,
  shouldRestoreFloatingWindow,
  showFloatingWindow,
} from './services/floating-window.service'
import { getDesktopRuntimeConfig } from './services/runtime-config.service'
import { stopBackgroundScan } from './services/scan.service'
import { initAutoUpdater } from './services/updater.service'
import { loadWindowState, trackWindowState } from './services/window-state.service'
import {
  configureTray,
  destroyTray,
  handleMainWindowClose,
  initializeTray,
  refreshTrayMenu,
} from './services/tray.service'

// 统一应用名：影响 app.getPath('userData') → %APPDATA%\ohmytoken\
// 必须在任何 getPath / requestSingleInstanceLock 之前调用
app.setName('ohmytoken')
// 开发态独立分组，避免与正式版或旧 Electron 图标缓存共用任务栏入口。
if (process.platform === 'win32') {
  // Use a fresh development identity so Windows does not reuse the old taskbar icon cache.
  const appUserModelId = is.dev ? 'com.ohmytoken.desktop.dev.brand-v2' : 'com.ohmytoken.desktop'
  app.setAppUserModelId(appUserModelId)
}

function getBrandIconPath(iconFile: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'brand', iconFile)
    : join(__dirname, '../../src/renderer/public/brand', iconFile)
}

function getAppIconPath(): string {
  return getBrandIconPath(process.platform === 'win32' ? 'app-icon.ico' : 'app-icon-256.png')
}

function getTrayIconPath(): string {
  return process.platform === 'darwin' ? getBrandIconPath('trayTemplate.png') : getAppIconPath()
}

// 不调用 app.getPath，可在 ready 前注册，确保启动阶段主进程异常也会被观察到。
registerGlobalDiagnosticHandlers()

let mainWindow: BrowserWindow | null = null
let isQuitting = false

/**
 * 获取当前主窗口引用（可能为 null）。
 *
 * M8 修复：handlers.ts / updater.service.ts / auth.service.ts 通过此 getter
 * 动态获取窗口，macOS activate 重建窗口后无需重新 register/init，
 * 避免旧窗口引用导致事件发到已销毁的 webContents。
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

function createWindow(): void {
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 上次是最大化状态则恢复最大化
  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  // 记住用户调整的窗口大小和位置（debounce 500ms 保存）
  trackWindowState(mainWindow)

  mainWindow.on('ready-to-show', () => {
    // Force the live window icon once more so the Windows taskbar refreshes stale Shell state.
    if (process.platform === 'win32') {
      mainWindow?.setIcon(getAppIconPath())
    }
    mainWindow?.show()
  })

  mainWindow.on('unresponsive', () => {
    recordDiagnosticEvent('renderer', 'unresponsive', '主窗口渲染进程无响应')
  })

  mainWindow.on('close', (event) => {
    if (isQuitting || !mainWindow) return
    handleMainWindowClose(event, mainWindow)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    reportDiagnosticError(
      {
        reportType: 'crash',
        source: 'renderer-process',
        stage: details.reason,
        severity: details.reason === 'crashed' ? 'fatal' : 'error',
        summary: 'Agent 界面进程异常退出',
        message: `renderer process ${details.reason} (exitCode=${details.exitCode})`,
        context: { reason: details.reason, exitCode: details.exitCode },
      },
      { autoUpload: true, persistPending: true },
    )
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return
      reportDiagnosticError(
        {
          reportType: 'renderer',
          source: 'renderer-load',
          stage: 'did-fail-load',
          severity: 'error',
          summary: 'Agent 界面加载失败',
          message: `${errorDescription} (code=${errorCode})`,
          context: { validatedURL },
        },
        { autoUpload: !is.dev, persistPending: !is.dev },
      )
    },
  )

  mainWindow.on('closed', () => {
    mainWindow = null
    // Windows/Linux 关闭主窗口就是退出程序。悬浮窗不能让进程残留。
    if (process.platform !== 'darwin' && !isQuitting) app.quit()
  })

  // dev: F12 开关 DevTools；prod: 屏蔽 Ctrl+R / F5 刷新
  optimizer.watchWindowShortcuts(mainWindow)

  // 外部链接（target=_blank、window.open）转系统浏览器，Electron 内不开新窗口
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const rendererUrl = process.env.ELECTRON_RENDERER_URL
    const isTrustedRendererUrl = is.dev
      ? Boolean(rendererUrl && new URL(url).origin === new URL(rendererUrl).origin)
      : url.startsWith('file:')
    if (isTrustedRendererUrl) return

    event.preventDefault()
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
  })
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 仅对 http/https 链接调用系统浏览器，避免拦截mailto/自定义协议等异常链接
    if (details.url.startsWith('http://') || details.url.startsWith('https://')) {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  // HMR：dev 加载 Vite dev server，prod 加载打包后的 index.html
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ===== 单实例锁：必须在 app.whenReady 之前请求 =====
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // 第二个实例已在前台运行，当前实例直接退出
  app.quit()
} else {
  // Windows/Linux：第二个实例启动时聚焦已有窗口。
  // loopback 登录也依赖单实例锁（端口由首个实例独占，第二实例无法抢回调）。
  app.on('second-instance', () => {
    if (!mainWindow) createWindow()
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
  })

  app.whenReady().then(() => {
    initializeDiagnosticLogging(getMainWindow)

    // 初始化数据存储（建 ~/.ohmytoken/ 目录）
    initDataStorage()

    configureFloatingWindow({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererFile: join(__dirname, '../renderer/index.html'),
      rendererUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
      iconPath: getAppIconPath(),
      onVisibilityChanged: (visible) => {
        refreshTrayMenu()
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(IPC.FLOATING_WINDOW_VISIBILITY_CHANGED, visible)
          }
        }
      },
    })
    registerFloatingWindowIpc()

    configureTray({
      getMainWindow,
      getIconPath: getTrayIconPath,
      isFloatingWindowVisible,
      toggleFloatingWindow: () => {
        if (isFloatingWindowVisible()) closeFloatingWindow()
        else showFloatingWindow()
      },
      openWebsite: async () => {
        const runtimeConfig = await getDesktopRuntimeConfig()
        await shell.openExternal(runtimeConfig.websiteUrl)
      },
      requestQuit: () => app.quit(),
    })

    // 先创建窗口：registerIpcHandlers 通过 getter 动态获取主窗口引用
    createWindow()
    initializeTray()

    // 注册所有 IPC 处理器（M8：传 getter 而非静态引用，activate 重建窗口后无需重新 register）
    registerIpcHandlers(getMainWindow)

    void getAccessToken()
      .then((token) => ensureAgentClientRegistered(token))
      .catch((error) => {
        const backendUnavailable =
          (error instanceof TypeError && error.message === 'fetch failed') ||
          (error instanceof Error && error.name === 'AbortError')
        if (!backendUnavailable) {
          console.warn('[client-registration] 启动登记失败，等待后续请求重试:', error)
        }
      })

    // 初始化自动更新（M7+M8：传 getter，每次事件触发时动态获取最新窗口引用）
    initAutoUpdater(getMainWindow)

    // 用户上次退出时若保持悬浮窗开启，本次启动自动恢复。
    if (shouldRestoreFloatingWindow()) showFloatingWindow()

    // macOS：点 dock 图标时若无窗口则重建
    app.on('activate', () => {
      if (!mainWindow) {
        createWindow()
        return
      }
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    })
  })

  app.on('window-all-closed', () => {
    // macOS 应用通常不随窗口关闭退出，保留进程等待再次激活
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // 应用退出前停止 SSE 长连接（与 handlers.ts 内部的 before-quit 互为兜底，stop 幂等）
  app.on('before-quit', () => {
    recordDiagnosticEvent('app', 'before-quit', '应用准备退出')
    isQuitting = true
    destroyFloatingWindowForAppQuit()
    destroyTray()
    stopSseService()
    stopBackgroundScan()
  })
}
