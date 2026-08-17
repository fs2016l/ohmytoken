/**
 * Preload 暴露给 renderer 的 API 类型声明
 *
 * 让 renderer 中 `window.api.*` / `window.electron.*` 有完整类型提示。
 * 本文件被 tsconfig.web.json 的 include 或 renderer 的 env.d.ts 引用生效。
 *
 * 注意：返回类型用业务模型（Overview/DailyStats 等）而非 `any`，
 * 这样 renderer 侧 `await window.api.getOverview()` 直接得到强类型结果，
 * 不需要再手动断言。
 */
import type { ElectronAPI } from '@electron-toolkit/preload'
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
  AgentModelStats,
  CloseBehavior,
  Comparisons,
  DailyStats,
  HourlyUsageStats,
  ModelAgentStats,
  ModelStats,
  MonthlyStats,
  Overview,
  PageResult,
  ProjectUsageDetail,
  ProjectUsageOverview,
  ScanOptions,
  ScanResult,
  TokenUsageApiCall,
  TokenUsageSession,
  TokenUsageUserSession,
  TrackedProject,
  UsageTrendStats,
} from '../shared/models'
import type {
  TokenPlanCredentialInput,
  TokenPlanCredentialStatus,
  TokenPlanProviderId,
  TokenPlanUsageSnapshot,
} from '../shared/token-plan'
import type {
  CustomMessageData,
  CustomMessageEvent,
  CustomMessagePlacement,
  CustomMessageReceipt,
} from '../shared/custom-message'

/** 日期范围参数 */
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

/** autoUpdater 推送到 renderer 的事件 payload（与 updater.service.ts 转发的字段一致） */
export interface UpdaterEvent {
  /** 事件类型 */
  type:
    | 'checking-for-update'
    | 'update-available'
    | 'update-not-available'
    | 'download-progress'
    | 'update-downloaded'
    | 'error'
  /** update-available 时携带：新版本信息 */
  info?: { version: string; releaseDate?: string; releaseNotes?: string | null }
  /** download-progress 时携带：下载进度 */
  progress?: { percent: number; transferred: number; total: number; bytesPerSecond: number }
  /** update-downloaded 时携带：已下载完成的版本号 */
  version?: string
  /** error 时携带：错误消息 */
  message?: string
}

/**
 * renderer 通过 window.api 调用的业务 API
 * 方法签名与 preload/index.ts 暴露的对象一致，但这里给出强类型返回值
 */
export interface AppAPI {
  /** POST /api/scan — 执行一次扫描 */
  scanPerform(options?: ScanOptions): Promise<ScanResult>

  /** GET /api/stats/overview — 总览（grandTotal/agentTotals/今日本周本月用量） */
  getOverview(params?: RangeParams): Promise<Overview>

  /** GET /api/stats/daily — 每日统计（按 agent 分组） */
  getDailyStats(params?: RangeParams): Promise<DailyStats[]>

  /** GET /api/stats/model/daily — 每日统计（按 model 分组） */
  getDailyModelStats(params?: RangeParams): Promise<DailyStats[]>

  /** GET /api/stats/monthly — 每月统计（按 agent 分组） */
  getMonthlyStats(params?: RangeParams): Promise<MonthlyStats[]>

  /** GET /api/stats/model — 模型维度统计 */
  getModelStats(params?: RangeParams): Promise<ModelStats[]>

  /** GET /api/stats/agent/{agent} — 指定 agent 的 model 明细，按 totalTokens 降序 */
  getAgentModelStats(params: AgentRangeParams): Promise<AgentModelStats[]>

  /** GET /api/stats/model/agents — 指定 model 的 agent 明细，按 totalTokens 降序 */
  getModelAgentStats(params: ModelRangeParams): Promise<ModelAgentStats[]>

  /** GET /api/stats/comparisons — 环比对比（今日/本周/本月） */
  getComparisons(): Promise<Comparisons>

  /** GET /api/stats/sessions — 会话级 token 汇总 */
  getUsageSessions(params: UsageSessionsParams): Promise<TokenUsageSession[]>

  /** GET /api/stats/user-sessions — 用户级会话汇总，子会话位于 children 内 */
  getUserUsageSessions(params: UsageSessionsParams): Promise<PageResult<TokenUsageUserSession>>

