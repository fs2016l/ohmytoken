import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { ohmytokenApi } from '../api/http'

export type UpdateStatus =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'latest' | 'error'

export interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: string | null
}

export interface DownloadProgress {
  percent: number
  transferred: number
  total: number
}

export interface UseUpdaterOptions {
  /** getVersion() 失败时的兜底版本号 */
  versionFallback?: string
  /** 并发 guard：checking/downloading 时 check() 直接 return。默认 true */
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
 * `/desktop/client/update-check` 后端响应体。
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
    latestResetMs: options?.latestResetMs ?? defaultOptions.latestResetMs,
    errorResetMs: options?.errorResetMs ?? defaultOptions.errorResetMs,
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
    const res = await ohmytokenApi.get<ReleaseCheckResponse>('/desktop/client/update-check')
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
      await checkOnStartup()
    })()
    return initPromise
  }

  async function check(): Promise<void> {
    if (updaterOptions.guardConcurrent && ['checking', 'downloading'].includes(state.status.value))
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
   * 下载更新（IPC 链路，走 electron-updater）。
   *
   * 与 check() 是**两条独立链路**：check() 只查询不下载，download() 真正下载。
   * 内部先调 `checkForUpdates()`（让 electron-updater 拉 latest.yml 比对版本），
   * 再调 `downloadUpdate()` 开始下载。期间主进程会通过 IPC `updater:event` 推送
   * checking-for-update / update-available / update-not-available / download-progress /
   * update-downloaded / error 事件，由 `subscribeUpdaterEvents` 统一分发到 state。
   *
   * 若用户已是最新版本，主进程会发 update-not-available，subscribeUpdaterEvents
   * 检测到当前 status='downloading' 时重置为 'latest'（避免状态卡死）。
   */
  async function download(): Promise<void> {
    clearLatestResetTimer()
    clearErrorResetTimer()
    state.status.value = 'downloading'
    state.error.value = null
    state.progress.value = { percent: 0, transferred: 0, total: 0 }

    try {
      await window.api.checkForUpdates()
      await window.api.downloadUpdate()
    } catch (err) {
      state.status.value = 'error'
      state.error.value = getErrorMessage(err, '下载失败')
      state.progress.value = null
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
    install,
    init,
    dispose,
  }
}
