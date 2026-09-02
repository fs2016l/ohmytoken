import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { AgentRequestIdentity } from '../shared/agent-client'
import type { DesktopRuntimeConfig } from '../shared/runtime-config'
import type {
  AuthActionResult,
  AuthSessionResult,
  DesktopFeedbackSubmitParams,
  DesktopMessageEventInput,
  DesktopMessageSyncResult,
} from '../shared/desktop-api'
import type {
  DiagnosticErrorPayload,
  DiagnosticManualUploadResult,
  DiagnosticUploadOptions,
  DiagnosticUploadState,
} from '../shared/diagnostics'
import type {
  CloseBehavior,
  ProjectUsageDetail,
  ProjectUsageOverview,
  ScanOptions,
  TrackedProject,
} from '../shared/models'
import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
  CustomMessageReceipt,
} from '../shared/custom-message'
import type {
  TokenPlanCredentialInput,
  TokenPlanCredentialStatus,
  TokenPlanProviderId,
  TokenPlanUsageSnapshot,
} from '../shared/token-plan'

/** 日期范围参数（与主进程 RangeParams 对应） */
export interface RangeParams {
  from?: string
  to?: string
}

export interface PaginationParams {
  page?: number
  pageSize?: number
}

/** /stats/agent/{agent} 的参数 */
export interface AgentRangeParams extends RangeParams {
  agent: string
}

/** /stats/model/agents 的参数 */
export interface ModelRangeParams extends RangeParams {
  model: string
}

export interface UsageSessionsParams extends RangeParams, PaginationParams {
  agent?: string
  model?: string
  rootSessionId?: string
  projectId?: string
  trackedProjectsOnly?: boolean
  query?: string
}

export interface UsageApiCallsParams {
  agent: string
  sessionId: string
  model?: string
  rootSessionId?: string
  projectId?: string
  trackedProjectsOnly?: boolean
  from?: string
  to?: string
}

export interface UsageApiRecordsParams extends RangeParams, PaginationParams {
  agent?: string
  sessionId?: string
  rootSessionId?: string
  model?: string
  projectId?: string
  trackedProjectsOnly?: boolean
}

export interface HourlyUsageParams {
  date: string
  groupBy: 'agent' | 'model'
}
export interface UsageTrendParams {
  from: number
  to: number
  groupBy: 'agent' | 'model'
}