  /** GET /api/stats/api-calls — 会话内 API / prompt 轮次 token 明细 */
  getUsageApiCalls(params: UsageApiCallsParams): Promise<TokenUsageApiCall[]>

  /** GET /api/stats/api-records — API / prompt 轮次通用明细 */
  getUsageApiRecords(params: UsageApiRecordsParams): Promise<PageResult<TokenUsageApiCall>>

  /** GET /api/stats/hourly — 小时级 token 统计 */
  getHourlyUsageStats(params: HourlyUsageParams): Promise<HourlyUsageStats[]>

  /** 分钟级 Token 趋势，供悬浮窗缩放到分钟粒度。 */
  getUsageTrendStats(params: UsageTrendParams): Promise<UsageTrendStats>

  projectsList(): Promise<TrackedProject[]>
  selectProjectDirectory(): Promise<string | null>
  saveProject(input: { name: string; path: string }): Promise<TrackedProject>
  updateProject(input: { projectId: string; name: string; path: string }): Promise<TrackedProject>
  removeProject(projectId: string): Promise<boolean>
  getProjectUsageOverview(params?: RangeParams): Promise<ProjectUsageOverview>
  getProjectUsageDetail(params: RangeParams & { projectId: string }): Promise<ProjectUsageDetail>

  tokenPlanCredentialsList(): Promise<TokenPlanCredentialStatus[]>
  tokenPlanCredentialSave(input: TokenPlanCredentialInput): Promise<TokenPlanCredentialStatus>
  tokenPlanCredentialRemove(providerId: TokenPlanProviderId): Promise<boolean>
  tokenPlanUsageQuery(providerId: TokenPlanProviderId): Promise<TokenPlanUsageSnapshot>
  tokenPlanUsageQueryAll(): Promise<TokenPlanUsageSnapshot[]>

  /** shell.openExternal — 在系统默认浏览器打开 URL */
  openExternal(url: string): Promise<void>

  /** 获取 ohmytokencom 后端 baseURL（供 renderer axios 配置） */
  getOhmytokenBase(): Promise<string>

  /** com 后台下发的公开 URL；不包含密钥或登录凭据。 */
  getRuntimeConfig(forceRefresh?: boolean): Promise<DesktopRuntimeConfig>

  /** 打开并聚焦 Token 会话悬浮窗 */
  showFloatingWindow(): Promise<void>

  /** 关闭 Token 会话悬浮窗 */
  closeFloatingWindow(): Promise<void>

  /** 查询 Token 会话悬浮窗是否可见 */
  isFloatingWindowVisible(): Promise<boolean>

  /** 订阅小窗显隐变化，保持主窗口按钮与托盘操作同步。 */
  onFloatingWindowVisibilityChanged(callback: (visible: boolean) => void): () => void

  /** 查询 Token 会话悬浮窗是否保持在所有窗口最前面 */
  isFloatingWindowAlwaysOnTop(): Promise<boolean>

  /** 设置 Token 会话悬浮窗是否保持在所有窗口最前面，并返回实际状态 */
  setFloatingWindowAlwaysOnTop(alwaysOnTop: boolean): Promise<boolean>

  /** 获取当前应用版本号（electron app.getVersion()，与 package.json 一致） */
  getVersion(): Promise<string>

  getDeviceId(): Promise<string>

  getAgentRequestIdentity(): Promise<AgentRequestIdentity>

  setAppLanguage(language: 'zh' | 'en'): Promise<void>

  /** 响应主窗口关闭请求，并选择进入后台、退出或取消。 */
  resolveTrayClose(input: {
    decision: 'background' | 'quit' | 'cancel'
    remember: boolean
  }): Promise<boolean>

  /** 读取或更新主进程持久化的统一关闭策略。 */
  getCloseBehavior(): Promise<CloseBehavior>
  setCloseBehavior(behavior: CloseBehavior): Promise<CloseBehavior>
  onCloseBehaviorChanged(callback: (behavior: CloseBehavior) => void): () => void

  /** 主进程请求 renderer 展示自定义关闭确认弹窗。 */
  onTrayCloseRequested(callback: () => void): () => void

