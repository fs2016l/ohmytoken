import type {
  AccountFavoriteTarget,
  AccountFavoritesState,
  AccountFavoriteResult,
} from '../shared/account-favorites'
import type {
  LocalFavoriteTarget,
  LocalFavoriteType,
  LocalFavoriteImport,
  LocalFavoritesState,
} from '../shared/local-favorites'
import { electronAPI } from '@electron-toolkit/preload'
import { replayAPI } from './replay-api'
import { discoveryUiAPI } from './discovery-ui-api'
import { thirdPartyNoticesAPI } from './third-party-notices-api'
import { scanRefreshAPI } from './scan-refresh-api'
import { networkMonitorAPI } from './network-monitor-api'
import { windowMaterialAPI } from './window-material-api'
import { windowChromeAPI } from './window-chrome-api'
import { floatingResizeAPI } from './floating-resize-api'
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc/channels'
import type { BrowsingSnapshot, BrowsingPageSnapshot } from '../shared/browsing-state'
import type { AgentRequestIdentityResult } from '../shared/agent-client'
import type {
  DesktopRuntimeConfig,
  DesktopApiKey,
  DesktopApiParameters,
} from '../shared/runtime-config'
import type {
  AuthActionResult,
  AuthSessionResult,
  DesktopFeedbackSubmitParams,
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
} from '../shared/custom-message'
import type {
  TokenPlanInventory,
  TokenPlanMonitorState,
  TokenPlanUsageSnapshot,
} from '../shared/token-plan'
import type { QuotaDetailQuery, QuotaDetails } from '../shared/quota-details'
import type { NetworkCheckSnapshot, NetworkMode, NetworkCheckTarget } from '../shared/network-check'
import type { ModelIconSnapshot } from '../shared/model-icons'

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

export type UsageSessionsParams = import('../shared/models').UsageDetailPageFilter

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
  baseline?: boolean
}

