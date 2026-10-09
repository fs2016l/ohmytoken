import { is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { IPC } from './ipc/channels'
import { registerIpcHandlers, stopAgentNetworkServices } from './ipc/handlers'
import { initDataStorage } from './services/data-storage.service'
import { mainWindowChromeOptions, registerWindowChromeIpc } from './services/window-chrome.service'
import { WINDOW_CHROME_ARGUMENT, WINDOW_CHROME_HEIGHT } from '../shared/window-chrome'
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
  refreshFloatingWindowMaterial,
  refreshFloatingWindowIcon,
  destroyFloatingWindowForAppQuit,
  isFloatingWindowVisible,
  registerFloatingWindowIpc,
  shouldRestoreFloatingWindow,
  showFloatingWindow,
} from './services/floating-window.service'
import { getDesktopRuntimeConfig } from './services/runtime-config.service'
import { installModelIconProtocol } from './services/model-icons.service'
import { stopBackgroundScan } from './services/scan.service'
import { initAutoUpdater } from './services/updater.service'
import { loadWindowState, saveWindowState, trackWindowState } from './services/window-state.service'
import { registerWindowNavigation } from './services/window-navigation'
import {
  registerDiscoveryScheme,
  installDiscoveryProtocol,
  isDiscoveryFrameUrl,
} from './services/discovery-ui.service'
import { blockDevtoolsShortcuts } from './lib/devtools-guard'
import { MAIN_WINDOW_RELEASE_CHECK, releaseHiddenWindow } from './services/idle-window'
import {
  attachWindowMaterial,
  getWindowMaterialPreferences,
  onWindowMaterialChanged,
  suspendFloatingWindowMaterial,
  windowMaterialOptions,
} from './services/window-material.service'
import {
  configureTray,
  destroyTray,
  handleMainWindowClose,
  initializeTray,
  refreshTrayIcon,
  refreshTrayMenu,
} from './services/tray.service'

// 统一应用名：影响 app.getPath('userData') → %APPDATA%\ohmytoken\
// 必须在任何 getPath / requestSingleInstanceLock 之前调用
app.setName('ohmytoken')
registerDiscoveryScheme()
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

function getThemedIconPath(iconFile: string): string | null {
  const { appearance, palette } = getWindowMaterialPreferences()
  const iconPalette = palette === 'copper' && appearance === 'light' ? 'classic' : palette
  const path = getBrandIconPath(join('icons', iconPalette, appearance, iconFile))
  return existsSync(path) ? path : null
}

function getAppIconPath(): string {
  // 任务栏/托盘图标跟随当前配色与明暗；缺主题资产时回退默认图标。
  const themed = getThemedIconPath(process.platform === 'win32' ? 'OhMyToken.ico' : 'Icon-256.png')
  if (themed) return themed
  return getBrandIconPath(process.platform === 'win32' ? 'app-icon.ico' : 'app-icon-256.png')
}

function getTrayIconPath(): string {
  return process.platform === 'darwin' ? getBrandIconPath('trayTemplate.png') : getAppIconPath()
}

let lastThemeIconKey = ''

function applyThemeIcons(): void {
  const { appearance, palette } = getWindowMaterialPreferences()
  const key = `${palette}/${appearance}`
  if (key === lastThemeIconKey) return
  lastThemeIconKey = key
  if (process.platform === 'win32') {
    mainWindow?.setIcon(getAppIconPath())
    refreshFloatingWindowIcon()
  }
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(getAppIconPath()))
  }
  refreshTrayIcon()
}

