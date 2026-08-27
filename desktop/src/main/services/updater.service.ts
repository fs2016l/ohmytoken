import { autoUpdater } from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
import { recordDiagnosticEvent, reportDiagnosticError } from './diagnostic-log.service'
import { getDesktopRuntimeConfig } from './runtime-config.service'

// 不自动下载：让用户在 SettingsPage UI 上手动触发
autoUpdater.autoDownload = false
// 禁止退出时自动静默安装；更新必须通过“重启并安装”显式启动可见的 NSIS 安装器。
autoUpdater.autoInstallOnAppQuit = false
// 非静默安装完成后自动启动新版本。
autoUpdater.autoRunAppAfterInstall = true

/**
 * electron-updater 默认 User-Agent 不包含宿主操作系统版本，com 下载统计只能根据
 * 安装包目标平台推断出 Windows/macOS，无法展示具体版本。这里使用后端现有
 * UserAgentOsParser 能识别的标准平台片段，无需为公开下载接口增加额外参数。
 */
function updaterUserAgent(): string {
  const systemVersion = process.getSystemVersion()
  const platform =
    process.platform === 'win32'
      ? `Windows NT ${systemVersion}; Win64; ${process.arch}`
      : process.platform === 'darwin'
        ? `Mac OS X ${systemVersion.replace(/\./g, '_')}; ${process.arch}`
        : `Linux ${systemVersion}; ${process.arch}`
  return `OhMyTokenAgent/${app.getVersion()} (${platform}) Electron/${process.versions.electron}`
}

function configureUpdaterRequestHeaders(): void {
  autoUpdater.requestHeaders = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'User-Agent': updaterUserAgent(),
  }
}

/** 推送到 renderer 的事件通道名（与 channels.ts 的 IPC.UPDATE_EVENT 保持一致） */
const IPC_CHANNEL_UPDATE_EVENT = 'updater:event'

/**
 * 主窗口 getter 函数（由 index.ts 注入）。
 *
 * 使用 getter 而非直接引用：macOS activate 会重建窗口，旧引用会指向已销毁的
 * webContents（"Object has been destroyed"）。getter 总是返回 index.ts 模块级
 * 的最新 mainWindow 引用，且天然处理了 'closed' 时 mainWindow 被置 null 的情况。
 */
type MainWindowGetter = () => BrowserWindow | null
let getMainWindow: MainWindowGetter = () => null
let updateStage = 'idle'
let lastProgressBucket = -1
let configuredFeedUrl = ''

async function configureUpdaterFeed(forceRefresh: boolean): Promise<void> {
  // 同一组 Header 会用于更新清单和安装包下载请求。
  configureUpdaterRequestHeaders()
  const config = await getDesktopRuntimeConfig(forceRefresh)
  if (configuredFeedUrl === config.updaterFeedUrl) return
  autoUpdater.setFeedURL({ provider: 'generic', url: config.updaterFeedUrl, channel: 'latest' })
  configuredFeedUrl = config.updaterFeedUrl
}

/**
 * 安全地向 renderer 推送 updater 事件。
 * 窗口未就绪（未创建/已关闭/已销毁）时静默跳过，避免抛 "Object has been destroyed"。
 */
function sendUpdateEvent(payload: unknown): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(IPC_CHANNEL_UPDATE_EVENT, payload)
}

/**
 * 在 app.whenReady 之后、createWindow 之后调用一次。
 * 注册 autoUpdater 事件监听，将所有事件转发到 renderer。
 *
 * @param windowGetter 主窗口 getter，每次事件触发时动态获取最新引用
 */
export function initAutoUpdater(windowGetter: MainWindowGetter): void {
  getMainWindow = windowGetter

  // 正在检查更新（用户触发 checkForUpdates 后立即触发）
  autoUpdater.on('checking-for-update', () => {
    updateStage = 'update-check'
    recordDiagnosticEvent('updater', 'checking', '开始检查更新')
    sendUpdateEvent({ type: 'checking-for-update' })
  })

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    recordDiagnosticEvent('updater', 'available', '发现新版本', {
      version: info.version,
      releaseDate: info.releaseDate,
    })
    sendUpdateEvent({
      type: 'update-available',
      info: {
        version: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: serializeReleaseNotes(info.releaseNotes),
      },
    })
  })

  // 已是最新版本
  autoUpdater.on('update-not-available', () => {
    recordDiagnosticEvent('updater', 'latest', '当前已是最新版本')
    updateStage = 'idle'
    sendUpdateEvent({ type: 'update-not-available' })
  })

  // 下载进度（autoDownload=false 时，仅在用户触发 downloadUpdate 后出现）
  autoUpdater.on('download-progress', (progress) => {
    updateStage = 'update-download'
    const bucket = Math.floor(progress.percent / 10)
    if (bucket !== lastProgressBucket) {
      lastProgressBucket = bucket
      recordDiagnosticEvent('updater', 'download-progress', '更新包下载进度', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      })
    }
    sendUpdateEvent({
      type: 'download-progress',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
    })
  })

  // 下载完成，可退出并安装
  autoUpdater.on('update-downloaded', (info) => {
    recordDiagnosticEvent('updater', 'downloaded', '更新包下载完成', { version: info.version })
    updateStage = 'update-ready'
    lastProgressBucket = -1
    sendUpdateEvent({
      type: 'update-downloaded',
      version: info.version,
    })
  })

  // 任何错误都转发到 renderer，UI 上显示 message 让用户感知
  autoUpdater.on('error', (err: Error | unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    reportDiagnosticError(
      {
        reportType: 'update',
        source: 'updater',
        stage: updateStage,
        severity: 'error',
        summary: updateStage === 'update-download' ? '更新包下载失败' : '自动更新失败',
        message,
        stack: err instanceof Error ? err.stack : undefined,
      },
      { autoUpload: true, persistPending: true },
    )
    sendUpdateEvent({ type: 'error', message })
  })
}

