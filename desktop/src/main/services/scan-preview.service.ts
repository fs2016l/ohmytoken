import { readUsageHours } from './session-usage-trend'
import type { ScannerUsageDetails, TokenUsageRecord } from '../../shared/models'
import type { ScanHourlyPreview, ScanPreview } from '../../shared/scan-progress'
import { usageCallTime } from './usage-call-time'
import { listDailyAgentModelAggregates } from './usage-detail-storage.service'
import { openDatabase } from './sqlite-storage.service'

export class ScanPreviewAccumulator {
  private readonly daily = new Map<string, TokenUsageRecord>()
  private readonly hourly = new Map<string, ScanHourlyPreview>()
  private calls = 0
  private readonly retainedAgents: string[]

  constructor(replacedAgents: string[], retainHistory = true) {
    if (!retainHistory) {
      this.retainedAgents = []
      return
    }
    const replacing = new Set(replacedAgents)
    const retained = listDailyAgentModelAggregates('2020-01-01', '2099-12-31').filter(
      (row) => !replacing.has(row.agent),
    )
    this.retainedAgents = [...new Set(retained.map((row) => row.agent))]
    for (const row of retained)
      this.daily.set(JSON.stringify([row.agent, row.date, row.model]), row)
    if (!this.retainedAgents.length) return
    for (const item of readUsageHours(openDatabase())) {
      if (!this.retainedAgents.includes(item.agent)) continue
      const { agent, date, model, hour, totalTokens, calls } = item
      const key = JSON.stringify([agent, date, model, hour])
      const row = this.hourly.get(key) ?? { agent, date, model, hour, totalTokens: 0 }
      row.totalTokens += totalTokens
      this.hourly.set(key, row)
      this.calls += calls
    }
  }

  /** 并行来源互不重叠，每个来源的已校验摘要只接收一次。 */
  merge(preview: ScanPreview): void {
    for (const row of preview.records) {
      const key = JSON.stringify([row.agent, row.date, row.model])
      if (this.daily.has(key)) throw new Error('扫描摘要包含重复来源')
      this.daily.set(key, { ...row })
    }
    for (const row of preview.hourly) {
      const key = JSON.stringify([row.agent, row.date, row.model, row.hour])
      if (this.hourly.has(key)) throw new Error('扫描小时摘要包含重复来源')
      this.hourly.set(key, { ...row })
    }
    this.calls += preview.apiCalls
  }

  add(details: ScannerUsageDetails): void {
    for (const call of details.apiCalls) {
      const { date, hour } = usageCallTime(call)
      const key = JSON.stringify([call.agent, date, call.model])
      const row = this.daily.get(key) ?? {
        agent: call.agent,
        date,
        model: call.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        totalTokens: 0,
        cost: 0,
      }
      for (const field of [
        'inputTokens',
        'outputTokens',
        'cacheReadTokens',
        'cacheWriteTokens',
        'reasoningTokens',
        'totalTokens',
      ] as const) {
        row[field] += call[field]
      }
      this.daily.set(key, row)
      const hourKey = JSON.stringify([call.agent, date, call.model, hour])
      const hourRow = this.hourly.get(hourKey) ?? {
        agent: call.agent,
        model: call.model,
        date,
        hour,
        totalTokens: 0,
      }
      hourRow.totalTokens += call.totalTokens
      this.hourly.set(hourKey, hourRow)
      this.calls++
    }
  }

  snapshot(complete = false): ScanPreview {
    return {
      records: [...this.daily.values()].map((row) => ({ ...row })),
      hourly: [...this.hourly.values()].map((row) => ({ ...row })),
      apiCalls: this.calls,
      complete,
      retainedAgents: this.retainedAgents,
    }
  }
}