// 不调用 app.getPath，可在 ready 前注册，确保启动阶段主进程异常也会被观察到。
registerGlobalDiagnosticHandlers()

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let idleWindowReleased = false
let lastMainHash = ''

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
  idleWindowReleased = false
  const savedState = loadWindowState()

  mainWindow = new BrowserWindow({
    ...windowMaterialOptions('main'),
    ...mainWindowChromeOptions(),
    width: savedState.width,
    height: savedState.height,
    x: savedState.x,
    y: savedState.y,
    minWidth: savedState.minWidth,
    minHeight: savedState.minHeight,
    show: false,
    autoHideMenuBar: true,
    icon: getAppIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      additionalArguments: process.platform === 'win32' ? [WINDOW_CHROME_ARGUMENT] : [],
    },
  })

  // Measure the platform frame while hidden so the default content matches the Figma canvas.
  // Persisted bounds still describe the outer window; they must not grow on every launch.
  const outerBounds = mainWindow.getBounds()
  const contentBounds = mainWindow.getContentBounds()
  const framedState = loadWindowState({
    width: outerBounds.width - contentBounds.width,
    height:
      outerBounds.height -
      contentBounds.height +
      (process.platform === 'win32' ? WINDOW_CHROME_HEIGHT : 0),
  })
  mainWindow.setMinimumSize(framedState.minWidth, framedState.minHeight)
  mainWindow.setBounds({
    x: framedState.x,
    y: framedState.y,
    width: framedState.width,
    height: framedState.height,
  })

  // 上次是最大化状态则恢复最大化
  const createdWindow = mainWindow
  attachWindowMaterial(createdWindow, 'main')
  let cancelIdleRelease: (() => void) | undefined
  let releaseCheck: Promise<boolean> | undefined
  createdWindow.on('hide', () => {
    cancelIdleRelease?.()
    cancelIdleRelease = releaseHiddenWindow(
      createdWindow,
      async () => {
        if (isQuitting || createdWindow.webContents.isLoadingMainFrame()) return false
        releaseCheck ??= createdWindow.webContents
          .executeJavaScript(MAIN_WINDOW_RELEASE_CHECK)
          .then((allowed: unknown) => allowed === true)
          .finally(() => {
            releaseCheck = undefined
          })
        return releaseCheck
      },
      () => {
        saveWindowState(createdWindow)
        try {
          lastMainHash = new URL(createdWindow.webContents.getURL()).hash
        } catch {
          lastMainHash = ''
        }
        idleWindowReleased = true
        recordDiagnosticEvent('window', 'idle-release', '主窗口已进入后台休眠', {
          rendererPid: createdWindow.webContents.getOSProcessId(),
        })
      },
    )
  })
  createdWindow.on('show', () => cancelIdleRelease?.())
  createdWindow.on('closed', () => cancelIdleRelease?.())
  if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  // 关闭或释放隐藏窗口时保存用户尺寸。
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
    // 正常关闭主窗口结束应用；后台休眠释放窗口时保留托盘与主进程。
    if (process.platform !== 'darwin' && !isQuitting && !idleWindowReleased) app.quit()
  })

  // dev: F12 开关 DevTools；prod: 屏蔽 Ctrl+R / F5 刷新
  optimizer.watchWindowShortcuts(mainWindow)
  // prod 额外拦截 F12 / Ctrl+Shift+I|J|C 等 DevTools 入口（optimizer 不处理 F12）
  blockDevtoolsShortcuts(mainWindow)

  // 外部网页转系统浏览器，内部路由留在应用中，Electron 内不开新窗口。
  registerWindowNavigation(mainWindow.webContents, {
    isAllowedFrame: isDiscoveryFrameUrl,
    rendererUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
    openExternal: (url) => shell.openExternal(url),
  })

  // HMR：dev 加载 Vite dev server，prod 加载打包后的 index.html
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL)
    if (lastMainHash) url.hash = lastMainHash
    mainWindow.loadURL(url.toString())
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: lastMainHash })
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
    installDiscoveryProtocol()
    installModelIconProtocol()
    initializeDiagnosticLogging(getMainWindow)

    // 初始化数据存储（建 ~/.ohmytoken/ 目录）
    initDataStorage()

    configureFloatingWindow({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererFile: join(__dirname, '../renderer/index.html'),
      rendererUrl: is.dev ? process.env.ELECTRON_RENDERER_URL : undefined,
      getIconPath: getAppIconPath,
      getMainWindow,
      materialOptions: () => windowMaterialOptions('floating'),
      windowCreated: (window) => attachWindowMaterial(window, 'floating'),
      materialTransition: suspendFloatingWindowMaterial,
      openWorkspace: (path) => {
        lastMainHash = `#${path}`
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        if (mainWindow?.isMinimized()) mainWindow.restore()
        mainWindow?.show()
        mainWindow?.focus()
        mainWindow?.webContents.send(IPC.WORKSPACE_NAVIGATION_PENDING)
      },
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

    onWindowMaterialChanged(refreshFloatingWindowMaterial)
    onWindowMaterialChanged(applyThemeIcons)

    configureTray({
      getMainWindow,
      restoreMainWindow: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow()
        return mainWindow
      },
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
    applyThemeIcons()

    // 注册所有 IPC 处理器（M8：传 getter 而非静态引用，activate 重建窗口后无需重新 register）
    registerIpcHandlers(getMainWindow)
    registerWindowChromeIpc(getMainWindow)

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

    // 首次启动默认显示悬浮窗；之后沿用用户保存的开关状态。
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
    if (idleWindowReleased && !isQuitting) return
    // macOS 应用通常不随窗口关闭退出，保留进程等待再次激活
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // 应用退出前停止心跳及认证定时器（幂等）。
  app.on('before-quit', () => {
    recordDiagnosticEvent('app', 'before-quit', '应用准备退出')
    isQuitting = true
    destroyFloatingWindowForAppQuit()
    destroyTray()
    stopAgentNetworkServices()
    void stopBackgroundScan()
  })
}
