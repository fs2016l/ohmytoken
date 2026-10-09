import { autoUpdater, type UpdateInfo as ManifestInfo } from 'electron-updater'
import { app, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { recordDiagnosticEvent, reportDiagnosticError } from './diagnostic-log.service'
import { getDesktopRuntimeConfig } from './runtime-config.service'
import { ResumableUpdateDownload, validateUpdateAsset } from './resumable-update-download'
import { startUpdateInstallerBridge } from './update-installer-bridge'
import type { UpdateAsset, UpdateInfo, UpdateState } from '../../shared/updater'

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.autoRunAppAfterInstall = true

let getMainWindow: () => BrowserWindow | null = () => null
let state: UpdateState = { status: 'idle', info: null, progress: null, error: null }
let manager: ResumableUpdateDownload | null = null
let restorePromise: Promise<void> | null = null
let downloadOperation: Promise<void> | null = null
let checkOperation: Promise<UpdateCheckResult> | null = null
let configuredFeedUrl = ''
let initialized = false
let preparingInstaller = false
let operationAbort: AbortController | null = null

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

function publish(next: UpdateState): void {
  state = next
  const win = getMainWindow()
  if (win && !win.isDestroyed()) win.webContents.send('updater:event', { type: 'state', state })
}

function setStatus(status: UpdateState['status'], error: string | null = null): void {
  publish({ ...state, status, error })
}

function downloader(): ResumableUpdateDownload {
  // Electron paths and session are only evaluated after app.whenReady().
  manager ??= new ResumableUpdateDownload({
    directory: join(app.getPath('userData'), 'update-download'),
    fetch: (input, init) => autoUpdater.netSession.fetch(input, init),
    headers: { 'User-Agent': updaterUserAgent() },
    onState: publish,
  })
  return manager
}

async function restore(): Promise<void> {
  restorePromise ??= (async () => {
    const saved = await downloader().snapshot()
    if (saved.info && /^\d+\.\d+\.\d+$/.test(app.getVersion())) {
      const current = app.getVersion().split('.').map(Number)
      const pending = saved.info.version.split('.').map(Number)
      const difference =
        pending.map((part, index) => part - current[index]).find((part) => part !== 0) ?? 0
      if (difference <= 0) {
        await downloader().discard()
        return
      }
    }
    if (state.status === 'idle' && saved.status !== 'idle') publish(saved)
  })()
  await restorePromise
}

async function configureUpdaterFeed(): Promise<void> {
  const config = await getDesktopRuntimeConfig(true)
  autoUpdater.requestHeaders = {
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'User-Agent': updaterUserAgent(),
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: config.updaterFeedUrl, channel: 'latest' })
  configuredFeedUrl = config.updaterFeedUrl
}

function infoFromManifest(info: ManifestInfo): UpdateInfo {
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseNotes: serializeReleaseNotes(info.releaseNotes),
  }
}

function assetFromManifest(info: ManifestInfo): UpdateAsset {
  const arch =
    process.platform === 'darwin' && app.runningUnderARM64Translation ? 'arm64' : process.arch
  const extension = process.platform === 'win32' ? '.exe' : '.zip'
  const file = info.files.find((file) => {
    const name = new URL(file.url, configuredFeedUrl).pathname
    return name.endsWith(extension) && name.includes(`-${arch}`)
  })
  if (!file) throw new Error('No installer for this device / 没有适用于此设备的更新包')
  const url = new URL(file.url, configuredFeedUrl)
  const asset: UpdateAsset = {
    ...infoFromManifest(info),
    url: url.href,
    feedUrl: configuredFeedUrl,
    fileName: decodeURIComponent(url.pathname.split('/').at(-1) ?? ''),
    size: file.size ?? 0,
    sha512: file.sha512,
    platform: process.platform,
    arch,
  }
  validateUpdateAsset(asset)
  return asset
}

