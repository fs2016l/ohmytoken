import { app, BrowserWindow, Menu, nativeImage, Tray, type Event } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { CloseBehavior } from '../../shared/models'
import { IPC } from '../ipc/channels'

export type CloseDecision = Exclude<CloseBehavior, 'ask'> | 'cancel'
type AppLanguage = 'zh' | 'en'

interface TrayPreferences {
  closeBehavior: CloseBehavior
  language: AppLanguage
}

interface TrayConfiguration {
  getMainWindow: () => BrowserWindow | null
  getIconPath: () => string
  isFloatingWindowVisible: () => boolean
  toggleFloatingWindow: () => void
  openWebsite: () => Promise<void>
  requestQuit: () => void
}

const DEFAULT_PREFERENCES: TrayPreferences = { closeBehavior: 'ask', language: 'zh' }

let tray: Tray | null = null
let configuration: TrayConfiguration | null = null
let preferences: TrayPreferences | null = null
let closePromptPending = false

export function configureTray(options: TrayConfiguration): void {
  configuration = options
}

export function initializeTray(): void {
  if (tray || !configuration) return
  const iconPath = configuration.getIconPath()
  const image = nativeImage.createFromPath(iconPath)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.on('click', showMainWindow)
  tray.on('double-click', showMainWindow)
  rebuildTrayMenu()
}

export function handleMainWindowClose(event: Event, window: BrowserWindow): void {
  event.preventDefault()
  const behavior = loadPreferences().closeBehavior
  if (behavior === 'background') {
    window.hide()
    return
  }
  if (behavior === 'quit') {
    configuration?.requestQuit()
    return
  }
  if (closePromptPending) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    return
  }

  closePromptPending = true
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  window.webContents.send(IPC.TRAY_CLOSE_REQUESTED)
}

export function resolveMainWindowClose(decision: CloseDecision, remember: boolean): boolean {
  if (!['background', 'quit', 'cancel'].includes(decision)) return false
  if (!closePromptPending) return false
  closePromptPending = false
  if (decision === 'cancel') return true
  if (remember) updatePreferences({ closeBehavior: decision })
  if (decision === 'quit') {
    configuration?.requestQuit()
    return true
  }
  const window = configuration?.getMainWindow()
  if (window && !window.isDestroyed()) window.hide()
  return true
}

export function getCloseBehavior(): CloseBehavior {
  return loadPreferences().closeBehavior
}

export function setCloseBehavior(behavior: CloseBehavior): CloseBehavior {
  if (!['ask', 'background', 'quit'].includes(behavior)) {
    throw new TypeError('关闭行为必须是 ask、background 或 quit')
  }
  updatePreferences({ closeBehavior: behavior })
  return behavior
}

export function setTrayLanguage(language: string): void {
  if (language !== 'zh' && language !== 'en') return
  if (loadPreferences().language === language) return
  updatePreferences({ language })
}

export function destroyTray(): void {
  closePromptPending = false
  tray?.destroy()
  tray = null
}

function showMainWindow(): void {
  const window = configuration?.getMainWindow()
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function refreshTrayMenu(): void {
  rebuildTrayMenu()
}

function requestUpdateCheck(): void {
  showMainWindow()
  const window = configuration?.getMainWindow()
  if (!window || window.isDestroyed()) return
  const sendRequest = (): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC.TRAY_CHECK_UPDATE_REQUESTED)
  }
  if (window.webContents.isLoadingMainFrame()) {
    window.webContents.once('did-finish-load', sendRequest)
  } else {
    sendRequest()
  }
}

function toggleFloatingWindow(): void {
  configuration?.toggleFloatingWindow()
  rebuildTrayMenu()
}

async function openOfficialWebsite(): Promise<void> {
  try {
    await configuration?.openWebsite()
  } catch (error) {
    console.warn(`[tray] 打开官网失败: ${(error as Error).message}`)
  }
}

function rebuildTrayMenu(): void {
  if (!tray) return
  const current = loadPreferences()
  const zh = current.language === 'zh'
  const floatingWindowVisible = configuration?.isFloatingWindowVisible() === true
  tray.setToolTip(zh ? 'ohmytoken - Agent Token 用量' : 'ohmytoken - Agent Token Usage')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: zh ? '打开主窗口' : 'Open Main Window',
        click: showMainWindow,
      },
      { type: 'separator' },
      {
        label: floatingWindowVisible
          ? zh
            ? '关闭小窗'
            : 'Close Mini Window'
          : zh
            ? '显示小窗'
            : 'Show Mini Window',
        click: toggleFloatingWindow,
      },
      {
        label: zh ? '前往官网' : 'Visit Official Website',
        click: () => void openOfficialWebsite(),
      },
      {
        label: zh ? '检查更新' : 'Check for Updates',
        click: requestUpdateCheck,
      },
      { type: 'separator' },
      {
        label: zh ? '退出程序' : 'Quit',
        click: () => configuration?.requestQuit(),
      },
    ]),
  )
}

function preferencesFile(): string {
  return join(app.getPath('userData'), 'tray-preferences.json')
}

function loadPreferences(): TrayPreferences {
  if (preferences) return preferences
  const file = preferencesFile()
  if (!existsSync(file)) {
    preferences = { ...DEFAULT_PREFERENCES }
    return preferences
  }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as Partial<TrayPreferences>
    preferences = {
      closeBehavior:
        value.closeBehavior === 'ask' ||
        value.closeBehavior === 'background' ||
        value.closeBehavior === 'quit'
          ? value.closeBehavior
          : 'ask',
      language: value.language === 'en' ? 'en' : 'zh',
    }
  } catch {
    preferences = { ...DEFAULT_PREFERENCES }
  }
  return preferences
}

function updatePreferences(patch: Partial<TrayPreferences>): void {
  const previous = loadPreferences()
  preferences = { ...previous, ...patch }
  const file = preferencesFile()
  const temporaryFile = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temporaryFile, JSON.stringify(preferences, null, 2), 'utf8')
    renameSync(temporaryFile, file)
  } catch (error) {
    console.warn(`[tray] 保存偏好失败: ${(error as Error).message}`)
  }
  rebuildTrayMenu()
  if (patch.closeBehavior && patch.closeBehavior !== previous.closeBehavior) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC.TRAY_CLOSE_BEHAVIOR_CHANGED, preferences.closeBehavior)
      }
    }
  }
}