const api = {
  // ===== 扫描 =====
  scanPerform: (options?: ScanOptions): Promise<unknown> =>
    ipcRenderer.invoke(IPC.SCAN_PERFORM, options ?? {}),

  // ===== 统计 =====
  getOverview: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_OVERVIEW, params ?? {}),
  getDailyStats: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_DAILY, params ?? {}),
  getDailyModelStats: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_DAILY_MODEL, params ?? {}),
  getMonthlyStats: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_MONTHLY, params ?? {}),
  getModelStats: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_MODEL, params ?? {}),
  getAgentModelStats: (params: AgentRangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_AGENT, params),
  getModelAgentStats: (params: ModelRangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_MODEL_AGENTS, params),
  getComparisons: (): Promise<unknown> => ipcRenderer.invoke(IPC.STATS_COMPARISONS),
  getUsageSessions: (params: UsageSessionsParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_SESSIONS, params),
  getUserUsageSessions: (params: UsageSessionsParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_USER_SESSIONS, params),
  getUsageApiCalls: (params: UsageApiCallsParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_API_CALLS, params),
  getUsageApiRecords: (params: UsageApiRecordsParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_API_RECORDS, params),
  getHourlyUsageStats: (params: HourlyUsageParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_HOURLY, params),
  getUsageTrendStats: (params: UsageTrendParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_USAGE_TREND, params),

  projectsList: (): Promise<TrackedProject[]> =>
    ipcRenderer.invoke(IPC.PROJECTS_LIST) as Promise<TrackedProject[]>,
  selectProjectDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.PROJECTS_SELECT_DIRECTORY) as Promise<string | null>,
  saveProject: (input: { name: string; path: string }): Promise<TrackedProject> =>
    ipcRenderer.invoke(IPC.PROJECTS_SAVE, input) as Promise<TrackedProject>,
  updateProject: (input: {
    projectId: string
    name: string
    path: string
  }): Promise<TrackedProject> =>
    ipcRenderer.invoke(IPC.PROJECTS_UPDATE, input) as Promise<TrackedProject>,
  removeProject: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PROJECTS_REMOVE, projectId) as Promise<boolean>,
  getProjectUsageOverview: (params?: RangeParams): Promise<ProjectUsageOverview> =>
    ipcRenderer.invoke(IPC.PROJECTS_OVERVIEW, params ?? {}) as Promise<ProjectUsageOverview>,
  getProjectUsageDetail: (
    params: RangeParams & { projectId: string },
  ): Promise<ProjectUsageDetail> =>
    ipcRenderer.invoke(IPC.PROJECTS_DETAIL, params) as Promise<ProjectUsageDetail>,

  tokenPlanCredentialsList: (): Promise<TokenPlanCredentialStatus[]> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_CREDENTIALS_LIST) as Promise<TokenPlanCredentialStatus[]>,
  tokenPlanCredentialSave: (input: TokenPlanCredentialInput): Promise<TokenPlanCredentialStatus> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_CREDENTIAL_SAVE, input) as Promise<TokenPlanCredentialStatus>,
  tokenPlanCredentialRemove: (providerId: TokenPlanProviderId): Promise<boolean> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_CREDENTIAL_REMOVE, providerId) as Promise<boolean>,
  tokenPlanUsageQuery: (providerId: TokenPlanProviderId): Promise<TokenPlanUsageSnapshot> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_USAGE_QUERY, providerId) as Promise<TokenPlanUsageSnapshot>,
  tokenPlanUsageQueryAll: (): Promise<TokenPlanUsageSnapshot[]> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_USAGE_QUERY_ALL) as Promise<TokenPlanUsageSnapshot[]>,

  // ===== 应用 =====
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url) as Promise<void>,
  getOhmytokenBase: (): Promise<string> =>
    ipcRenderer.invoke(IPC.APP_GET_OHMYTOKEN_BASE) as Promise<string>,
  getRuntimeConfig: (forceRefresh = false): Promise<DesktopRuntimeConfig> =>
    ipcRenderer.invoke(IPC.APP_GET_RUNTIME_CONFIG, forceRefresh) as Promise<DesktopRuntimeConfig>,
  /** 打开并聚焦 Token 会话悬浮窗 */
  showFloatingWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_SHOW) as Promise<void>,
  /** 关闭 Token 会话悬浮窗 */
  closeFloatingWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_CLOSE) as Promise<void>,
  /** 查询 Token 会话悬浮窗是否可见 */
  isFloatingWindowVisible: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_IS_VISIBLE) as Promise<boolean>,
  onFloatingWindowVisibilityChanged: (callback: (visible: boolean) => void): (() => void) => {
    const listener = (_event: unknown, visible: boolean): void => callback(visible)
    ipcRenderer.on(IPC.FLOATING_WINDOW_VISIBILITY_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.FLOATING_WINDOW_VISIBILITY_CHANGED, listener)
    }
  },
  /** 查询 Token 会话悬浮窗是否保持在所有窗口最前面 */
  isFloatingWindowAlwaysOnTop: (): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_GET_ALWAYS_ON_TOP) as Promise<boolean>,
  /** 设置 Token 会话悬浮窗是否保持在所有窗口最前面 */
  setFloatingWindowAlwaysOnTop: (alwaysOnTop: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_SET_ALWAYS_ON_TOP, alwaysOnTop) as Promise<boolean>,

  // ===== 应用更新 =====
  /** 读取当前应用版本号（app.getVersion()） */
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION) as Promise<string>,
  getDeviceId: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_DEVICE_ID) as Promise<string>,
  getAgentRequestIdentity: (): Promise<AgentRequestIdentity> =>
    ipcRenderer.invoke(IPC.APP_GET_REQUEST_IDENTITY) as Promise<AgentRequestIdentity>,
  setAppLanguage: (language: 'zh' | 'en'): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_SET_LANGUAGE, language) as Promise<void>,
  resolveTrayClose: (input: {
    decision: 'background' | 'quit' | 'cancel'
    remember: boolean
  }): Promise<boolean> => ipcRenderer.invoke(IPC.TRAY_RESOLVE_CLOSE, input) as Promise<boolean>,
  getCloseBehavior: (): Promise<CloseBehavior> =>
    ipcRenderer.invoke(IPC.TRAY_GET_CLOSE_BEHAVIOR) as Promise<CloseBehavior>,
  setCloseBehavior: (behavior: CloseBehavior): Promise<CloseBehavior> =>
    ipcRenderer.invoke(IPC.TRAY_SET_CLOSE_BEHAVIOR, behavior) as Promise<CloseBehavior>,
  onCloseBehaviorChanged: (callback: (behavior: CloseBehavior) => void): (() => void) => {
    const listener = (_event: unknown, behavior: CloseBehavior): void => callback(behavior)
    ipcRenderer.on(IPC.TRAY_CLOSE_BEHAVIOR_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.TRAY_CLOSE_BEHAVIOR_CHANGED, listener)
    }
  },
  onTrayCloseRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.TRAY_CLOSE_REQUESTED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.TRAY_CLOSE_REQUESTED, listener)
    }
  },
  onTrayCheckUpdateRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.TRAY_CHECK_UPDATE_REQUESTED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.TRAY_CHECK_UPDATE_REQUESTED, listener)
    }
  },
  /** 检查更新（向 com 后端 latest.yml 拉取并对比版本） */
  checkForUpdates: (): Promise<{
    hasUpdate: boolean
    version?: string
    releaseDate?: string
    releaseNotes?: string | null
  }> =>
    ipcRenderer.invoke(IPC.UPDATE_CHECK) as Promise<{
      hasUpdate: boolean
      version?: string
      releaseDate?: string
      releaseNotes?: string | null
    }>,
  /** 下载更新（autoDownload=false 时由用户手动触发） */
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_DOWNLOAD) as Promise<void>,
  /** 退出应用并启动安装器 */
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_INSTALL) as Promise<void>,
  /**
   * 注册 updater 事件监听（检查/发现新版本/下载进度/下载完成/错误）。
   * 返回取消订阅函数，组件 onUnmounted 时必须调用以避免内存泄漏。
   */
  onUpdateEvent: (
    callback: (event: { type: string; [key: string]: unknown }) => void,
  ): (() => void) => {
    const listener = (_e: unknown, payload: { type: string; [key: string]: unknown }): void => {
      callback(payload)
    }
    ipcRenderer.on(IPC.UPDATE_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC.UPDATE_EVENT, listener)
    }
  },

  reportRendererError: (payload: DiagnosticErrorPayload): void => {
    ipcRenderer.send(IPC.DIAGNOSTICS_RENDERER_ERROR, payload)
  },
  uploadDiagnosticReport: (
    options?: DiagnosticUploadOptions,
  ): Promise<DiagnosticManualUploadResult> =>
    ipcRenderer.invoke(
      IPC.DIAGNOSTICS_UPLOAD,
      options ?? {},
    ) as Promise<DiagnosticManualUploadResult>,
  getDiagnosticUploadState: (): Promise<DiagnosticUploadState> =>
    ipcRenderer.invoke(IPC.DIAGNOSTICS_UPLOAD_STATE) as Promise<DiagnosticUploadState>,
  onDiagnosticUploadStateChanged: (
    callback: (state: DiagnosticUploadState) => void,
  ): (() => void) => {
    const listener = (_event: unknown, state: DiagnosticUploadState): void => callback(state)
    ipcRenderer.on(IPC.DIAGNOSTICS_UPLOAD_STATE_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.DIAGNOSTICS_UPLOAD_STATE_CHANGED, listener)
    }
  },
  openDiagnosticLogs: (): Promise<void> =>
    ipcRenderer.invoke(IPC.DIAGNOSTICS_OPEN_LOGS) as Promise<void>,

  authLogin: (language: 'zh' | 'en'): Promise<AuthActionResult> =>
    ipcRenderer.invoke(IPC.AUTH_LOGIN, language) as Promise<AuthActionResult>,
  authLogout: (): Promise<AuthActionResult> =>
    ipcRenderer.invoke(IPC.AUTH_LOGOUT) as Promise<AuthActionResult>,
  authStatus: (): Promise<boolean> => ipcRenderer.invoke(IPC.AUTH_STATUS) as Promise<boolean>,
  authSession: (): Promise<AuthSessionResult> =>
    ipcRenderer.invoke(IPC.AUTH_SESSION) as Promise<AuthSessionResult>,
  submitDesktopFeedback: (params: DesktopFeedbackSubmitParams): Promise<number> =>
    ipcRenderer.invoke(IPC.DESKTOP_FEEDBACK_SUBMIT, params) as Promise<number>,
  syncDesktopMessages: (placement: CustomMessagePlacement): Promise<DesktopMessageSyncResult> =>
    ipcRenderer.invoke(IPC.DESKTOP_MESSAGE_SYNC, placement) as Promise<DesktopMessageSyncResult>,
  reportDesktopMessageEvent: (input: DesktopMessageEventInput): Promise<AuthActionResult> =>
    ipcRenderer.invoke(IPC.DESKTOP_MESSAGE_EVENT, input) as Promise<AuthActionResult>,
  onAuthLoginSuccess: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.AUTH_LOGIN_SUCCESS, listener)
    return () => {
      ipcRenderer.removeListener(IPC.AUTH_LOGIN_SUCCESS, listener)
    }
  },
  onAuthLogoutEvent: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.AUTH_LOGOUT_EVENT, listener)
    return () => {
      ipcRenderer.removeListener(IPC.AUTH_LOGOUT_EVENT, listener)
    }
  },
  /**
   * 注册 SSE 服务端推送消息监听（新闻/套餐更新/版本更新/广播）。
   * 返回取消订阅函数，组件 onUnmounted 时必须调用以避免内存泄漏。
   */
  onSsePushMessage: (callback: (message: Record<string, unknown>) => void): (() => void) => {
    const listener = (_e: unknown, message: Record<string, unknown>): void => callback(message)
    ipcRenderer.on(IPC.SSE_PUSH_MESSAGE, listener)
    return () => {
      ipcRenderer.removeListener(IPC.SSE_PUSH_MESSAGE, listener)
    }
  },

  customMessagesList: (placement: CustomMessagePlacement): Promise<CustomMessageData[]> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGES_LIST, placement) as Promise<CustomMessageData[]>,
  customMessagesCache: (
    messages: CustomMessageData[],
    placement: CustomMessagePlacement,
  ): Promise<CustomMessageData[]> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGES_CACHE, messages, placement) as Promise<
      CustomMessageData[]
    >,
  customMessagesReconcile: (
    placement: CustomMessagePlacement,
    activeMessageUids: string[],
  ): Promise<void> =>
    ipcRenderer.invoke(
      IPC.CUSTOM_MESSAGES_RECONCILE,
      placement,
      activeMessageUids,
    ) as Promise<void>,
  customMessageReceiptQueue: (
    messageId: number,
    messageUid: string,
    event: CustomMessageEvent,
    placement: CustomMessagePlacement,
  ): Promise<void> =>
    ipcRenderer.invoke(
      IPC.CUSTOM_MESSAGE_RECEIPT_QUEUE,
      messageId,
      messageUid,
      event,
      placement,
    ) as Promise<void>,
  customMessageReceiptsPending: (): Promise<CustomMessageReceipt[]> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGE_RECEIPTS_PENDING) as Promise<CustomMessageReceipt[]>,
  customMessageReceiptSent: (id: number): Promise<void> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGE_RECEIPT_SENT, id) as Promise<void>,
  customMessageReceiptFailed: (id: number, error: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGE_RECEIPT_FAILED, id, error) as Promise<void>,

  // ===== 通知持久化（notifications 表） =====
  /** 查询通知列表（filter: 'all' 全部 | 'unread' 仅未读 | 'read' 仅已读），返回含 raw_data 的通知项 */
  notificationsList: (
    filter?: 'all' | 'unread' | 'read',
  ): Promise<
    {
      id: string
      type: string
      read: boolean
      createdAt: number
      rawData: Record<string, unknown>
    }[]
  > =>
    ipcRenderer.invoke(IPC.NOTIFICATIONS_LIST, filter) as Promise<
      {
        id: string
        type: string
        read: boolean
        createdAt: number
        rawData: Record<string, unknown>
      }[]
    >,
  /** 标记单条通知为已读 */
  notificationsMarkRead: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NOTIFICATIONS_MARK_READ, id) as Promise<void>,
  /** 标记所有未读通知为已读 */
  notificationsMarkAllRead: (): Promise<void> =>
    ipcRenderer.invoke(IPC.NOTIFICATIONS_MARK_ALL_READ) as Promise<void>,
  /** 删除单条通知 */
  notificationsDelete: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NOTIFICATIONS_DELETE, id) as Promise<void>,
}

type DirectExposeTarget = typeof globalThis & {
  electron: typeof electronAPI
  api: typeof api
}

function exposeDirectly(): void {
  const target = globalThis as DirectExposeTarget
  target.electron = electronAPI
  target.api = api
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    // 极端情况（如反复加载）expose 会抛异常，降级直接挂到 window
    console.error('[preload] contextBridge.expose 失败，降级直挂 window:', e)
    exposeDirectly()
  }
} else {
  exposeDirectly()
}
