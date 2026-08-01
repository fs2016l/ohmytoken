/**
 * IPC 通道名常量
 *
 * 主进程 ipcMain.handle 与 preload ipcRenderer.invoke 必须使用同一通道名，
 * 这里集中定义避免拼写不一致。通道名采用 "域:动作" 命名风格，
 * 与原 REST 端点一一对应（见原 Java ApiController）。
 */
export const IPC = {
  /** POST /api/scan → scan.service.performScan */
  SCAN_PERFORM: 'scan:perform',
  /** GET /api/stats/overview → stats.service.getOverview */
  STATS_OVERVIEW: 'stats:overview',
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
  /** GET /api/stats/api-calls → stats.service.getUsageApiCalls */
  STATS_API_CALLS: 'stats:apiCalls',
  /** GET /api/stats/api-records → stats.service.getUsageApiRecords */
  STATS_API_RECORDS: 'stats:apiRecords',
  /** GET /api/stats/hourly → stats.service.getHourlyUsageStats */
  STATS_HOURLY: 'stats:hourly',
  /** 分钟级可缩放趋势 → stats.service.getUsageTrendStats */
  STATS_USAGE_TREND: 'stats:usageTrend',
  /** shell.openExternal —— 外部链接转系统浏览器 */
  APP_OPEN_EXTERNAL: 'app:openExternal',
  /** 获取 ohmytokencom 后端 baseURL（供 renderer axios） */
  APP_GET_OHMYTOKEN_BASE: 'app:getOhmytokenBase',
  /** 从唯一可信 API Base 获取 com 后台下发的公开运行地址。 */
  APP_GET_RUNTIME_CONFIG: 'app:getRuntimeConfig',
  /** 获取当前应用版本号（electron app.getVersion()） */
  APP_GET_VERSION: 'app:getVersion',
  APP_GET_DEVICE_ID: 'app:getDeviceId',
  APP_GET_REQUEST_IDENTITY: 'app:getRequestIdentity',
  TOKEN_PLAN_CREDENTIALS_LIST: 'token-plan:credentials:list',
  /** 加密保存一家厂商的套餐 API Key */
  TOKEN_PLAN_CREDENTIAL_SAVE: 'token-plan:credential:save',
  /** 删除一家厂商的套餐 API Key */
  TOKEN_PLAN_CREDENTIAL_REMOVE: 'token-plan:credential:remove',
  /** 用一家厂商的真实接口查询套餐额度 */
  TOKEN_PLAN_USAGE_QUERY: 'token-plan:usage:query',
  /** 并行刷新所有已配置厂商的套餐额度 */
  TOKEN_PLAN_USAGE_QUERY_ALL: 'token-plan:usage:queryAll',
  /** 打开并聚焦 Token 会话悬浮窗 */
  FLOATING_WINDOW_SHOW: 'floating-window:show',
  /** 关闭 Token 会话悬浮窗 */
  FLOATING_WINDOW_CLOSE: 'floating-window:close',
  /** 查询 Token 会话悬浮窗是否可见 */
  FLOATING_WINDOW_IS_VISIBLE: 'floating-window:isVisible',
  /** 查询 Token 会话悬浮窗是否保持在所有窗口最前面 */
  FLOATING_WINDOW_GET_ALWAYS_ON_TOP: 'floating-window:getAlwaysOnTop',
  /** 设置 Token 会话悬浮窗是否保持在所有窗口最前面 */
  FLOATING_WINDOW_SET_ALWAYS_ON_TOP: 'floating-window:setAlwaysOnTop',
  /** 检查更新（向 com 后端 latest.yml 拉取并对比版本） */
  UPDATE_CHECK: 'update:check',
  /** 下载更新（autoDownload=false 时由用户手动触发） */
  UPDATE_DOWNLOAD: 'update:download',
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
  DESKTOP_MESSAGE_SYNC: 'desktop:message:sync',
  DESKTOP_MESSAGE_EVENT: 'desktop:message:event',
  /** 登录成功通知（主进程 → renderer，单向推送） */
  AUTH_LOGIN_SUCCESS: 'auth:login-success',
  AUTH_LOGOUT_EVENT: 'auth:logout-event',
  /**
   * SSE 服务端推送消息（主进程 → renderer，单向推送）。
   * 携带 { type, ... } 消息体，renderer 据此弹出桌面通知。
   */
  SSE_PUSH_MESSAGE: 'sse:push-message',

  CUSTOM_MESSAGES_LIST: 'custom-messages:list',
  CUSTOM_MESSAGES_CACHE: 'custom-messages:cache',
  CUSTOM_MESSAGES_RECONCILE: 'custom-messages:reconcile',
  CUSTOM_MESSAGE_RECEIPT_QUEUE: 'custom-message-receipt:queue',
  CUSTOM_MESSAGE_RECEIPTS_PENDING: 'custom-message-receipts:pending',
  CUSTOM_MESSAGE_RECEIPT_SENT: 'custom-message-receipt:sent',
  CUSTOM_MESSAGE_RECEIPT_FAILED: 'custom-message-receipt:failed',

  // ===== 通知持久化（notifications 表 CRUD） =====
  /** 查询通知列表（参数 filter: 'all' | 'unread' | 'read'） */
  NOTIFICATIONS_LIST: 'notifications:list',
  /** 标记单条通知为已读（参数 id） */
  NOTIFICATIONS_MARK_READ: 'notifications:markRead',
  /** 标记所有未读通知为已读 */
  NOTIFICATIONS_MARK_ALL_READ: 'notifications:markAllRead',
  /** 删除单条通知（参数 id） */
  NOTIFICATIONS_DELETE: 'notifications:delete',
} as const

/** 所有合法的 IPC 通道名（用于 preload 侧类型收窄） */
export type IpcChannel = (typeof IPC)[keyof typeof IPC]