/** checkForUpdates 的返回结构 */
export interface UpdateCheckResult {
  /** 是否存在新版本 */
  hasUpdate: boolean
  /** 新版本号（hasUpdate=true 时有值） */
  version?: string
  /** 发布日期（ISO 字符串） */
  releaseDate?: string
  /** 更新日志，可能是字符串 / Markdown / HTML / null */
  releaseNotes?: string | null
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  updateStage = 'update-check'
  try {
    await configureUpdaterFeed(true)
    const result = await autoUpdater.checkForUpdates()
    if (!result || !result.updateInfo) {
      return { hasUpdate: false }
    }
    return {
      hasUpdate: true,
      version: result.updateInfo.version,
      releaseDate: result.updateInfo.releaseDate,
      // releaseNotes 可能是 string / ReleaseNoteInfo[] / null
      // 统一序列化为字符串，便于 renderer 直接展示
      releaseNotes: serializeReleaseNotes(result.updateInfo.releaseNotes),
    }
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportDiagnosticError(
      {
        reportType: 'update',
        source: 'updater',
        stage: 'update-check',
        severity: 'error',
        summary: '检查更新失败',
        message: normalized.message,
        stack: normalized.stack,
      },
      { autoUpload: true, persistPending: true },
    )
    throw error
  }
}

/**
 * 将 electron-updater 的 releaseNotes 序列化为字符串。
 * - string：原样返回
 * - ReleaseNoteInfo[]（多段笔记）：拼接为 "版本: 笔记" 多行
 * - null/undefined：返回 null
 */
function serializeReleaseNotes(notes: string | unknown[] | null | undefined): string | null {
  if (notes == null) return null
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'note' in item) {
          const obj = item as { version?: string; note?: string }
          return obj.version ? `${obj.version}: ${obj.note ?? ''}` : (obj.note ?? '')
        }
        return String(item)
      })
      .join('\n')
  }
  return String(notes)
}

/**
 * 下载更新（autoDownload=false 时由用户手动触发）。
 * 下载进度通过 'download-progress' 事件推送到 renderer。
 */
export async function downloadUpdate(): Promise<void> {
  updateStage = 'update-download'
  lastProgressBucket = -1
  recordDiagnosticEvent('updater', 'download-started', '用户开始下载更新包')
  try {
    // 安装包 CDN URL 使用短时鉴权。下载前重新拉取 latest.yml，拿到新的签名地址，
    // 避免用户在“发现更新”页面停留较久后点击下载得到过期链接。
    await configureUpdaterFeed(true)
    await autoUpdater.checkForUpdates()
    await autoUpdater.downloadUpdate()
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportDiagnosticError(
      {
        reportType: 'update',
        source: 'updater',
        stage: 'update-download',
        severity: 'error',
        summary: '更新包下载失败',
        message: normalized.message,
        stack: normalized.stack,
      },
      { autoUpload: true, persistPending: true },
    )
    throw error
  }
}

/**
 * 退出应用并启动安装器（仅 Windows NSIS 有效）。
 * isSilent=false 会显示 NSIS 安装界面和安装进度；安装完成后由
 * autoRunAppAfterInstall=true 自动启动新版本。
 * autoInstallOnAppQuit=false，避免用户正常关闭应用时仍走静默安装路径。
 */
export function quitAndInstall(): void {
  updateStage = 'update-install'
  recordDiagnosticEvent('updater', 'install-started', '用户确认重启并安装更新')
  try {
    autoUpdater.quitAndInstall(false, false)
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    reportDiagnosticError(
      {
        reportType: 'update',
        source: 'updater',
        stage: 'update-install',
        severity: 'error',
        summary: '启动更新安装程序失败',
        message: normalized.message,
        stack: normalized.stack,
      },
      { autoUpload: true, persistPending: true },
    )
    throw error
  }
}
