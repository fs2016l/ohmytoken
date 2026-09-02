/**
 * IPC 处理器注册（对应 Java ApiController 的路由层）
 *
 * 每个 ipcMain.handle 对应原 REST 端点，调用对应 service 方法。
 * 通过 registerIpcHandlers() 在 app.whenReady 之后统一注册。
 *
 * 默认参数与 Java ApiController 的 @RequestParam(defaultValue=...) 完全一致：
 *   - daily / dailyModel / model：from=2020-01-01, to=2099-12-31
 *   - monthly：from=2020-01, to=2099-12（注意是 7 位 yyyy-MM）
 *   - overview / agent / modelAgents：from/to 可选（null 表示不限）
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
} from 'electron'
import type { CloseBehavior, ScanOptions } from '../../shared/models'
import type { TokenPlanCredentialInput, TokenPlanProviderId } from '../../shared/token-plan'
import type { DiagnosticErrorPayload, DiagnosticUploadOptions } from '../../shared/diagnostics'
import type { CustomMessageEvent, CustomMessagePlacement } from '../../shared/custom-message'
import type {
  DesktopFeedbackSubmitParams,
  DesktopMessageEventInput,
} from '../../shared/desktop-api'
import { IPC } from './channels'
import {
  forceRefreshAccessToken,
  getAccessToken,
  hasAuthSession,
  initializeAuthSessionManager,
  revokeAndClearAuthSession,
  setOnLoginSuccessCallback,
  setOnSessionInvalidatedCallback,
  setOnTokenRefreshedCallback,
  shutdownAuthSessionManager,
  startPkceLogin,
} from '../services/auth.service'
import { getDeviceId } from '../services/device-id.service'
import { ensureAgentClientRegistered } from '../services/client-registration.service'
import { getOhmytokenApiBase } from '../services/server-config.service'
import { getDesktopRuntimeConfig } from '../services/runtime-config.service'
import {
  getDiagnosticUploadState,
  confirmAndUploadDiagnosticReport,
  openDiagnosticLogs,
  reportDiagnosticError,
} from '../services/diagnostic-log.service'
import {
  getAuthSession,
  reportDesktopMessageEvent,
  submitDesktopFeedback,
  syncDesktopMessages,
} from '../services/desktop-api.service'
import { performScan } from '../services/scan.service'
import { SseService } from '../services/sse.service'
import {
  getAgentModelStats,
  getComparisons,
  getDailyModelStats,
  getDailyStats,
  getHourlyUsageStats,
  getUsageTrendStats,
  getModelAgentStats,
  getModelStats,
  getMonthlyStats,
  getOverview,
  getUsageApiRecordsPage,
  getUsageApiCalls,
  getUsageSessions,
  getUserUsageSessionsPage,
} from '../services/stats.service'
import { checkForUpdates, downloadUpdate, quitAndInstall } from '../services/updater.service'
import {
  getProjectUsageDetail,
  getProjectUsageOverview,
  listTrackedProjects,
  removeTrackedProject,
  saveTrackedProject,
  updateTrackedProject,
} from '../services/project.service'
import {
  getCloseBehavior,
  resolveMainWindowClose,
  setCloseBehavior,
  setTrayLanguage,
  type CloseDecision,
} from '../services/tray.service'
import {
  listTokenPlanCredentials,
  queryAllTokenPlanUsage,
  queryTokenPlanUsage,
  removeTokenPlanCredential,
  saveTokenPlanCredential,
} from '../services/token-plan.service'
import {
  deleteNotification,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notification-storage.service'
import {
  applyCustomSseMessage,
  cacheCustomMessages,
  listCachedCustomMessages,
  listPendingCustomMessageReceipts,
  markCustomMessageReceiptFailed,
  markCustomMessageReceiptSent,
  queueCustomMessageReceipt,
  reconcileCustomMessages,
} from '../services/custom-message-storage.service'

/**
 * ohmytokencom 后端默认地址
 * 正式构建只内置这一个公开 API Base；也可用 OHMYTOKEN_API_BASE 做私有部署覆盖。
 * 其他业务 URL 由 com /desktop/bootstrap 动态下发。
 */
