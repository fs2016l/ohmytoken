import { deserialize, serialize } from 'node:v8'
import type { TokenUsageApiCall, TokenUsageSession } from '../../shared/models'
import type { UsageCostGroup, UsageCostRollup, UsageEvidence } from '../../shared/usage-cost'
import { summarizeCostGroups } from '../../shared/cost-rollup'
import { estimateUsageCost } from '../cost/estimate-cost'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { evidenceForCall, parseUsageEvidence } from '../cost/usage-evidence'
import { eventTimestampMs } from '../scanners/incremental-utils'
import { usageCallTime } from './usage-call-time'
import { encodeTurnData } from './session-turn-codec'
import { normalizeGenerationTiming } from '../../shared/generation-timing'
import type { GenerationTiming } from '../../shared/models'

export const TOKEN_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'totalTokens',
] as const
export type SecondUsage = [
  time: number,
  hour: number,
  input: number,
  output: number,
  read: number,
  write: number,
  reasoning: number,
  total: number,
  calls: number,
  project?: string,
]
type MeterEvent = [
  id: string,
  time: string,
  raw: string,
  hour: number,
  input: number,
  output: number,
  read: number,
  write: number,
  reasoning: number,
  total: number,
  evidence: number,
  context: number,
  timing?: GenerationTiming,
]
interface MeterData {
  version: 1 | 2 | 3
  evidence: Array<UsageEvidence | null>
  contexts: Array<Array<string | undefined>>
  events: MeterEvent[]
}
export interface SessionDataRow {
  agent: string
  session_id: string
  date: string
  model: string
  first_ms: number
  last_ms: number
  meter_data: Buffer
  second_data: Buffer
  turn_data?: Buffer | null
}

export function sessionUsageKey(sessionId: string, date: string, model: string): string {
  return JSON.stringify([sessionId, date, model])
}

/** 按会话保存计量数组，重复的模型与计费证据只保存一次。 */
export function encodeMeterData(calls: readonly TokenUsageApiCall[]): Buffer {
  const evidence: MeterData['evidence'] = []
  const indexes = new Map<string, number>()
  const contexts: MeterData['contexts'] = []
  const contextIndexes = new Map<string, number>()
  const events = calls.map((call): MeterEvent => {
    const key = JSON.stringify(call.evidence ?? null)
    let index = indexes.get(key)
    if (index === undefined) {
      index = evidence.length
      indexes.set(key, index)
      evidence.push(parseUsageEvidence(key) ?? null)
    }
    const context = [
      call.projectPath,
      call.parentSessionId,
      call.rootSessionId,
      call.subAgentName,
      call.turn?.id,
      call.turn ? (call.turn.userInitiated ? 'user' : 'agent') : undefined,
      call.turn?.complete === false ? 'partial' : undefined,
    ]
    const contextKey = JSON.stringify(context)
    let contextIndex = contextIndexes.get(contextKey)
    if (contextIndex === undefined) {
      contextIndex = contexts.length
      contextIndexes.set(contextKey, contextIndex)
      contexts.push(context)
    }
    return [
      call.apiCallId,
      call.timestamp,
      call.rawTimestamp ?? '',
      call.hour,
      call.inputTokens,
      call.outputTokens,
      call.cacheReadTokens,
      call.cacheWriteTokens,
      call.reasoningTokens,
      call.totalTokens,
      index,
      contextIndex,
    ] as MeterEvent
  })
  return serialize({ version: 3, evidence, contexts, events } satisfies MeterData)
}

export function decodeMeterData(row: SessionDataRow): TokenUsageApiCall[] {
  const data = deserialize(row.meter_data) as MeterData
  if (
    ![1, 2, 3].includes(data.version) ||
    !Array.isArray(data.events) ||
    !Array.isArray(data.evidence)
  )
    throw new Error('会话计量数据格式不受支持')
  return data.events.map((event) => ({
    agent: row.agent,
    sessionId: row.session_id,
    date: row.date,
    model: row.model,
    apiCallId: event[0],
    timestamp: event[1],
    rawTimestamp: event[2],
    hour: event[3],
    inputTokens: event[4],
    outputTokens: event[5],
    cacheReadTokens: event[6],
    cacheWriteTokens: event[7],
    reasoningTokens: event[8],
    totalTokens: event[9],
    ...(data.version === 2 && normalizeGenerationTiming(event[12])
      ? { generationTiming: normalizeGenerationTiming(event[12]) }
      : {}),
    evidence: data.evidence[event[10]] ?? undefined,
    projectPath: data.contexts[event[11]]?.[0],
    parentSessionId: data.contexts[event[11]]?.[1],
    rootSessionId: data.contexts[event[11]]?.[2],
    subAgentName: data.contexts[event[11]]?.[3],
    ...(data.contexts[event[11]]?.[4]
      ? {
          turn: {
            id: data.contexts[event[11]][4]!,
            userInitiated: data.contexts[event[11]][5] === 'user',
            ...(data.contexts[event[11]][6] === 'partial' ? { complete: false as const } : {}),
          },
        }
      : {}),
  }))
}

export function decodeSecondData(data: Buffer): SecondUsage[] {
  const parsed = deserialize(data) as { version: number; seconds: SecondUsage[] }
  if (parsed.version !== 1 || !Array.isArray(parsed.seconds))
    throw new Error('会话秒级数据格式不受支持')
  return parsed.seconds
}