function reportFailure(error: unknown, stage: string): void {
  const message = error instanceof Error ? error.message : String(error)
  const sanitized = message.replace(/https?:\/\/[^\s"'<>]+/g, '[download URL]')
  setStatus('error', sanitized)
  reportDiagnosticError(
    {
      reportType: 'update',
      source: 'updater',
      stage,
      severity: 'error',
      summary: '自动更新失败',
      message: sanitized,
    },
    { autoUpload: true, persistPending: true },
  )
}

export function initAutoUpdater(windowGetter: () => BrowserWindow | null): void {
  getMainWindow = windowGetter
  if (initialized) return
  initialized = true
  // Operations below own error reporting exactly once.
  autoUpdater.on('error', () => {})
  autoUpdater.on('update-downloaded', (info) => {
    if (!preparingInstaller) return
    recordDiagnosticEvent('updater', 'downloaded', '更新包下载及校验完成', {
      version: info.version,
    })
    publish({ ...state, status: 'downloaded', info: infoFromManifest(info), error: null })
  })
  void restore().catch((error) => reportFailure(error, 'update-restore'))
  app.on('before-quit', () => {
    void pauseUpdate().catch(() => {})
  })
}

export async function getUpdateState(): Promise<UpdateState> {
  await restore()
  return structuredClone(state)
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  version?: string
  releaseDate?: string
  releaseNotes?: string | null
}

export function checkForUpdates(): Promise<UpdateCheckResult> {
  if (checkOperation) return checkOperation
  checkOperation = (async () => {
    await restore()
    if (downloadOperation || ['paused', 'downloaded'].includes(state.status)) {
      return { hasUpdate: !!state.info, ...state.info }
    }
    setStatus('checking')
    try {
      await configureUpdaterFeed()
      const result = await autoUpdater.checkForUpdates()
      if (!result?.isUpdateAvailable) {
        publish({ status: 'latest', info: null, progress: null, error: null })
        return { hasUpdate: false }
      }
      const info = infoFromManifest(result.updateInfo)
      publish({ status: 'available', info, progress: null, error: null })
      return { hasUpdate: true, ...info }
    } catch (error) {
      reportFailure(error, 'update-check')
      throw error
    }
  })().finally(() => {
    checkOperation = null
  })
  return checkOperation
}

function serializeReleaseNotes(notes: string | unknown[] | null | undefined): string | null {
  if (notes == null) return null
  if (typeof notes === 'string') return notes
  return notes
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'note' in item) {
        const note = item as { version?: string; note?: string }
        return note.version ? `${note.version}: ${note.note ?? ''}` : (note.note ?? '')
      }
      return String(item)
    })
    .join('\n')
}

export function downloadUpdate(): Promise<void> {
  if (downloadOperation) return downloadOperation
  operationAbort = new AbortController()
  const signal = operationAbort.signal
  downloadOperation = (async () => {
    await checkOperation
    await restore()
    if (state.status === 'downloaded') return
    try {
      let result: Awaited<ReturnType<typeof autoUpdater.checkForUpdates>> = null
      let attempt = 0
      while (!signal.aborted) {
        setStatus('checking')
        try {
          await configureUpdaterFeed()
          result = await autoUpdater.checkForUpdates()
          break
        } catch (error) {
          const cause = error as Error & { code?: string; statusCode?: number }
          const networkFailure =
            /net::ERR_|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(
              `${cause.code} ${cause.message}`,
            ) || [408, 429, 500, 502, 503, 504].includes(cause.statusCode ?? 0)
          if (!networkFailure) throw error
          setStatus('waiting-network')
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              clearTimeout(timer)
              signal.removeEventListener('abort', finish)
              resolve()
            }
            const timer = setTimeout(finish, [2000, 5000, 10000, 30000][Math.min(attempt++, 3)])
            signal.addEventListener('abort', finish, { once: true })
            if (signal.aborted) finish()
          })
        }
      }
      if (signal.aborted) {
        setStatus('paused')
        return
      }
      if (!result?.isUpdateAvailable) {
        await downloader().discard()
        publish({ status: 'latest', info: null, progress: null, error: null })
        return
      }
      const asset = assetFromManifest(result.updateInfo)
      recordDiagnosticEvent('updater', 'download-started', '开始或继续下载更新包', {
        version: asset.version,
      })
      const file = await downloader().download(asset)
      if (!file) return
      setStatus('verifying')
      const bridge = await startUpdateInstallerBridge(asset, file)
      const previousDifferential = autoUpdater.disableDifferentialDownload
      preparingInstaller = true
      try {
        autoUpdater.disableDifferentialDownload = true
        autoUpdater.setFeedURL({ provider: 'generic', url: bridge.feedUrl, channel: 'latest' })
        const local = await autoUpdater.checkForUpdates()
        if (!local?.isUpdateAvailable)
          throw new Error('Unable to prepare installer / 无法准备安装程序')
        await autoUpdater.downloadUpdate()
        if ((await getUpdateState()).status !== 'downloaded')
          throw new Error('Installer preparation incomplete / 安装程序准备未完成')
      } finally {
        preparingInstaller = false
        autoUpdater.disableDifferentialDownload = previousDifferential
        autoUpdater.setFeedURL({ provider: 'generic', url: configuredFeedUrl, channel: 'latest' })
        await bridge.close()
      }
    } catch (error) {
      reportFailure(error, 'update-download')
      throw new Error(state.error ?? 'Update failed')
    }
  })().finally(() => {
    downloadOperation = null
    operationAbort = null
  })
  return downloadOperation
}

export async function pauseUpdate(): Promise<void> {
  if (preparingInstaller) return
  operationAbort?.abort()
  await downloader().pause()
  await downloadOperation
}

export function resumeUpdate(): Promise<void> {
  return downloadUpdate()
}

export function quitAndInstall(): void {
  if (state.status !== 'downloaded') throw new Error('Update is not ready / 更新包尚未准备好')
  recordDiagnosticEvent('updater', 'install-started', '用户确认重启并安装更新')
  try {
    autoUpdater.quitAndInstall(false, false)
  } catch (error) {
    reportFailure(error, 'update-install')
    throw error
  }
}