  /** 用户从系统托盘触发检查更新。 */
  onTrayCheckUpdateRequested(callback: () => void): () => void

  /** 检查更新（向 com 后端 latest.yml 拉取并对比版本） */
  checkForUpdates(): Promise<{
    hasUpdate: boolean
    version?: string
    releaseDate?: string
    releaseNotes?: string | null
  }>

  /** 下载更新（autoDownload=false 时由用户手动触发） */
  downloadUpdate(): Promise<void>

  /** 退出应用并启动安装器（仅 Windows NSIS 有效） */
  installUpdate(): Promise<void>

  /**
   * 注册 updater 事件监听（检查/发现新版本/下载进度/下载完成/错误）。
   * 返回取消订阅函数，组件 onUnmounted 时必须调用以避免内存泄漏。
   */
  onUpdateEvent(callback: (event: UpdaterEvent) => void): () => void

  reportRendererError(payload: DiagnosticErrorPayload): void

  uploadDiagnosticReport(options?: DiagnosticUploadOptions): Promise<DiagnosticManualUploadResult>

  getDiagnosticUploadState(): Promise<DiagnosticUploadState>

  onDiagnosticUploadStateChanged(callback: (state: DiagnosticUploadState) => void): () => void

  openDiagnosticLogs(): Promise<void>

  authLogin(): Promise<AuthActionResult>
  authLogout(): Promise<AuthActionResult>
  authStatus(): Promise<boolean>
  authSession(): Promise<AuthSessionResult>
  submitDesktopFeedback(params: DesktopFeedbackSubmitParams): Promise<number>
  syncDesktopMessages(placement: CustomMessagePlacement): Promise<DesktopMessageSyncResult>
  reportDesktopMessageEvent(input: DesktopMessageEventInput): Promise<AuthActionResult>
  onAuthLoginSuccess(callback: () => void): () => void
  onAuthLogoutEvent(callback: () => void): () => void
  /**
   * 注册 SSE 服务端推送消息监听（新闻/套餐更新/版本更新/广播）。
   * 返回取消订阅函数，组件 onUnmounted 时必须调用以避免内存泄漏。
   */
  onSsePushMessage(callback: (message: PushMessage) => void): () => void

  customMessagesList(placement: CustomMessagePlacement): Promise<CustomMessageData[]>
  customMessagesCache(
    messages: CustomMessageData[],
    placement: CustomMessagePlacement,
  ): Promise<CustomMessageData[]>
  customMessagesReconcile(
    placement: CustomMessagePlacement,
    activeMessageUids: string[],
  ): Promise<void>
  customMessageReceiptQueue(
    messageId: number,
    messageUid: string,
    event: CustomMessageEvent,
    placement: CustomMessagePlacement,
  ): Promise<void>
  customMessageReceiptsPending(): Promise<CustomMessageReceipt[]>
  customMessageReceiptSent(id: number): Promise<void>
  customMessageReceiptFailed(id: number, error: string): Promise<void>

  // ===== 通知持久化 =====
  /** 查询通知列表（filter: 'all' 全部 | 'unread' 仅未读 | 'read' 仅已读） */
  notificationsList(filter?: 'all' | 'unread' | 'read'): Promise<NotificationItem[]>
  /** 标记单条通知为已读 */
  notificationsMarkRead(id: string): Promise<void>
  /** 标记所有未读通知为已读 */
  notificationsMarkAllRead(): Promise<void>
  /** 删除单条通知 */
  notificationsDelete(id: string): Promise<void>
}

/** 通知项（从 SQLite 读取，rawData 为原始推送 JSON，renderer 按当前语言格式化展示） */
export interface NotificationItem {
  id: string
  type: string
  read: boolean
  createdAt: number
  rawData: Record<string, unknown>
}

/** SSE 服务端推送消息类型 */
export interface PushMessage {
  type: 'news' | 'plan' | 'release' | 'broadcast' | 'notification' | 'custom' | 'connected'
  [key: string]: unknown
}

declare global {
  interface Window {
    /** 通用 Electron API（ipcRenderer / process / webFrame 等） */
    electron: ElectronAPI
    /** 业务 API（扫描 + 统计 + 应用） */
    api: AppAPI
  }
}

export {}
