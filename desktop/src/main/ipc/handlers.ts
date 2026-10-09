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
import type { DiagnosticErrorPayload, DiagnosticUploadOptions } from '../../shared/diagnostics'
import type { CustomMessageEvent, CustomMessagePlacement } from '../../shared/custom-message'
import type { DesktopFeedbackSubmitParams } from '../../shared/desktop-api'
import { IPC } from './channels'
import { usageTrendRange } from '../services/usage-trend-query'
import { registerReplayHandlers } from './replay-handlers'
import { registerThirdPartyNoticesHandlers } from './third-party-notices-handlers'
import { registerScanRefreshHandlers } from './scan-refresh-handlers'
import { registerNetworkMonitorHandlers } from './network-monitor-handlers'
import { registerDiscoveryUiHandlers } from './discovery-ui-handlers'
import { registerWindowMaterialIpc } from '../services/window-material.service'
import { createBrowsingStateStore } from '../services/browsing-state.service'
import { createRuntimeAccountFavorites } from '../services/account-favorites.runtime'
import {
  createLocalFavoriteStore,
  validateFavoriteTarget,
} from '../services/local-favorites.service'
import {
  sessionFavoriteSnapshot,
  type LocalFavorite,
  type LocalFavoritesState,
} from '../../shared/local-favorites'
import { getUsageCostSummary } from '../services/usage-cost.service'
import { getExchangeRates } from '../services/exchange-rate.service'
import { startModelCatalogSync, stopModelCatalogSync } from '../services/model-catalog.service'
import {
  ensureModelIcons,
  getModelIconSnapshot,
  startModelIconSync,
} from '../services/model-icons.service'
import { getSessionWorkspace } from '../services/session-workspace.service'
import { getProjectWorkspace } from '../services/project-workspace.service'
import { updateProjectNotes } from '../services/project.service'
import { getUsageAnalytics } from '../services/analytics.service'
import { readTurnStats } from '../services/session-turns'
import { openDatabase } from '../services/sqlite-storage.service'
import {
  getAccessToken,
  hasAuthSession,
  initializeAuthSessionManager,
  revokeAndClearAuthSession,
  setOnLoginSuccessCallback,
  setOnSessionInvalidatedCallback,
  shutdownAuthSessionManager,
  startPkceLogin,
} from '../services/auth.service'
import { getDeviceId } from '../services/device-id.service'
import {
  resolveAgentRequestIdentity,
  resolveRefreshedAgentRequestIdentity,
} from '../services/client-registration.service'
import { getOhmytokenApiBase } from '../services/server-config.service'
import type { DesktopApiKey, DesktopApiParameters } from '../../shared/runtime-config'
import { getDesktopRuntimeConfig, resolveDesktopApiUrl } from '../services/runtime-config.service'
import { readInstallationLanguage } from '../services/installation-language.service'
import { getExternalWebUrl } from '../services/window-navigation'
import {
  getDiagnosticUploadState,
  confirmAndUploadDiagnosticReport,
  openDiagnosticLogs,
  reportDiagnosticError,
} from '../services/diagnostic-log.service'
import { getAuthSession, submitDesktopFeedback } from '../services/desktop-api.service'
import {
  getScanProgress,
  performScan,
  resumeBackgroundScan,
  stopBackgroundScan,
} from '../services/scan.service'
import {
  startAgentHeartbeat,
  stopAgentHeartbeat,
  wakeAgentHeartbeat,
  queueReceiptFlush,
} from '../services/agent-heartbeat.service'
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
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateState,
  pauseUpdate,
  resumeUpdate,
  quitAndInstall,
} from '../services/updater.service'
import {
  getProjectUsageDetail,
  getProjectUsageOverview,
  listTrackedProjects,
  removeTrackedProject,
  restoreTrackedProject,
  saveTrackedProject,
  updateTrackedProject,
} from '../services/project.service'
import { discoverProjects } from '../services/project-discovery'
import {
  getCloseBehavior,
  resolveMainWindowClose,
  setCloseBehavior,
  setTrayLanguage,
  type CloseDecision,
} from '../services/tray.service'
import {
  discoverTokenPlanConnections,
  queryTokenPlanUsage,
  queryTokenPlanDetails,
  createTokenPlanMonitor,
} from '../services/token-plan.service'
import type { QuotaDetailQuery } from '../../shared/quota-details'
import { createNetworkCheckService } from '../network-check'
import {
  listCachedCustomMessages,
  queueCustomMessageReceipt,
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

export type UsageSessionsParams = import('../../shared/models').UsageDetailPageFilter

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
  models?: string[]
  projectId?: string
  projectIds?: string[]
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

/** 主窗口 getter 类型：每次调用动态返回当前主窗口引用（可能为 null） */
type MainWindowGetter = () => BrowserWindow | null

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
  registerDiscoveryUiHandlers(windowGetter)
  registerScanRefreshHandlers()
  registerReplayHandlers(windowGetter)
  registerThirdPartyNoticesHandlers(windowGetter)
  registerNetworkMonitorHandlers(windowGetter)
  registerWindowMaterialIpc()
  const quotaMonitor = createTokenPlanMonitor((state) => {
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(IPC.TOKEN_PLAN_MONITOR_CHANGED, state)
  })
  app.once('before-quit', () => quotaMonitor.stop())
  const quotaSenders = new Set<number>()
  const checkQuotaSender = (event: IpcMainInvokeEvent): void => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    )
      throw new Error('Quota monitor requires an application window')
  }
  ipcMain.handle(
    IPC.TOKEN_PLAN_MONITOR_READ,
    wrapHandler((event) => {
      checkQuotaSender(event)
      return quotaMonitor.read()
    }),
  )
  ipcMain.handle(
    IPC.TOKEN_PLAN_MONITOR_REFRESH,
    wrapHandler(async (event, id?: string) => {
      checkQuotaSender(event)
      if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)))
        throw new Error('Invalid quota account')
      await quotaMonitor.refresh(id)
      return quotaMonitor.read()
    }),
  )
  ipcMain.handle(
    IPC.TOKEN_PLAN_MONITOR_INTERVAL,
    wrapHandler(async (event, interval: number) => {
      checkQuotaSender(event)
      await quotaMonitor.setInterval(interval)
      return quotaMonitor.read()
    }),
  )
  ipcMain.handle(
    IPC.TOKEN_PLAN_MONITOR_ACTIVE,
    wrapHandler((event, active: boolean) => {
      checkQuotaSender(event)
      if (typeof active !== 'boolean') throw new Error('Invalid quota visibility')
      const id = event.sender.id
      if (!quotaSenders.has(id)) {
        quotaSenders.add(id)
        event.sender.once('destroyed', () => {
          quotaSenders.delete(id)
          void quotaMonitor.setActive(id, false).catch(() => {})
        })
      }
      return quotaMonitor.setActive(id, active)
    }),
  )
  let favorites: ReturnType<typeof createLocalFavoriteStore> | undefined
  let favoriteRevision = 0
  let favoriteWrites: Promise<unknown> = Promise.resolve()
  const favoriteStore = (): ReturnType<typeof createLocalFavoriteStore> =>
    (favorites ??= createLocalFavoriteStore(openDatabase()))
  const checkFavoriteSender = (event: IpcMainInvokeEvent): void => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !BrowserWindow.fromWebContents(event.sender)
    )
      throw new Error('Favorites require an application window')
  }
  const mutateFavorites = (
    action: () => LocalFavorite[] | Promise<LocalFavorite[]>,
  ): Promise<LocalFavoritesState> => {
    const request = favoriteWrites.then(async () => {
      const items = await action()
      const state = { revision: ++favoriteRevision, items }
      for (const window of BrowserWindow.getAllWindows())
        if (!window.isDestroyed()) window.webContents.send(IPC.LOCAL_FAVORITES_CHANGED, state)
      return state
    })
    favoriteWrites = request.catch(() => {})
    return request
  }
  ipcMain.handle(
    IPC.LOCAL_FAVORITES_LIST,
    wrapHandler((event) => {
      checkFavoriteSender(event)
      return { revision: favoriteRevision, items: favoriteStore().list() }
    }),
  )
  ipcMain.handle(
    IPC.LOCAL_FAVORITES_SET,
    wrapHandler((event, target: unknown, favorite: unknown) => {
      checkFavoriteSender(event)
      const verified = validateFavoriteTarget(target)
      return mutateFavorites(async () => {
        if (typeof favorite !== 'boolean') throw new Error('Invalid favorite state')
        const session =
          favorite && verified.type === 'session'
            ? (
                await getUserUsageSessionsPage({
                  agent: verified.agent,
                  rootSessionId: verified.id,
                  page: 1,
                  pageSize: 1,
                })
              ).items[0]
            : undefined
        return favoriteStore().set(
          verified,
          favorite,
          session ? sessionFavoriteSnapshot(session) : undefined,
        )
      })
    }),
  )
  ipcMain.handle(
    IPC.LOCAL_FAVORITES_REORDER,
    wrapHandler((event, type: unknown, order: unknown) => {
      checkFavoriteSender(event)
      return mutateFavorites(() => favoriteStore().reorder(type, order))
    }),
  )
  ipcMain.handle(
    IPC.LOCAL_FAVORITES_MIGRATE,
    wrapHandler((event, entries: unknown) => {
      checkFavoriteSender(event)
      return mutateFavorites(() => favoriteStore().migrateFloating(entries))
    }),
  )
  const browsingState = createBrowsingStateStore()
  const checkBrowsingSender = (event: IpcMainInvokeEvent): void => {
    if (
      event.sender.id !== windowGetter()?.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Browsing state is only available in the main window')
  }
  ipcMain.handle(
    IPC.BROWSING_READ,
    wrapHandler((event) => {
      checkBrowsingSender(event)
      return browsingState.read()
    }),
  )
  ipcMain.handle(
    IPC.BROWSING_WRITE,
    wrapHandler((event, key: unknown, page: unknown) => {
      checkBrowsingSender(event)
      browsingState.write(key, page)
    }),
  )
  let accountFavorites: ReturnType<typeof createRuntimeAccountFavorites> | undefined
  const accountFavoriteService = (): ReturnType<typeof createRuntimeAccountFavorites> =>
    (accountFavorites ??= createRuntimeAccountFavorites((state) => {
      const window = windowGetter()
      if (window && !window.isDestroyed())
        window.webContents.send(IPC.ACCOUNT_FAVORITES_CHANGED, state)
    }))
  ipcMain.handle(
    IPC.ACCOUNT_FAVORITES_LIST,
    wrapHandler((event, refresh: unknown) => {
      checkBrowsingSender(event)
      if (refresh !== undefined && typeof refresh !== 'boolean') throw new Error('Invalid refresh')
      return accountFavoriteService().list(refresh === true)
    }),
  )
  ipcMain.handle(
    IPC.ACCOUNT_FAVORITES_SET,
    wrapHandler((event, target: unknown, desired: unknown) => {
      checkBrowsingSender(event)
      if (typeof desired !== 'boolean') throw new Error('Invalid favorite value')
      return accountFavoriteService().set(target, desired)
    }),
  )
  const networkCheck = createNetworkCheckService((snapshot) => {
    const window = windowGetter()
    if (window && !window.isDestroyed())
      window.webContents.send(IPC.NETWORK_CHECK_PROGRESS, snapshot)
  })
  const checkNetworkSender = (event: IpcMainInvokeEvent): void => {
    if (
      event.sender.id !== windowGetter()?.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error('Network check is only available in the main window')
  }
  ipcMain.handle(
    IPC.NETWORK_CHECK_STATUS,
    wrapHandler((event) => {
      checkNetworkSender(event)
      return networkCheck.get()
    }),
  )
  ipcMain.handle(
    IPC.NETWORK_CHECK_START,
    wrapHandler((event, mode: unknown, target?: unknown) => {
      checkNetworkSender(event)
      if (mode !== 'system' && mode !== 'direct') throw new Error('Invalid network mode')
      if (target !== undefined && typeof target !== 'string')
        throw new Error('Invalid network target')
      return networkCheck.start(
        mode,
        target as import('../../shared/network-check').NetworkCheckTarget | undefined,
      )
    }),
  )
  ipcMain.handle(
    IPC.NETWORK_CHECK_CANCEL,
    wrapHandler((event) => {
      checkNetworkSender(event)
      return networkCheck.cancel()
    }),
  )
  app.once('before-quit', () => networkCheck.cancel())
  ipcMain.handle(
    IPC.SCAN_STATUS,
    wrapHandler(() => getScanProgress()),
  )
  const notifyAuthLogout = (): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.AUTH_LOGOUT_EVENT)
      }
    }
  }

  setOnLoginSuccessCallback(() => {
    void wakeAgentHeartbeat(true)
  })
  setOnSessionInvalidatedCallback(() => {
    notifyAuthLogout()
    void wakeAgentHeartbeat(true)
  })
  initializeAuthSessionManager()
  startModelCatalogSync()
  ipcMain.handle(
    IPC.MODEL_ICONS_SNAPSHOT,
    wrapHandler(() => getModelIconSnapshot()),
  )
  ipcMain.handle(
    IPC.MODEL_ICONS_ENSURE,
    wrapHandler((_event, modelIds: string[]) => ensureModelIcons(modelIds)),
  )
  startModelIconSync()
  startAgentHeartbeat()

  ipcMain.handle(
    IPC.AGENT_HEARTBEAT_WAKE,
    wrapHandler(() => wakeAgentHeartbeat()),
  )

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
  ipcMain.handle(
    IPC.STATS_COST,
    wrapHandler((_event, params?: RangeParams) => getUsageCostSummary(params)),
  )
  ipcMain.handle(
    IPC.COST_EXCHANGE_RATES,
    wrapHandler((_event, refresh?: boolean) => getExchangeRates(refresh)),
  )
  ipcMain.handle(
    IPC.STATS_TURNS,
    wrapHandler((_event, params?: RangeParams & { groupBy?: string }) =>
      readTurnStats(
        openDatabase(),
        {
          from: typeof params?.from === 'string' ? params.from : undefined,
          to: typeof params?.to === 'string' ? params.to : undefined,
        },
        params?.groupBy === 'agent' ? 'agent' : 'model',
      ),
    ),
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
    IPC.STATS_SESSION_WORKSPACE,
    wrapHandler((_event, params?: import('../../shared/models').SessionWorkspaceFilter) =>
      getSessionWorkspace(params ?? {}),
    ),
  )
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

  // 秒级可缩放趋势：快捷时段限制 31 天，自定义基线保留用户选择的起点。
  ipcMain.handle(
    IPC.STATS_USAGE_TREND,
    wrapHandler((_event, params?: UsageTrendParams) => {
      const { from, to } = usageTrendRange(params)
      const groupBy = params?.groupBy === 'model' ? 'model' : 'agent'
      return getUsageTrendStats({ from, to, groupBy })
    }),
  )

  ipcMain.handle(
    IPC.PROJECTS_LIST,
    wrapHandler(async () => {
      await discoverProjects()
      return listTrackedProjects()
    }),
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
    IPC.PROJECTS_IGNORED,
    wrapHandler(() => listTrackedProjects(true).filter((project) => project.ignored)),
  )
  ipcMain.handle(
    IPC.PROJECTS_RESTORE,
    wrapHandler((_event, projectId?: string) => restoreTrackedProject(projectId ?? '')),
  )

  ipcMain.handle(
    IPC.PROJECTS_OVERVIEW,
    wrapHandler(async (_event, params?: RangeParams) => {
      await discoverProjects()
      return getProjectUsageOverview(params?.from, params?.to)
    }),
  )

  ipcMain.handle(
    IPC.PROJECTS_DETAIL,
    wrapHandler((_event, params?: RangeParams & { projectId?: string }) =>
      getProjectUsageDetail(params?.projectId ?? '', params?.from, params?.to),
    ),
  )

  ipcMain.handle(
    IPC.PROJECTS_WORKSPACE,
    wrapHandler((_event, params?: import('../../shared/models').SessionWorkspaceFilter) =>
      getProjectWorkspace(params ?? {}),
    ),
  )
  ipcMain.handle(
    IPC.STATS_ANALYTICS,
    wrapHandler((_event, params?: import('../../shared/analytics').UsageAnalyticsFilter) =>
      getUsageAnalytics(params ?? {}),
    ),
  )
  ipcMain.handle(
    IPC.PROJECTS_NOTES,
    wrapHandler((_event, input: { projectId: string; notes: string; name?: string }) =>
      updateProjectNotes(input.projectId, input.notes, input.name),
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
      const externalUrl = getExternalWebUrl(
        url,
        app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL,
      )
      if (externalUrl) await shell.openExternal(externalUrl)
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

  ipcMain.handle(
    IPC.APP_RESOLVE_API_URL,
    wrapHandler((_event, key: DesktopApiKey, parameters?: DesktopApiParameters) =>
      resolveDesktopApiUrl(key, parameters),
    ),
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
    wrapHandler(() => resolveAgentRequestIdentity(getAccessToken)),
  )

  ipcMain.handle(
    IPC.APP_REFRESH_DEVICE_CREDENTIAL,
    wrapHandler(() => resolveRefreshedAgentRequestIdentity(getAccessToken)),
  )

  ipcMain.handle(
    IPC.APP_SET_LANGUAGE,
    wrapHandler((_event, language?: string) => setTrayLanguage(language ?? '')),
  )

  ipcMain.handle(
    IPC.APP_GET_INSTALLATION_LANGUAGE,
    wrapHandler(() => readInstallationLanguage(process.resourcesPath)),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_DISCOVER,
    wrapHandler((_event, force?: boolean) => discoverTokenPlanConnections(force === true)),
  )

  ipcMain.handle(
    IPC.TOKEN_PLAN_USAGE_QUERY,
    wrapHandler((_event, id: string, force?: boolean) => queryTokenPlanUsage(id, force)),
  )
  ipcMain.handle(
    IPC.TOKEN_PLAN_DETAILS_QUERY,
    wrapHandler((_event, id: string, query: QuotaDetailQuery) => queryTokenPlanDetails(id, query)),
  )

  // 检查更新：向 com 后端拉取 latest.yml 并对比当前版本
  ipcMain.handle(
    IPC.UPDATE_CHECK,
    wrapHandler(async () => checkForUpdates()),
  )

  // 下载更新：autoDownload=false 时由用户在 UI 上手动触发
  ipcMain.handle(
    IPC.UPDATE_STATE,
    wrapHandler(async () => getUpdateState()),
  )
  ipcMain.handle(
    IPC.UPDATE_PAUSE,
    wrapHandler(async () => pauseUpdate()),
  )
  ipcMain.handle(
    IPC.UPDATE_RESUME,
    wrapHandler(async () => resumeUpdate()),
  )
  ipcMain.handle(
    IPC.UPDATE_DOWNLOAD,
    wrapHandler(async () => downloadUpdate()),
  )

  // 更新前先等待扫描子进程退出；NSIS 在真正替换文件前还会执行最终进程门禁。
  ipcMain.handle(
    IPC.UPDATE_INSTALL,
    wrapHandler(async () => {
      await stopBackgroundScan()

      // electron-updater 启动安装器成功后会在下一轮事件循环触发 app.quit()。
      // 若未触发（例如更新文件已丢失），恢复扫描，避免当前会话永久停用扫描功能。
      let recoveryTimer: NodeJS.Timeout | null = null
      const handleBeforeQuit = (): void => {
        if (recoveryTimer) clearTimeout(recoveryTimer)
        recoveryTimer = null
      }
      app.once('before-quit', handleBeforeQuit)

      try {
        quitAndInstall()
      } catch (error) {
        app.removeListener('before-quit', handleBeforeQuit)
        resumeBackgroundScan()
        throw error
      }

      recoveryTimer = setTimeout(() => {
        app.removeListener('before-quit', handleBeforeQuit)
        resumeBackgroundScan()
      }, 2_000)
      recoveryTimer.unref()
    }),
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
      return startPkceLogin(windowGetter, language === 'en' ? 'en' : 'zh')
    }),
  )

  // 登出后立即用匿名身份更新同一个客户端的在线状态。
  // L3 修复：返回 {ok: boolean} 让 renderer 能给用户反馈
  ipcMain.handle(
    IPC.AUTH_LOGOUT,
    wrapHandler(async () => {
      const ok = await revokeAndClearAuthSession()
      if (ok) {
        notifyAuthLogout()
        void wakeAgentHeartbeat(true)
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
    IPC.CUSTOM_MESSAGES_LIST,
    wrapHandler((_event, placement: CustomMessagePlacement) => listCachedCustomMessages(placement)),
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
      ) => {
        queueCustomMessageReceipt(messageId, messageUid, event, placement)
        queueReceiptFlush()
      },
    ),
  )
  app.on('before-quit', () => {
    stopModelCatalogSync()
    stopAgentHeartbeat()
    shutdownAuthSessionManager()
  })
}

/** Stop network timers and token refresh before app shutdown. */
export function stopAgentNetworkServices(): void {
  stopModelCatalogSync()
  stopAgentHeartbeat()
  shutdownAuthSessionManager()
}