export interface SessionUsageAggregate {
  session: TokenUsageSession
  costs: UsageCostRollup
  data: SessionDataRow
  projects: Array<{
    projectPath: string
    tokens: number[]
    apiCallCount: number
    apiCallCountComplete: boolean
    costs: UsageCostRollup
    turnData: Buffer
    firstMs: number
    lastMs: number
  }>
}

/** 每次调用独立计价，再累计到会话；请求大小、缓存时长和峰谷规则不会被平均。 */
export function aggregateSessionUsage(
  calls: readonly TokenUsageApiCall[],
  metadata?: Partial<TokenUsageSession>,
): SessionUsageAggregate {
  if (!calls.length) throw new Error('空会话不能生成用量汇总')
  const first = calls[0]
  const session: TokenUsageSession = {
    agent: first.agent,
    sessionId: first.sessionId,
    date: usageCallTime(first).date,
    model: first.model,
    startedAt: '',
    endedAt: '',
    apiCallCount: calls.length,
    apiCallCountComplete: calls.every((call) => evidenceForCall(call).granularity !== 'aggregate'),
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    title: metadata?.title,
  }
  const groups = new Map<string, UsageCostGroup>()
  const seconds = new Map<string, SecondUsage>()
  const projects = new Map<
    string,
    {
      tokens: number[]
      calls: TokenUsageApiCall[]
      groups: Map<string, UsageCostGroup>
      complete: boolean
      firstMs: number
      lastMs: number
      legacy: number
    }
  >()
  let firstMs = 0,
    lastMs = 0,
    legacy = 0
  for (const call of calls) {
    const time = usageCallTime(call)
    const ms = eventTimestampMs(call)
    if (ms > 0) {
      firstMs = firstMs ? Math.min(firstMs, ms) : ms
      lastMs = Math.max(lastMs, ms)
    }
    if (!session.startedAt || time.timestamp < session.startedAt) session.startedAt = time.timestamp
    if (time.timestamp > session.endedAt) session.endedAt = time.timestamp
    for (const field of TOKEN_FIELDS) {
      session[field] += call[field]
      if (!Number.isSafeInteger(session[field])) throw new Error('会话 Token 超出安全整数范围')
    }
    for (const field of [
      'parentSessionId',
      'rootSessionId',
      'subAgentName',
      'projectPath',
    ] as const) {
      const value = call[field] || (field === 'rootSessionId' ? call.sessionId : '')
      if (value && value > (session[field] ?? '')) session[field] = value
    }
    const at = ms > 0 ? Math.floor(ms / 1000) * 1000 : 0
    const project = call.projectPath ?? ''
    const key = JSON.stringify([at, time.hour, project])
    const second: SecondUsage = seconds.get(key) ?? [at, time.hour, 0, 0, 0, 0, 0, 0, 0, project]
    TOKEN_FIELDS.forEach((field, index) => {
      second[index + 2] = Number(second[index + 2]) + call[field]
    })
    second[8]++
    seconds.set(key, second)
    const projectData = projects.get(project) ?? {
      tokens: [0, 0, 0, 0, 0, 0],
      calls: [],
      groups: new Map<string, UsageCostGroup>(),
      complete: true,
      firstMs: 0,
      lastMs: 0,
      legacy: 0,
    }
    TOKEN_FIELDS.forEach((field, index) => {
      projectData.tokens[index] += call[field]
    })
    projectData.calls.push(call)
    projectData.complete &&= evidenceForCall(call).granularity !== 'aggregate'
    if (ms > 0) {
      projectData.firstMs = projectData.firstMs ? Math.min(projectData.firstMs, ms) : ms
      projectData.lastMs = Math.max(projectData.lastMs, ms)
    }
    projects.set(project, projectData)
    const normalized = {
      ...call,
      timestamp: time.timestamp,
      date: time.date,
      hour: time.hour,
      evidence: call.evidence ? parseUsageEvidence(JSON.stringify(call.evidence)) : undefined,
    }
    const { min, max, reportedCost: _reported, ...assessment } = estimateUsageCost(normalized)
    if (!normalized.evidence) legacy++
    const groupKey = JSON.stringify(assessment)
    if (!normalized.evidence) projectData.legacy++
    for (const target of [groups, projectData.groups]) {
      const group = target.get(groupKey) ?? {
        ...assessment,
        agent: call.agent,
        model: call.model,
        records: 0,
        tokens: 0,
      }
      group.records++
      group.tokens += call.totalTokens
      if (min !== undefined) group.min = (group.min ?? 0) + min
      if (max !== undefined) group.max = (group.max ?? 0) + max
      target.set(groupKey, group)
    }
  }
  for (const field of ['parentSessionId', 'rootSessionId', 'subAgentName', 'projectPath'] as const)
    if (metadata?.[field]) session[field] = metadata[field]
  const costs = summarizeCostGroups([...groups.values()], PRICE_CATALOG_VERSION, legacy)
  return {
    session,
    costs,
    projects: [...projects].map(([projectPath, data]) => ({
      projectPath,
      tokens: data.tokens,
      apiCallCount: data.calls.length,
      apiCallCountComplete: data.complete,
      costs: summarizeCostGroups([...data.groups.values()], PRICE_CATALOG_VERSION, data.legacy),
      turnData: encodeTurnData(data.calls),
      firstMs: data.firstMs,
      lastMs: data.lastMs,
    })),
    data: {
      agent: session.agent,
      session_id: session.sessionId,
      date: session.date,
      model: session.model,
      first_ms: firstMs,
      last_ms: lastMs,
      meter_data: encodeMeterData(calls),
      turn_data: encodeTurnData(calls),
      second_data: serialize({
        version: 1,
        seconds: [...seconds.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
      }),
    },
  }
}