const DEFAULT_OHMYTOKEN_BASE = getOhmytokenApiBase()

/** 通用：可选日期范围参数（对应 axios config.params 的 shape） */
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

/** 主窗口 getter 类型：每次调用动态返回当前主窗口引用（可能为 null） */
type MainWindowGetter = () => BrowserWindow | null

let sseService: SseService | null = null

function wrapHandler<TArgs extends unknown[], TResult>(
  fn: (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> | TResult,
): (event: IpcMainInvokeEvent, ...args: TArgs) => Promise<TResult> {
  return async (event, ...args) => {
    try {
      return await fn(event, ...args)
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      reportDiagnosticError(
        {
          reportType: 'ipc',
          source: 'ipc',
          stage: 'handler',
          severity: 'error',
          summary: 'IPC 操作执行失败',
          message: error.message,
          stack: error.stack,
        },
        { autoUpload: false, persistPending: false },
      )
      console.error('[ipc] handler 执行失败:', e)
      throw new Error('操作失败，请查看应用日志')
    }
  }
}

/**
 * 注册所有 IPC 处理器。必须在 app.whenReady() 之后调用，且仅调用一次。
 * 重复注册同一通道 Electron 会抛异常，因此本函数不可重入。
 *
 * @param windowGetter 主窗口 getter，每次 IPC 调用时动态获取最新引用
 *                    （macOS activate 重建窗口后无需重新 register）
 */
export function registerIpcHandlers(windowGetter: MainWindowGetter): void {
  if (!sseService) {
    sseService = new SseService(DEFAULT_OHMYTOKEN_BASE, () => getAccessToken())
    // SSE 推送消息持久化：收到推送时写入 notifications 表（在 IPC 转发 renderer 之前）
    sseService.onPushMessage((message) => {
      try {
        if (message.type === 'custom') applyCustomSseMessage(message)
        insertNotification(message)
      } catch (e) {
        console.error('[ipc] 通知持久化失败:', e)
      }
    })
  }

  const notifyAuthLogout = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.AUTH_LOGOUT_EVENT)
      }
    }
  }

  /**
   * 启动或重建 SSE 长连接。
   */
  function startSse(): void {
    if (sseService) {
      console.info('[ipc] 启动 SSE 长连接')
      sseService.start(handleTokenExpired)
    }
  }

  async function handleTokenExpired(): Promise<void> {
    console.warn('[ipc] SSE 报告 Access Token 失效，尝试自动续期')
    await forceRefreshAccessToken()
  }

  function handleSessionInvalidated(): void {
    console.warn('[ipc] Refresh Token 已失效，需要用户重新登录')
    notifyAuthLogout()
    startSse()
  }

  setOnLoginSuccessCallback(startSse)
  setOnTokenRefreshedCallback(startSse)
  setOnSessionInvalidatedCallback(handleSessionInvalidated)
  initializeAuthSessionManager()

  setTimeout(startSse, 500)

  // 扫描：POST /api/scan
  ipcMain.handle(
    IPC.SCAN_PERFORM,
    wrapHandler((_event, options?: ScanOptions) => performScan(options)),
  )

  // 总览：GET /api/stats/overview（from/to 可选）
  ipcMain.handle(
    IPC.STATS_OVERVIEW,
    wrapHandler((_event, params?: RangeParams) => getOverview(params?.from, params?.to)),
  )

  // 每日（按 agent）：GET /api/stats/daily
  ipcMain.handle(
    IPC.STATS_DAILY,
    wrapHandler((_event, params?: RangeParams) =>
      getDailyStats(params?.from ?? '2020-01-01', params?.to ?? '2099-12-31'),
    ),
  )

  // 每日（按 model）：GET /api/stats/model/daily
  ipcMain.handle(
    IPC.STATS_DAILY_MODEL,
    wrapHandler((_event, params?: RangeParams) =>
      getDailyModelStats(params?.from ?? '2020-01-01', params?.to ?? '2099-12-31'),
    ),
  )

  // 每月：GET /api/stats/monthly（注意默认是 7 位 yyyy-MM，与 Java 一致）
  ipcMain.handle(
    IPC.STATS_MONTHLY,
    wrapHandler((_event, params?: RangeParams) =>
      getMonthlyStats(params?.from ?? '2020-01', params?.to ?? '2099-12'),
    ),
  )

  // 模型维度：GET /api/stats/model
  ipcMain.handle(
    IPC.STATS_MODEL,
    wrapHandler((_event, params?: RangeParams) =>
      getModelStats(params?.from ?? '2020-01-01', params?.to ?? '2099-12-31'),
    ),
  )

  // 指定 agent 的 model 明细：GET /api/stats/agent/{agent}
  // L5 修复：params 缺失或 agent 非字符串时返回空数组（不抛错，不阻塞 UI）
  ipcMain.handle(
    IPC.STATS_AGENT,
    wrapHandler((_event, params?: AgentRangeParams) => {
      if (!params || typeof params.agent !== 'string') return []
      return getAgentModelStats(params.agent, params.from, params.to)
    }),
  )

  // 指定 model 的 agent 明细：GET /api/stats/model/agents
  // L5 修复：同上，参数校验缺失时返回空数组
  ipcMain.handle(
    IPC.STATS_MODEL_AGENTS,
    wrapHandler((_event, params?: ModelRangeParams) => {
      if (!params || typeof params.model !== 'string') return []
      return getModelAgentStats(params.model, params.from, params.to)
    }),
  )

  // 环比：GET /api/stats/comparisons
  ipcMain.handle(
    IPC.STATS_COMPARISONS,
    wrapHandler(() => getComparisons()),
  )

  // 会话级明细：GET /api/stats/sessions
  ipcMain.handle(
    IPC.STATS_SESSIONS,
    wrapHandler((_event, params?: UsageSessionsParams) => getUsageSessions(params ?? {})),
  )

  // 用户级会话明细：GET /api/stats/user-sessions
  ipcMain.handle(
    IPC.STATS_USER_SESSIONS,
    wrapHandler((_event, params?: UsageSessionsParams) => getUserUsageSessionsPage(params ?? {})),
  )

  // 会话内 API 轮次明细：GET /api/stats/api-calls
  ipcMain.handle(
    IPC.STATS_API_CALLS,
    wrapHandler((_event, params?: UsageApiCallsParams) => {
      if (!params || typeof params.agent !== 'string' || typeof params.sessionId !== 'string')
        return []
      return getUsageApiCalls(params)
    }),
  )

  // API 轮次通用明细：GET /api/stats/api-records
  ipcMain.handle(
    IPC.STATS_API_RECORDS,
    wrapHandler((_event, params?: UsageApiRecordsParams) => getUsageApiRecordsPage(params ?? {})),
  )

  // 小时级统计：GET /api/stats/hourly
  ipcMain.handle(
    IPC.STATS_HOURLY,
    wrapHandler((_event, params?: HourlyUsageParams) => {
      const date = typeof params?.date === 'string' ? params.date : ''
      const groupBy = params?.groupBy === 'model' ? 'model' : 'agent'
      return getHourlyUsageStats({ date, groupBy })
    }),
  )

  // 分钟级可缩放趋势：默认最近 24 小时，单次最多查询 31 天。
  ipcMain.handle(
    IPC.STATS_USAGE_TREND,
    wrapHandler((_event, params?: UsageTrendParams) => {
      const now = Date.now()
      const to = typeof params?.to === 'number' && Number.isFinite(params.to) ? params.to : now
      const fallbackFrom = to - 24 * 60 * 60 * 1000
      const requestedFrom =
        typeof params?.from === 'number' && Number.isFinite(params.from)
          ? params.from
          : fallbackFrom
      const maxFrom = to - 60_000
      const minFrom = to - 31 * 24 * 60 * 60 * 1000
      const from = Math.max(minFrom, Math.min(requestedFrom, maxFrom))
      const groupBy = params?.groupBy === 'model' ? 'model' : 'agent'
      return getUsageTrendStats({ from, to, groupBy })
    }),
  )

  ipcMain.handle(
    IPC.PROJECTS_LIST,
    wrapHandler(() => listTrackedProjects()),
  )

  ipcMain.handle(
    IPC.PROJECTS_SELECT_DIRECTORY,
    wrapHandler(async () => {
      const owner = windowGetter()
      const options: OpenDialogOptions = { properties: ['openDirectory'] }
      const result = owner
        ? await dialog.showOpenDialog(owner, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : result.filePaths[0] || null
    }),
  )

  ipcMain.handle(
    IPC.PROJECTS_SAVE,
    wrapHandler((_event, input?: { name?: string; path?: string }) =>
      saveTrackedProject(input?.name ?? '', input?.path ?? ''),
    ),
  )

  ipcMain.handle(
    IPC.PROJECTS_UPDATE,
    wrapHandler((_event, input?: { projectId?: string; name?: string; path?: string }) =>
      updateTrackedProject(input?.projectId ?? '', input?.name ?? '', input?.path ?? ''),
    ),
  )

  ipcMain.handle(
    IPC.PROJECTS_REMOVE,
    wrapHandler((_event, projectId?: string) => removeTrackedProject(projectId ?? '')),
  )

  ipcMain.handle(
    IPC.PROJECTS_OVERVIEW,
    wrapHandler((_event, params?: RangeParams) =>
      getProjectUsageOverview(params?.from, params?.to),
    ),
  )

  ipcMain.handle(
    IPC.PROJECTS_DETAIL,
    wrapHandler((_event, params?: RangeParams & { projectId?: string }) =>
      getProjectUsageDetail(params?.projectId ?? '', params?.from, params?.to),
    ),
  )

  ipcMain.handle(
    IPC.TRAY_RESOLVE_CLOSE,
    wrapHandler((_event, input?: { decision?: CloseDecision; remember?: boolean }) =>
      resolveMainWindowClose(input?.decision ?? 'cancel', input?.remember === true),
    ),
  )

  ipcMain.handle(
    IPC.TRAY_GET_CLOSE_BEHAVIOR,
    wrapHandler(() => getCloseBehavior()),
  )

  ipcMain.handle(
    IPC.TRAY_SET_CLOSE_BEHAVIOR,
    wrapHandler((_event, behavior?: CloseBehavior) => setCloseBehavior(behavior as CloseBehavior)),
  )

  // 在系统默认浏览器打开外部 URL
  ipcMain.handle(
    IPC.APP_OPEN_EXTERNAL,
    wrapHandler(async (_event, url: string) => {
      if (typeof url !== 'string' || url.length === 0 || url.length > 2_048) return
      const parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('只允许打开不含凭据的 HTTP(S) 外部链接')
      }
      await shell.openExternal(parsed.toString())
    }),
  )

  // 获取 ohmytokencom 后端地址（供 renderer 的 axios 配置 baseURL）
  ipcMain.handle(
    IPC.APP_GET_OHMYTOKEN_BASE,
    wrapHandler(() => DEFAULT_OHMYTOKEN_BASE),
  )

  ipcMain.handle(
    IPC.APP_GET_RUNTIME_CONFIG,
    wrapHandler((_event, forceRefresh?: boolean) => getDesktopRuntimeConfig(forceRefresh === true)),
  )

  // 获取当前应用版本号（读取 electron app.getVersion()，与 package.json 一致）
  ipcMain.handle(
    IPC.APP_GET_VERSION,
    wrapHandler(() => app.getVersion()),
  )

  ipcMain.handle(
    IPC.APP_GET_DEVICE_ID,
    wrapHandler(() => getDeviceId()),
  )

  ipcMain.handle(
    IPC.APP_GET_REQUEST_IDENTITY,
    wrapHandler(async () => ensureAgentClientRegistered(await getAccessToken())),
  )

  ipcMain.handle(
    IPC.APP_SET_LANGUAGE,
    wrapHandler((_event, language?: string) => setTrayLanguage(language ?? '')),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_CREDENTIALS_LIST,
    wrapHandler(() => listTokenPlanCredentials()),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_CREDENTIAL_SAVE,
    wrapHandler((_event, input: TokenPlanCredentialInput) => saveTokenPlanCredential(input)),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_CREDENTIAL_REMOVE,
    wrapHandler((_event, providerId: TokenPlanProviderId) => removeTokenPlanCredential(providerId)),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_USAGE_QUERY,
    wrapHandler((_event, providerId: TokenPlanProviderId) => queryTokenPlanUsage(providerId)),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_USAGE_QUERY_ALL,
    wrapHandler(() => queryAllTokenPlanUsage()),
  )

  // 检查更新：向 com 后端拉取 latest.yml 并对比当前版本
  ipcMain.handle(
    IPC.UPDATE_CHECK,
    wrapHandler(async () => checkForUpdates()),
  )

  // 下载更新：autoDownload=false 时由用户在 UI 上手动触发
  ipcMain.handle(
    IPC.UPDATE_DOWNLOAD,
    wrapHandler(async () => downloadUpdate()),
  )

  // 退出应用并启动安装器（仅 Windows NSIS 有效）
  ipcMain.handle(
    IPC.UPDATE_INSTALL,
    wrapHandler(() => quitAndInstall()),
  )

  ipcMain.on(IPC.DIAGNOSTICS_RENDERER_ERROR, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const candidate = payload as Partial<DiagnosticErrorPayload>
    if (typeof candidate.message !== 'string' || typeof candidate.source !== 'string') return
    reportDiagnosticError(
      {
        reportType: candidate.reportType ?? 'renderer',
        source: candidate.source.slice(0, 64),
        stage: candidate.stage?.slice(0, 64),
        severity: candidate.severity ?? 'error',
        summary: candidate.summary?.slice(0, 500),
        message: candidate.message,
        stack: candidate.stack,
        context: candidate.context,
        occurredAt: candidate.occurredAt,
      },
      { autoUpload: true, persistPending: true },
    )
  })

  ipcMain.handle(
    IPC.DIAGNOSTICS_UPLOAD,
    wrapHandler((_event, options?: DiagnosticUploadOptions) =>
      confirmAndUploadDiagnosticReport(options),
    ),
  )

  ipcMain.handle(
    IPC.DIAGNOSTICS_UPLOAD_STATE,
    wrapHandler(() => getDiagnosticUploadState()),
  )

  ipcMain.handle(
    IPC.DIAGNOSTICS_OPEN_LOGS,
    wrapHandler(() => openDiagnosticLogs()),
  )

  ipcMain.handle(
    IPC.AUTH_LOGIN,
    wrapHandler(async (_event, language?: string) => {
      const ok = await startPkceLogin(windowGetter, language === 'en' ? 'en' : 'zh')
      return ok ? { ok } : { ok, message: '无法打开系统浏览器' }
    }),
  )

  // 登出：撤销服务端 Refresh Token、清除本地会话，再切换为未登录 SSE 连接
  // L3 修复：返回 {ok: boolean} 让 renderer 能给用户反馈
  ipcMain.handle(
    IPC.AUTH_LOGOUT,
    wrapHandler(async () => {
      sseService?.stop()
      const ok = await revokeAndClearAuthSession()
      if (ok) {
        notifyAuthLogout()
        sseService?.start(handleTokenExpired)
      }
      return ok ? { ok } : { ok, message: '本地登录凭据清理失败' }
    }),
  )

  // 查询本机是否保存了可续期登录会话（不向 renderer 暴露任何 Token）
  ipcMain.handle(
    IPC.AUTH_STATUS,
    wrapHandler((): boolean => hasAuthSession()),
  )

  ipcMain.handle(
    IPC.AUTH_SESSION,
    wrapHandler(() => getAuthSession()),
  )

  ipcMain.handle(
    IPC.DESKTOP_FEEDBACK_SUBMIT,
    wrapHandler((_event, params: DesktopFeedbackSubmitParams) => submitDesktopFeedback(params)),
  )

  ipcMain.handle(
    IPC.DESKTOP_MESSAGE_SYNC,
    wrapHandler((_event, placement: CustomMessagePlacement) => syncDesktopMessages(placement)),
  )

  ipcMain.handle(
    IPC.DESKTOP_MESSAGE_EVENT,
    wrapHandler((_event, input: DesktopMessageEventInput) => reportDesktopMessageEvent(input)),
  )

  ipcMain.handle(
    IPC.CUSTOM_MESSAGES_LIST,
    wrapHandler((_event, placement: CustomMessagePlacement) => listCachedCustomMessages(placement)),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGES_CACHE,
    wrapHandler((_event, values: unknown[], placement: CustomMessagePlacement) =>
      cacheCustomMessages(values, placement),
    ),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGES_RECONCILE,
    wrapHandler((_event, placement: CustomMessagePlacement, activeMessageUids: string[]) =>
      reconcileCustomMessages(placement, activeMessageUids),
    ),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGE_RECEIPT_QUEUE,
    wrapHandler(
      (
        _event,
        messageId: number,
        messageUid: string,
        event: CustomMessageEvent,
        placement: CustomMessagePlacement,
      ) => queueCustomMessageReceipt(messageId, messageUid, event, placement),
    ),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGE_RECEIPTS_PENDING,
    wrapHandler(() => listPendingCustomMessageReceipts()),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGE_RECEIPT_SENT,
    wrapHandler((_event, id: number) => markCustomMessageReceiptSent(id)),
  )
  ipcMain.handle(
    IPC.CUSTOM_MESSAGE_RECEIPT_FAILED,
    wrapHandler((_event, id: number, error: string) => markCustomMessageReceiptFailed(id, error)),
  )

  // ===== 通知持久化 =====
  // 查询通知列表（filter: 'all' 全部 | 'unread' 仅未读 | 'read' 仅已读，默认 all）
  ipcMain.handle(
    IPC.NOTIFICATIONS_LIST,
    wrapHandler((_event, filter?: 'all' | 'unread' | 'read') => listNotifications(filter ?? 'all')),
  )

  // 标记单条通知为已读（参数 id）
  ipcMain.handle(
    IPC.NOTIFICATIONS_MARK_READ,
    wrapHandler((_event, id: string) => markNotificationRead(id)),
  )

  // 标记所有未读通知为已读
  ipcMain.handle(
    IPC.NOTIFICATIONS_MARK_ALL_READ,
    wrapHandler(() => markAllNotificationsRead()),
  )

  // 删除单条通知（参数 id）
  ipcMain.handle(
    IPC.NOTIFICATIONS_DELETE,
    wrapHandler((_event, id: string) => deleteNotification(id)),
  )

  // 应用退出前停止 SSE 长连接（优雅断开，通知后端 agent 离线）
  app.on('before-quit', () => {
    sseService?.stop()
    shutdownAuthSessionManager()
  })
}

/**
 * 停止 SSE 长连接（供 index.ts 的 before-quit 钩子显式调用，确保退出前优雅断开）。
 * stop() 是幂等的，多次调用安全。
 */
export function stopSseService(): void {
  sseService?.stop()
  shutdownAuthSessionManager()
}
