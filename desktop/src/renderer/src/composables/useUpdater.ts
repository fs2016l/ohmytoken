import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ohmytokenApi, cloudApiUrl } from '../api/http'
import type { UpdateStatus, UpdateInfo, DownloadProgress, UpdateState } from '@shared/updater'
export type { UpdateStatus, UpdateInfo, DownloadProgress } from '@shared/updater'

export interface UseUpdaterOptions {
  /** getVersion() 失败时的兜底版本号 */
  versionFallback?: string
  /** 检查或下载任务进行中、已暂停或待安装时，check() 直接 return。默认 true */
  guardConcurrent?: boolean
  /** latest → idle 自动复位毫秒数。null = 不复位。默认 5000 */
  latestResetMs?: number | null
  /** error → idle 自动复位毫秒数。null = 不复位（让 UI 决定）。默认 null */
  errorResetMs?: number | null
}

export interface UseUpdaterReturn {
  status: Ref<UpdateStatus>
  info: Ref<UpdateInfo | null>
  progress: Ref<DownloadProgress | null>
  error: Ref<string | null>
  currentVersion: Ref<string>
  percent: ComputedRef<number>
  check(): Promise<void>
  download(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  install(): void
  init(): Promise<void>
  dispose(): void
}

interface NormalizedUpdaterOptions {
  versionFallback: string
  guardConcurrent: boolean
  latestResetMs: number | null
  errorResetMs: number | null
}

/**
 * bootstrap 中 updateCheck 接口的后端响应体。
 *
 * 注意：字段名以 com 后端实际返回为准（不是 version/releaseDate/releaseNotes）：
 *   - `hasUpdate`     后端字段同名
 *   - `versionName`   后端字段同名（如 "1.2.0"），与 `versionCode`（数字）区分
 *   - `releaseAt`     后端字段同名（ISO 时间字符串）
 *   - `changelog`     后端字段同名（Markdown 字符串，可能为 null）
 *
 * 完整后端返回还含 `forceUpdate` / `versionCode` / `minSupportedVersionCode` / `asset?`，
 * 但本渲染端目前只消费上述 4 个字段（用于 UI 展示新版本信息）。
 */
interface ReleaseCheckResponse {
  data?: {
    hasUpdate?: boolean
    versionName?: string
    releaseAt?: string
    changelog?: string | null
  }
}

const defaultOptions: NormalizedUpdaterOptions = {
  versionFallback: '1.0.0',
  guardConcurrent: true,
  latestResetMs: 5000,
  errorResetMs: null,
}

let statusRef: Ref<UpdateStatus> | null = null
let infoRef: Ref<UpdateInfo | null> | null = null
let progressRef: Ref<DownloadProgress | null> | null = null
let errorRef: Ref<string | null> | null = null
let currentVersionRef: Ref<string> | null = null
let percentRef: ComputedRef<number> | null = null
let unsubscribeUpdater: (() => void) | null = null
let initPromise: Promise<void> | null = null
let latestResetTimer: ReturnType<typeof setTimeout> | null = null
let errorResetTimer: ReturnType<typeof setTimeout> | null = null
// 模块级缓存 latestResetMs，供 subscribeUpdaterEvents 的 update-not-available case 使用
// （check()/download() 是闭包可直接取 updaterOptions，但模块级订阅函数拿不到 options）
let latestResetMsValue: number | null = defaultOptions.latestResetMs
let stateEventCount = 0

function applySnapshot(snapshot: UpdateState): void {
  clearLatestResetTimer()
  clearErrorResetTimer()
  const current = getState()
  current.status.value = snapshot.status
  current.info.value = snapshot.info
  current.progress.value = snapshot.progress
  current.error.value = snapshot.error
}

function ensureState(): void {
  if (statusRef) return
  statusRef = ref<UpdateStatus>('idle')
  infoRef = ref<UpdateInfo | null>(null)
  progressRef = ref<DownloadProgress | null>(null)
  errorRef = ref<string | null>(null)
  currentVersionRef = ref('')
  percentRef = computed(() => progressRef?.value?.percent ?? 0)
}

function getState() {
  ensureState()
  return {
    status: statusRef as Ref<UpdateStatus>,
    info: infoRef as Ref<UpdateInfo | null>,
    progress: progressRef as Ref<DownloadProgress | null>,
    error: errorRef as Ref<string | null>,
    currentVersion: currentVersionRef as Ref<string>,
    percent: percentRef as ComputedRef<number>,
  }
}

function normalizeOptions(options?: UseUpdaterOptions): NormalizedUpdaterOptions {
  return {
    versionFallback: options?.versionFallback ?? defaultOptions.versionFallback,
    guardConcurrent: options?.guardConcurrent ?? defaultOptions.guardConcurrent,
    latestResetMs:
      options?.latestResetMs === undefined ? defaultOptions.latestResetMs : options.latestResetMs,
    errorResetMs:
      options?.errorResetMs === undefined ? defaultOptions.errorResetMs : options.errorResetMs,
  }
}

function clearLatestResetTimer(): void {
  if (latestResetTimer) {
    clearTimeout(latestResetTimer)
    latestResetTimer = null
  }
}

function clearErrorResetTimer(): void {
  if (errorResetTimer) {
    clearTimeout(errorResetTimer)
    errorResetTimer = null
  }
}

function scheduleLatestReset(ms: number | null): void {
  clearLatestResetTimer()
  if (ms === null) return
  latestResetTimer = setTimeout(() => {
    const { status } = getState()
    if (status.value === 'latest') status.value = 'idle'
    latestResetTimer = null
  }, ms)
}

function scheduleErrorReset(ms: number | null): void {
  clearErrorResetTimer()
  if (ms === null) return
  errorResetTimer = setTimeout(() => {
    const { status } = getState()
    if (status.value === 'error') status.value = 'idle'
    errorResetTimer = null
  }, ms)
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = String((err as { message?: unknown }).message ?? '')
    if (message) return message
  }
  return fallback
}

