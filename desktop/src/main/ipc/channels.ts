/**
 * IPC 通道名常量
 *
 * 主进程 ipcMain.handle 与 preload ipcRenderer.invoke 必须使用同一通道名，
 * 这里集中定义避免拼写不一致。通道名采用 "域:动作" 命名风格，
 * 与原 REST 端点一一对应（见原 Java ApiController）。
 */
import { REPLAY_IPC } from './replay-channels'
import { THIRD_PARTY_IPC } from '../../shared/third-party-notices'
import { MATERIAL_IPC } from '../../shared/window-material'
import { DISCOVERY_IPC } from '../../shared/discovery-ui'
import { MODEL_ICON_IPC } from '../../shared/model-icons'
export const IPC = {
  ...DISCOVERY_IPC,
  ...MODEL_ICON_IPC,
  WINDOW_MATERIAL_GET: MATERIAL_IPC.GET,
  WINDOW_MATERIAL_SET: MATERIAL_IPC.SET,
  WINDOW_MATERIAL_CHANGED: MATERIAL_IPC.CHANGED,
  ...REPLAY_IPC,
  ...THIRD_PARTY_IPC,
  ACCOUNT_FAVORITES_LIST: 'account-favorites:list',
  ACCOUNT_FAVORITES_SET: 'account-favorites:set',
  ACCOUNT_FAVORITES_CHANGED: 'account-favorites:changed',
  LOCAL_FAVORITES_LIST: 'local-favorites:list',
  LOCAL_FAVORITES_SET: 'local-favorites:set',
  LOCAL_FAVORITES_REORDER: 'local-favorites:reorder',
  LOCAL_FAVORITES_MIGRATE: 'local-favorites:migrate',
  LOCAL_FAVORITES_CHANGED: 'local-favorites:changed',
  BROWSING_READ: 'browsing:read',
  BROWSING_WRITE: 'browsing:write',
  /** POST /api/scan → scan.service.performScan */
  SCAN_PERFORM: 'scan:perform',
  SCAN_PROGRESS: 'scan:progress',
  SCAN_STATUS: 'scan:status',
  SCAN_REFRESH_READ: 'scan:refresh:read',
  SCAN_REFRESH_CONFIGURE: 'scan:refresh:configure',
  SCAN_REFRESH_ACTIVE: 'scan:refresh:active',
  SCAN_REFRESH_CHANGED: 'scan:refresh:changed',
  /** GET /api/stats/overview → stats.service.getOverview */
  STATS_OVERVIEW: 'stats:overview',
  STATS_COST: 'stats:cost',
  STATS_TURNS: 'stats:turns',
  COST_EXCHANGE_RATES: 'cost:exchangeRates',
  /** GET /api/stats/daily → stats.service.getDailyStats（按 agent） */
  STATS_DAILY: 'stats:daily',
  /** GET /api/stats/model/daily → stats.service.getDailyModelStats（按 model） */
  STATS_DAILY_MODEL: 'stats:dailyModel',
  /** GET /api/stats/monthly → stats.service.getMonthlyStats */
  STATS_MONTHLY: 'stats:monthly',
  /** GET /api/stats/model → stats.service.getModelStats */
  STATS_MODEL: 'stats:model',
  /** GET /api/stats/agent/{agent} → stats.service.getAgentModelStats */
  STATS_AGENT: 'stats:agent',
  /** GET /api/stats/model/agents → stats.service.getModelAgentStats */
  STATS_MODEL_AGENTS: 'stats:modelAgents',
  /** GET /api/stats/comparisons → stats.service.getComparisons */
  STATS_COMPARISONS: 'stats:comparisons',
  /** GET /api/stats/sessions → stats.service.getUsageSessions */
  STATS_SESSIONS: 'stats:sessions',
  /** GET /api/stats/user-sessions → stats.service.getUserUsageSessions */
  STATS_USER_SESSIONS: 'stats:userSessions',
  STATS_SESSION_WORKSPACE: 'stats:sessionWorkspace',
  STATS_ANALYTICS: 'stats:analytics',
  /** GET /api/stats/api-calls → stats.service.getUsageApiCalls */
  STATS_API_CALLS: 'stats:apiCalls',
  /** GET /api/stats/api-records → stats.service.getUsageApiRecords */
  STATS_API_RECORDS: 'stats:apiRecords',
  /** GET /api/stats/hourly → stats.service.getHourlyUsageStats */
  STATS_HOURLY: 'stats:hourly',
  /** 分钟级可缩放趋势 → stats.service.getUsageTrendStats */
  STATS_USAGE_TREND: 'stats:usageTrend',
  PROJECTS_LIST: 'projects:list',
  PROJECTS_SELECT_DIRECTORY: 'projects:selectDirectory',
  PROJECTS_SAVE: 'projects:save',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_REMOVE: 'projects:remove',
  PROJECTS_IGNORED: 'projects:ignored',
  PROJECTS_RESTORE: 'projects:restore',
  PROJECTS_OVERVIEW: 'projects:overview',
  PROJECTS_DETAIL: 'projects:detail',
  PROJECTS_WORKSPACE: 'projects:workspace',
  PROJECTS_NOTES: 'projects:notes',
  TRAY_CLOSE_REQUESTED: 'tray:closeRequested',
  TRAY_RESOLVE_CLOSE: 'tray:resolveClose',
  TRAY_GET_CLOSE_BEHAVIOR: 'tray:getCloseBehavior',
  TRAY_SET_CLOSE_BEHAVIOR: 'tray:setCloseBehavior',
  TRAY_CLOSE_BEHAVIOR_CHANGED: 'tray:closeBehaviorChanged',
  TRAY_CHECK_UPDATE_REQUESTED: 'tray:checkUpdateRequested',
  /** shell.openExternal —— 外部链接转系统浏览器 */
  APP_OPEN_EXTERNAL: 'app:openExternal',
  /** 获取 ohmytokencom 后端 baseURL（供 renderer axios） */
  APP_GET_OHMYTOKEN_BASE: 'app:getOhmytokenBase',
  /** 从唯一可信 API Base 获取 com 后台下发的公开运行地址。 */
  APP_RESOLVE_API_URL: 'app:resolveApiUrl',
  APP_GET_RUNTIME_CONFIG: 'app:getRuntimeConfig',
  /** 获取当前应用版本号（electron app.getVersion()） */
  APP_GET_VERSION: 'app:getVersion',
  APP_GET_DEVICE_ID: 'app:getDeviceId',
  APP_GET_REQUEST_IDENTITY: 'app:getRequestIdentity',
  /** 设备凭证被服务端拒绝后：清凭证并强制重新登记，返回新的请求身份。 */
  APP_REFRESH_DEVICE_CREDENTIAL: 'app:refreshDeviceCredential',
  APP_SET_LANGUAGE: 'app:setLanguage',
  APP_GET_INSTALLATION_LANGUAGE: 'app:getInstallationLanguage',
  TOKEN_PLAN_DISCOVER: 'token-plan:discover',
  TOKEN_PLAN_MONITOR_READ: 'token-plan:monitor:read',
  TOKEN_PLAN_MONITOR_REFRESH: 'token-plan:monitor:refresh',
  TOKEN_PLAN_MONITOR_INTERVAL: 'token-plan:monitor:interval',
  TOKEN_PLAN_MONITOR_ACTIVE: 'token-plan:monitor:active',
  TOKEN_PLAN_MONITOR_CHANGED: 'token-plan:monitor:changed',
  TOKEN_PLAN_USAGE_QUERY: 'token-plan:usage:query',
  TOKEN_PLAN_DETAILS_QUERY: 'token-plan:details:query',
  NETWORK_CHECK_STATUS: 'network-check:status',
  NETWORK_CHECK_START: 'network-check:start',
  NETWORK_CHECK_CANCEL: 'network-check:cancel',
  NETWORK_CHECK_PROGRESS: 'network-check:progress',
  /** 打开并聚焦 Token 会话悬浮窗 */
  FLOATING_WINDOW_SHOW: 'floating-window:show',
  /** 关闭 Token 会话悬浮窗 */
  FLOATING_WINDOW_CLOSE: 'floating-window:close',
  FLOATING_WINDOW_RESET_PREFERENCES: 'floating-window:resetPreferences',
  /** 查询 Token 会话悬浮窗是否可见 */
  FLOATING_WINDOW_IS_VISIBLE: 'floating-window:isVisible',
  /** Token 会话悬浮窗显隐变化（主进程 → renderer） */
  FLOATING_WINDOW_VISIBILITY_CHANGED: 'floating-window:visibilityChanged',
  /** 查询 Token 会话悬浮窗是否保持在所有窗口最前面 */
  FLOATING_WINDOW_GET_ALWAYS_ON_TOP: 'floating-window:getAlwaysOnTop',
  /** 设置 Token 会话悬浮窗是否保持在所有窗口最前面 */
  FLOATING_WINDOW_SET_ALWAYS_ON_TOP: 'floating-window:setAlwaysOnTop',
  FLOATING_WINDOW_GET_COLLAPSED: 'floating-window:getCollapsed',
  FLOATING_WINDOW_RESIZE_HANDLES: 'floating-window:resize-handles',
  FLOATING_WINDOW_BEGIN_RESIZE: 'floating-window:begin-resize',
  FLOATING_WINDOW_SET_COLLAPSED: 'floating-window:setCollapsed',
  FLOATING_WINDOW_EDGE_GET: 'floating-window:edge:get',
  FLOATING_WINDOW_EDGE_SET: 'floating-window:edge:set',
  FLOATING_WINDOW_EDGE_REVEAL: 'floating-window:edge:reveal',
  FLOATING_WINDOW_EDGE_CHANGED: 'floating-window:edge:changed',
  FLOATING_WINDOW_EDGE_INTERACTION: 'floating-window:edge:interaction',
  FLOATING_WINDOW_EDGE_MOTION_DONE: 'floating-window:edge:motion-done',
  FLOATING_WINDOW_OPEN_WORKSPACE: 'floating-window:openWorkspace',
  WORKSPACE_NAVIGATION_PENDING: 'workspace:navigationPending',
  WORKSPACE_NAVIGATION_TAKE: 'workspace:navigationTake',
  /** 检查更新（向 com 后端 latest.yml 拉取并对比版本） */
  UPDATE_CHECK: 'update:check',
  /** 下载更新（autoDownload=false 时由用户手动触发） */
  UPDATE_DOWNLOAD: 'update:download',
  UPDATE_STATE: 'update:state',
  UPDATE_PAUSE: 'update:pause',
  UPDATE_RESUME: 'update:resume',
  /** 退出应用并安装已下载的更新 */
  UPDATE_INSTALL: 'update:install',
  /** updater 事件推送通道（主进程 webContents.send → renderer ipcRenderer.on） */
  UPDATE_EVENT: 'updater:event',

  DIAGNOSTICS_RENDERER_ERROR: 'diagnostics:renderer-error',
  DIAGNOSTICS_UPLOAD: 'diagnostics:upload',
  DIAGNOSTICS_UPLOAD_STATE: 'diagnostics:upload-state',
  DIAGNOSTICS_UPLOAD_STATE_CHANGED: 'diagnostics:upload-state-changed',
  DIAGNOSTICS_OPEN_LOGS: 'diagnostics:open-logs',

  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  /** 查询当前登录状态（返回 token 或 null） */
  AUTH_STATUS: 'auth:status',
  AUTH_SESSION: 'auth:session',
  DESKTOP_FEEDBACK_SUBMIT: 'desktop:feedback:submit',
  /** 登录成功通知（主进程 → renderer，单向推送） */
  AUTH_LOGIN_SUCCESS: 'auth:login-success',
  AUTH_LOGOUT_EVENT: 'auth:logout-event',
  ANNOUNCEMENTS_CHANGED: 'announcements:changed',
  AGENT_HEARTBEAT_WAKE: 'agent-heartbeat:wake',

  CUSTOM_MESSAGES_LIST: 'custom-messages:list',
  CUSTOM_MESSAGE_RECEIPT_QUEUE: 'custom-message-receipt:queue',
} as const

/** 所有合法的 IPC 通道名（用于 preload 侧类型收窄） */
export type IpcChannel = (typeof IPC)[keyof typeof IPC]
