/**
 * API 层 barrel — 统一入口
 *
 * 调用方使用：
 *   import api, { ohmytokenApi, getInsightsPage, getAllPlans } from '@/api'
 *
 * 内部分层：
 *   - ipc/  本地 IPC（Electron 主进程，包装 window.api.*）
 *   - http/ 远程 HTTP（ohmytokencom 后端，axios 实例）
 */

// IPC：默认 export（保持 AgentPage 的 `import api from '@/api'` 不变）
export { default } from './ipc'
export { api } from './ipc'

// HTTP：命名 export
export { ohmytokenApi } from './http'

// 业务模块（HTTP）
export {
  getInsightDetail,
  getInsightsPage,
  type InsightDetail,
  type InsightItem,
  type InsightTag,
  type InsightPageParams,
  type InsightPageResult,
} from './http/insight'
export { getAllPlans } from './http/plan'
export { getAgentDownloads, type AgentDownloadItem } from './http/agent-download'