function subscribeUpdaterEvents(): void {
  if (unsubscribeUpdater) return
  unsubscribeUpdater = window.api.onUpdateEvent((event) => {
    const { status, info, progress, error } = getState()
    switch (event.type) {
      case 'state':
        if (event.state) {
          stateEventCount++
          applySnapshot(event.state)
        }
        break
      case 'checking-for-update':
        // 主进程正在检查更新；不覆盖 status，避免打断用户主动触发的 check()/download() 流程
        // （check() 自己已设 status='checking'，download() 设 'downloading'，此处保持现状即可）
        clearLatestResetTimer()
        clearErrorResetTimer()
        break
      case 'update-available':
        // 主进程发现新版本：把 event.info 写入 state.info（字段名与 UpdateInfo 一致）
        if (event.info) {
          info.value = {
            version: event.info.version,
            releaseDate: event.info.releaseDate,
            releaseNotes: event.info.releaseNotes ?? null,
          }
        }
        break
      case 'update-not-available':
        // 已是最新版本。download() 调 checkForUpdates 时，若已是最新主进程会发此事件，
        // 此时 status 卡在 'downloading' 需重置为 'latest'；其他场景忽略避免覆盖 check() 的结果
        if (status.value === 'downloading') {
          clearLatestResetTimer()
          clearErrorResetTimer()
          status.value = 'latest'
          progress.value = null
          scheduleLatestReset(latestResetMsValue)
        }
        break
      case 'download-progress':
        clearLatestResetTimer()
        clearErrorResetTimer()
        status.value = 'downloading'
        progress.value = {
          percent: event.progress?.percent ?? 0,
          transferred: event.progress?.transferred ?? 0,
          total: event.progress?.total ?? 0,
        }
        break
      case 'update-downloaded':
        clearLatestResetTimer()
        clearErrorResetTimer()
        status.value = 'downloaded'
        progress.value = null
        break
      case 'error':
        clearLatestResetTimer()
        clearErrorResetTimer()
        status.value = 'error'
        error.value = event.message ?? '更新失败'
        progress.value = null
        break
    }
  })
}