const api = {
  ...discoveryUiAPI,
  ...floatingResizeAPI,
  ...scanRefreshAPI,
  ...windowChromeAPI,
  ...windowMaterialAPI,
  ...replayAPI,
  ...thirdPartyNoticesAPI,
  ...networkMonitorAPI,
  getModelIconSnapshot: (): Promise<ModelIconSnapshot> =>
    ipcRenderer.invoke(IPC.MODEL_ICONS_SNAPSHOT) as Promise<ModelIconSnapshot>,
  ensureModelIcons: (modelIds: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.MODEL_ICONS_ENSURE, modelIds) as Promise<void>,
  onModelIconsChanged: (callback: (snapshot: ModelIconSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: ModelIconSnapshot): void => callback(snapshot)
    ipcRenderer.on(IPC.MODEL_ICONS_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.MODEL_ICONS_CHANGED, listener)
  },
  accountFavoritesList: (refresh = false): Promise<AccountFavoritesState> =>
    ipcRenderer.invoke(IPC.ACCOUNT_FAVORITES_LIST, refresh),
  accountFavoriteSet: (
    target: AccountFavoriteTarget,
    desired: boolean,
  ): Promise<AccountFavoriteResult> =>
    ipcRenderer.invoke(IPC.ACCOUNT_FAVORITES_SET, target, desired),
  onAccountFavoritesChanged: (callback: (state: AccountFavoritesState) => void): (() => void) => {
    const listener = (_event: unknown, state: AccountFavoritesState): void => callback(state)
    ipcRenderer.on(IPC.ACCOUNT_FAVORITES_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.ACCOUNT_FAVORITES_CHANGED, listener)
  },
  localFavoritesList: (): Promise<LocalFavoritesState> =>
    ipcRenderer.invoke(IPC.LOCAL_FAVORITES_LIST),
  localFavoriteSet: (
    target: LocalFavoriteTarget,
    favorite: boolean,
  ): Promise<LocalFavoritesState> => ipcRenderer.invoke(IPC.LOCAL_FAVORITES_SET, target, favorite),
  localFavoritesReorder: (
    type: LocalFavoriteType,
    order: LocalFavoriteTarget[],
  ): Promise<LocalFavoritesState> => ipcRenderer.invoke(IPC.LOCAL_FAVORITES_REORDER, type, order),
  localFavoritesMigrate: (entries: LocalFavoriteImport[]): Promise<LocalFavoritesState> =>
    ipcRenderer.invoke(IPC.LOCAL_FAVORITES_MIGRATE, entries),
  onLocalFavoritesChanged: (callback: (state: LocalFavoritesState) => void): (() => void) => {
    const listener = (_event: unknown, state: LocalFavoritesState): void => callback(state)
    ipcRenderer.on(IPC.LOCAL_FAVORITES_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.LOCAL_FAVORITES_CHANGED, listener)
  },
  readBrowsingState: (): Promise<BrowsingSnapshot> => ipcRenderer.invoke(IPC.BROWSING_READ),
  writeBrowsingState: (key: string, page: BrowsingPageSnapshot): Promise<void> =>
    ipcRenderer.invoke(IPC.BROWSING_WRITE, key, page),
  networkCheckStatus: (): Promise<NetworkCheckSnapshot> =>
    ipcRenderer.invoke(IPC.NETWORK_CHECK_STATUS),
  networkCheckStart: (
    mode: NetworkMode,
    target?: NetworkCheckTarget,
  ): Promise<NetworkCheckSnapshot> => ipcRenderer.invoke(IPC.NETWORK_CHECK_START, mode, target),
  networkCheckCancel: (): Promise<NetworkCheckSnapshot> =>
    ipcRenderer.invoke(IPC.NETWORK_CHECK_CANCEL),
  onNetworkCheckProgress: (callback: (snapshot: NetworkCheckSnapshot) => void): (() => void) => {
    const listener = (_event: unknown, snapshot: NetworkCheckSnapshot): void => callback(snapshot)
    ipcRenderer.on(IPC.NETWORK_CHECK_PROGRESS, listener)
    return () => {
      ipcRenderer.removeListener(IPC.NETWORK_CHECK_PROGRESS, listener)
    }
  },
  getUsageTurns: (
    params: RangeParams & { groupBy: 'agent' | 'model' },
  ): Promise<import('../shared/models').UsageTurnStats> =>
    ipcRenderer.invoke(IPC.STATS_TURNS, params),
  // ===== 扫描 =====
  scanPerform: (options?: ScanOptions): Promise<unknown> =>
    ipcRenderer.invoke(IPC.SCAN_PERFORM, options ?? {}),
  getScanProgress: (): Promise<import('../shared/scan-progress').ScanProgress | null> =>
    ipcRenderer.invoke(IPC.SCAN_STATUS),
  onScanProgress: (
    callback: (progress: import('../shared/scan-progress').ScanProgress) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: import('../shared/scan-progress').ScanProgress,
    ) => callback(progress)
    ipcRenderer.on(IPC.SCAN_PROGRESS, listener)
    return () => ipcRenderer.removeListener(IPC.SCAN_PROGRESS, listener)
  },

  // ===== 统计 =====
  getOverview: (params?: RangeParams): Promise<unknown> =>
    ipcRenderer.invoke(IPC.STATS_OVERVIEW, params ?? {}),
  getUsageAnalytics: (
    params?: import('../shared/analytics').UsageAnalyticsFilter,
  ): Promise<import('../shared/analytics').UsageAnalytics> =>
    ipcRenderer.invoke(IPC.STATS_ANALYTICS, params ?? {}),
  getUsageCostSummary: (
    params?: RangeParams,
  ): Promise<import('../shared/usage-cost').UsageCostSummary> =>
    ipcRenderer.invoke(IPC.STATS_COST, params ?? {}),
  getExchangeRates: (
    refresh = false,
  ): Promise<import('../shared/cost-currency').ExchangeRateState> =>
    ipcRenderer.invoke(IPC.COST_EXCHANGE_RATES, refresh),
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
  getSessionWorkspace: (
    params: import('../shared/models').SessionWorkspaceFilter,
  ): Promise<import('../shared/models').SessionWorkspacePage> =>
    ipcRenderer.invoke(IPC.STATS_SESSION_WORKSPACE, params),
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
  updateProjectNotes: (input: {
    projectId: string
    notes: string
    name?: string
  }): Promise<TrackedProject> => ipcRenderer.invoke(IPC.PROJECTS_NOTES, input),
  getProjectWorkspace: (
    params: import('../shared/models').SessionWorkspaceFilter,
  ): Promise<import('../shared/models').ProjectWorkspacePage> =>
    ipcRenderer.invoke(IPC.PROJECTS_WORKSPACE, params),
  getIgnoredProjects: (): Promise<TrackedProject[]> =>
    ipcRenderer.invoke(IPC.PROJECTS_IGNORED) as Promise<TrackedProject[]>,
  restoreProject: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.PROJECTS_RESTORE, projectId) as Promise<boolean>,
  getProjectUsageOverview: (params?: RangeParams): Promise<ProjectUsageOverview> =>
    ipcRenderer.invoke(IPC.PROJECTS_OVERVIEW, params ?? {}) as Promise<ProjectUsageOverview>,
  getProjectUsageDetail: (
    params: RangeParams & { projectId: string },
  ): Promise<ProjectUsageDetail> =>
    ipcRenderer.invoke(IPC.PROJECTS_DETAIL, params) as Promise<ProjectUsageDetail>,

  tokenPlanDiscover: (force?: boolean): Promise<TokenPlanInventory> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_DISCOVER, force) as Promise<TokenPlanInventory>,
  tokenPlanMonitorRead: (): Promise<TokenPlanMonitorState> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_MONITOR_READ),
  tokenPlanMonitorRefresh: (id?: string): Promise<TokenPlanMonitorState> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_MONITOR_REFRESH, id),
  tokenPlanMonitorSetInterval: (interval: number): Promise<TokenPlanMonitorState> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_MONITOR_INTERVAL, interval),
  tokenPlanMonitorSetActive: (active: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_MONITOR_ACTIVE, active),
  onTokenPlanMonitorChanged: (callback: (state: TokenPlanMonitorState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: TokenPlanMonitorState): void =>
      callback(state)
    ipcRenderer.on(IPC.TOKEN_PLAN_MONITOR_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.TOKEN_PLAN_MONITOR_CHANGED, listener)
  },
  tokenPlanUsageQuery: (id: string, force?: boolean): Promise<TokenPlanUsageSnapshot> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_USAGE_QUERY, id, force) as Promise<TokenPlanUsageSnapshot>,
  tokenPlanDetailsQuery: (id: string, query: QuotaDetailQuery): Promise<QuotaDetails> =>
    ipcRenderer.invoke(IPC.TOKEN_PLAN_DETAILS_QUERY, id, query) as Promise<QuotaDetails>,

  // ===== 应用 =====
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_OPEN_EXTERNAL, url) as Promise<void>,
  getOhmytokenBase: (): Promise<string> =>
    ipcRenderer.invoke(IPC.APP_GET_OHMYTOKEN_BASE) as Promise<string>,
  resolveApiUrl: (key: DesktopApiKey, parameters?: DesktopApiParameters): Promise<string> =>
    ipcRenderer.invoke(IPC.APP_RESOLVE_API_URL, key, parameters) as Promise<string>,
  getRuntimeConfig: (forceRefresh = false): Promise<DesktopRuntimeConfig> =>
    ipcRenderer.invoke(IPC.APP_GET_RUNTIME_CONFIG, forceRefresh) as Promise<DesktopRuntimeConfig>,
  /** 打开并聚焦 Token 会话悬浮窗 */
  showFloatingWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_SHOW) as Promise<void>,
  /** 关闭 Token 会话悬浮窗 */
  closeFloatingWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_CLOSE) as Promise<void>,
  resetFloatingWindowPreferences: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_RESET_PREFERENCES) as Promise<void>,
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
  getFloatingWindowEdge: () =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_EDGE_GET) as Promise<
      import('../shared/floating-window').FloatingEdgeState
    >,
  setFloatingWindowEdgeEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_EDGE_SET, enabled) as Promise<
      import('../shared/floating-window').FloatingEdgeState
    >,
  setFloatingWindowInteracting: (active: boolean) =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_EDGE_INTERACTION, active) as Promise<void>,
  revealFloatingWindowFromEdge: (): Promise<void> =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_EDGE_REVEAL),
  completeFloatingWindowEdgeMotion: (id: number) =>
    ipcRenderer.invoke(IPC.FLOATING_WINDOW_EDGE_MOTION_DONE, id) as Promise<void>,
  onFloatingWindowEdgeChanged: (
    callback: (state: import('../shared/floating-window').FloatingEdgeState) => void,
  ) => {
    const listener = (
      _event: unknown,
      state: import('../shared/floating-window').FloatingEdgeState,
    ): void => callback(state)
    ipcRenderer.on(IPC.FLOATING_WINDOW_EDGE_CHANGED, listener)
    return () => ipcRenderer.removeListener(IPC.FLOATING_WINDOW_EDGE_CHANGED, listener)
  },
  openFloatingWorkspace: (
    destination: import('../shared/floating-window').FloatingWorkspaceTarget,
  ) => ipcRenderer.invoke(IPC.FLOATING_WINDOW_OPEN_WORKSPACE, destination) as Promise<void>,
  takeWorkspaceNavigation: () =>
    ipcRenderer.invoke(IPC.WORKSPACE_NAVIGATION_TAKE) as Promise<string | null>,
  onWorkspaceNavigationPending: (callback: () => void) => {
    ipcRenderer.on(IPC.WORKSPACE_NAVIGATION_PENDING, callback)
    return () => ipcRenderer.removeListener(IPC.WORKSPACE_NAVIGATION_PENDING, callback)
  },

  // ===== 应用更新 =====
  /** 读取当前应用版本号（app.getVersion()） */
  getVersion: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_VERSION) as Promise<string>,
  getDeviceId: (): Promise<string> => ipcRenderer.invoke(IPC.APP_GET_DEVICE_ID) as Promise<string>,
  getAgentRequestIdentity: (): Promise<AgentRequestIdentityResult> =>
    ipcRenderer.invoke(IPC.APP_GET_REQUEST_IDENTITY) as Promise<AgentRequestIdentityResult>,
  refreshDeviceCredential: (): Promise<AgentRequestIdentityResult> =>
    ipcRenderer.invoke(IPC.APP_REFRESH_DEVICE_CREDENTIAL) as Promise<AgentRequestIdentityResult>,
  setAppLanguage: (language: 'zh' | 'en'): Promise<void> =>
    ipcRenderer.invoke(IPC.APP_SET_LANGUAGE, language) as Promise<void>,
  getInstallationLanguage: (): Promise<import('../shared/app-preferences').AppLanguage | null> =>
    ipcRenderer.invoke(IPC.APP_GET_INSTALLATION_LANGUAGE) as Promise<
      import('../shared/app-preferences').AppLanguage | null
    >,
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
  getUpdateState: (): Promise<import('../shared/updater').UpdateState> =>
    ipcRenderer.invoke(IPC.UPDATE_STATE),
  pauseUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_PAUSE),
  resumeUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATE_RESUME),
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
  onAnnouncementsChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC.ANNOUNCEMENTS_CHANGED, listener)
    return () => {
      ipcRenderer.removeListener(IPC.ANNOUNCEMENTS_CHANGED, listener)
    }
  },
  wakeAgentHeartbeat: (): Promise<void> =>
    ipcRenderer.invoke(IPC.AGENT_HEARTBEAT_WAKE) as Promise<void>,

  customMessagesList: (placement: CustomMessagePlacement): Promise<CustomMessageData[]> =>
    ipcRenderer.invoke(IPC.CUSTOM_MESSAGES_LIST, placement) as Promise<CustomMessageData[]>,
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

if (process.isMainFrame && process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (e) {
    // 极端情况（如反复加载）expose 会抛异常，降级直接挂到 window
    console.error('[preload] contextBridge.expose 失败，降级直挂 window:', e)
    exposeDirectly()
  }
} else if (process.isMainFrame) {
  exposeDirectly()
}
