/**
 * IPC API 层 — 本地后端走 IPC（Electron 主进程）
 *
 * 保持与 axios 相同的调用签名 api.get/post(url, config) → { data }
 * 这样 AgentPage.vue 等调用方无需改动
 */
import type { ScanOptions } from '@shared/models'

interface MockAxiosResponse<T> {
  data: T
}

type FlatParams = Record<string, string | number | boolean | undefined>

function requireParam(params: FlatParams, name: string): string {
  const value = params[name]
  if (!value) throw new Error(`IPC 路由缺少参数: ${name}`)
  return String(value)
}

function stringParam(params: FlatParams, name: string): string | undefined {
  const value = params[name]
  return value == null || value === '' ? undefined : String(value)
}

function numberParam(params: FlatParams, name: string): number | undefined {
  const value = params[name]
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function rangeParams(params: FlatParams): { from?: string; to?: string } {
  return { from: stringParam(params, 'from'), to: stringParam(params, 'to') }
}

function pageParams(params: FlatParams): { page?: number; pageSize?: number } {
  return { page: numberParam(params, 'page'), pageSize: numberParam(params, 'pageSize') }
}

export const api = {
  async get(url: string, config?: { params?: FlatParams }): Promise<MockAxiosResponse<unknown>> {
    const params: FlatParams = config?.params ?? {}

    // 扫描
    if (url === '/scan') {
      return { data: await window.api.scanPerform({ mode: 'incremental' }) }
    }

    // 统计接口
    if (url === '/stats/overview') {
      return { data: await window.api.getOverview(rangeParams(params)) }
    }
    if (url === '/stats/daily') {
      return { data: await window.api.getDailyStats(rangeParams(params)) }
    }
    if (url === '/stats/model/daily') {
      return { data: await window.api.getDailyModelStats(rangeParams(params)) }
    }
    if (url === '/stats/monthly') {
      return { data: await window.api.getMonthlyStats(rangeParams(params)) }
    }
    if (url === '/stats/model') {
      return { data: await window.api.getModelStats(rangeParams(params)) }
    }
    if (url === '/stats/comparisons') {
      return { data: await window.api.getComparisons() }
    }
    if (url === '/stats/sessions') {
      return {
        data: await window.api.getUsageSessions({
          ...rangeParams(params),
          agent: stringParam(params, 'agent'),
          model: stringParam(params, 'model'),
          rootSessionId: stringParam(params, 'rootSessionId'),
          projectId: stringParam(params, 'projectId'),
          trackedProjectsOnly: params.trackedProjectsOnly === true,
          query: stringParam(params, 'query'),
        }),
      }
    }
    if (url === '/stats/user-sessions') {
      return {
        data: await window.api.getUserUsageSessions({
          ...rangeParams(params),
          ...pageParams(params),
          agent: stringParam(params, 'agent'),
          model: stringParam(params, 'model'),
          rootSessionId: stringParam(params, 'rootSessionId'),
          projectId: stringParam(params, 'projectId'),
          trackedProjectsOnly: params.trackedProjectsOnly === true,
          query: stringParam(params, 'query'),
        }),
      }
    }
    if (url === '/stats/api-calls') {
      return {
        data: await window.api.getUsageApiCalls({
          agent: requireParam(params, 'agent'),
          sessionId: requireParam(params, 'sessionId'),
          model: stringParam(params, 'model'),
          rootSessionId: stringParam(params, 'rootSessionId'),
          projectId: stringParam(params, 'projectId'),
          trackedProjectsOnly: params.trackedProjectsOnly === true,
          ...rangeParams(params),
        }),
      }
    }
    if (url === '/stats/api-records') {
      return {
        data: await window.api.getUsageApiRecords({
          ...rangeParams(params),
          ...pageParams(params),
          agent: stringParam(params, 'agent'),
          sessionId: stringParam(params, 'sessionId'),
          rootSessionId: stringParam(params, 'rootSessionId'),
          model: stringParam(params, 'model'),
          projectId: stringParam(params, 'projectId'),
          trackedProjectsOnly: params.trackedProjectsOnly === true,
        }),
      }
    }
    if (url === '/stats/hourly') {
      return {
        data: await window.api.getHourlyUsageStats({
          date: requireParam(params, 'date'),
          groupBy: params.groupBy === 'model' ? 'model' : 'agent',
        }),
      }
    }
    if (url.startsWith('/stats/agent/')) {
      // L11 修复：提取 agent 路径参数后需 URL 解码（agent 名可能含编码字符）
      const agent = decodeURIComponent(url.replace('/stats/agent/', ''))
      return { data: await window.api.getAgentModelStats({ ...rangeParams(params), agent }) }
    }
    if (url === '/stats/model/agents') {
      return {
        data: await window.api.getModelAgentStats({
          ...rangeParams(params),
          model: requireParam(params, 'model'),
        }),
      }
    }

    throw new Error(`Unknown IPC route: ${url}`)
  },

  async post(url: string, data?: unknown): Promise<MockAxiosResponse<unknown>> {
    if (url === '/scan') {
      return { data: await window.api.scanPerform((data ?? {}) as ScanOptions) }
    }
    throw new Error(`Unknown IPC route: ${url}`)
  },
}

export default api