export function useUpdater(options?: UseUpdaterOptions): UseUpdaterReturn {
  const updaterOptions = normalizeOptions(options)
  const state = getState()
  // 同步 latestResetMs 到模块级缓存，供 subscribeUpdaterEvents 使用
  latestResetMsValue = updaterOptions.latestResetMs

  async function requestReleaseCheck(): Promise<ReleaseCheckResponse['data']> {
    const res = await ohmytokenApi.get<ReleaseCheckResponse>(await cloudApiUrl('updateCheck'))
    return res.data?.data
  }

  function applyAvailableUpdate(data: NonNullable<ReleaseCheckResponse['data']>): void {
    state.info.value = {
      version: data.versionName ?? '',
      releaseDate: data.releaseAt,
      releaseNotes: data.changelog,
    }
    state.status.value = 'available'
  }

  /**
   * 每个 renderer 进程启动后静默检查一次。
   *
   * initPromise 是模块级单例，AppLayout 与 SettingsPage 即使同时 init() 也只会发起
   * 一次请求。没有新版或 COM 暂时不可用时保持 idle，不打扰用户；只有发现新版才
   * 进入现有 available → downloading → downloaded → install 状态机。
   */
  async function checkOnStartup(): Promise<void> {
    try {
      const data = await requestReleaseCheck()
      if (data?.hasUpdate && state.status.value === 'idle') {
        applyAvailableUpdate(data)
      }
    } catch (err) {
      console.warn('[updater] 启动检查更新失败:', getErrorMessage(err, '检查更新失败'))
    }
  }

  async function init(): Promise<void> {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        state.currentVersion.value = await window.api.getVersion()
      } catch {
        state.currentVersion.value = updaterOptions.versionFallback
      }
      subscribeUpdaterEvents()
      if (window.api.getUpdateState) {
        const before = stateEventCount
        try {
          const snapshot = await window.api.getUpdateState()
          if (before === stateEventCount) applySnapshot(snapshot)
        } catch (err) {
          console.warn('[updater] 恢复下载状态失败:', getErrorMessage(err, '恢复失败'))
        }
      }
      await checkOnStartup()
    })()
    return initPromise
  }

  async function check(): Promise<void> {
    if (
      updaterOptions.guardConcurrent &&
      ['checking', 'downloading', 'paused', 'waiting-network', 'verifying', 'downloaded'].includes(
        state.status.value,
      )
    )
      return

    clearLatestResetTimer()
    clearErrorResetTimer()
    state.status.value = 'checking'
    state.error.value = null

    try {
      const data = await requestReleaseCheck()
      if (data?.hasUpdate) {
        applyAvailableUpdate(data)
      } else {
        state.status.value = 'latest'
        scheduleLatestReset(updaterOptions.latestResetMs)
      }
    } catch (err) {
      // 检查失败：清空旧版本信息，避免 UI 显示过期的新版本号
      state.info.value = null
      state.status.value = 'error'
      state.error.value = getErrorMessage(err, '检查更新失败')
      scheduleErrorReset(updaterOptions.errorResetMs)
    }
  }

  /**
   * 主进程检查更新清单后，从本地断点继续下载安装包，并通过 state 事件同步进度。
   * 文件大小与 SHA-512 验证通过后，再交给 electron-updater 校验签名和准备安装。
   * 暂停、断网等待、校验完成及已是最新版等状态均由主进程统一维护。
   */
  async function download(): Promise<void> {
    clearLatestResetTimer()
    clearErrorResetTimer()
    state.status.value = 'checking'
    state.error.value = null
    state.progress.value ??= { percent: 0, transferred: 0, total: 0 }

    try {
      await window.api.downloadUpdate()
    } catch (err) {
      state.status.value = 'error'
      state.error.value = getErrorMessage(err, '下载失败')
    }
  }

  async function pause(): Promise<void> {
    try {
      await window.api.pauseUpdate()
    } catch (err) {
      state.error.value = getErrorMessage(err, '暂停失败')
    }
  }

  async function resume(): Promise<void> {
    clearLatestResetTimer()
    clearErrorResetTimer()
    try {
      await window.api.resumeUpdate()
    } catch (err) {
      state.status.value = 'error'
      state.error.value = getErrorMessage(err, '继续下载失败')
    }
  }

  function install(): void {
    void window.api.installUpdate()
  }

  function dispose(): void {
    // 单例状态由 AppLayout 持有；路由组件卸载时不取消全局 updater 订阅。
  }

  return {
    ...state,
    check,
    download,
    pause,
    resume,
    install,
    init,
    dispose,
  }
}
