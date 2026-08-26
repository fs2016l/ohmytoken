import type {
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  TokenUsageSession,
} from '../../shared/models'

export interface TokenBuckets {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

type TokenBucketSource = {
  inputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
  reasoningTokens?: unknown
}

/** 将来源计数收敛为非负安全整数；非法值按 0 处理。 */
export function tokenCount(value: unknown): number {
  let parsed = 0
  if (typeof value === 'number') parsed = value
  else if (typeof value === 'bigint') parsed = Number(value)
  else if (typeof value === 'string' && value.trim()) parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed))
}

/** 创建内部互斥分桶；总量始终由五个分项相加得到。 */
export function tokenBuckets(source: TokenBucketSource): TokenBuckets {
  const inputTokens = tokenCount(source.inputTokens)
  const outputTokens = tokenCount(source.outputTokens)
  const cacheReadTokens = tokenCount(source.cacheReadTokens)
  const cacheWriteTokens = tokenCount(source.cacheWriteTokens)
  const reasoningTokens = tokenCount(source.reasoningTokens)
  const totalTokens = safeTokenSum(
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  )
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
  }
}

/**
 * 将“输入含缓存、输出含推理”的来源字段拆成互斥分桶。
 * cacheWrite 与 cacheRead 都被视为 rawInput 的子集。
 */
export function splitInclusiveTokenBuckets(source: {
  inputTokens: unknown
  outputTokens: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
  reasoningTokens?: unknown
}): TokenBuckets {
  const rawInput = tokenCount(source.inputTokens)
  const rawOutput = tokenCount(source.outputTokens)
  const cacheReadTokens = tokenCount(source.cacheReadTokens)
  const cacheWriteTokens = tokenCount(source.cacheWriteTokens)
  const reasoningTokens = tokenCount(source.reasoningTokens)
  const cachedInput = Math.min(rawInput, safeTokenSum(cacheReadTokens, cacheWriteTokens))
  const reasoningOutput = Math.min(rawOutput, reasoningTokens)
  return tokenBuckets({
    inputTokens: rawInput - cachedInput,
    outputTokens: rawOutput - reasoningOutput,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  })
}

export function tokenBucketSum(
  value: Pick<
    TokenBuckets,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'
  >,
): number {
  return safeTokenSum(
    value.inputTokens,
    value.outputTokens,
    value.cacheReadTokens,
    value.cacheWriteTokens,
    value.reasoningTokens,
  )
}

/** 扫描提交前的最后一道统计闸门，阻止负数、重叠总量和不稳定主键落库。 */
export function validateScannerUsageDetails(agent: string, details: ScannerUsageDetails): void {
  const ids = new Set<string>()
  for (const call of details.apiCalls) {
    validateIdentity(agent, call, 'API 调用')
    if (!call.apiCallId.trim()) throw new Error(`${agent} API 调用缺少 apiCallId`)
    if (!call.sessionId.trim()) throw new Error(`${agent} API 调用缺少 sessionId`)
    if (ids.has(call.apiCallId)) {
      throw new Error(`${agent} API 调用主键重复: ${call.apiCallId}`)
    }
    ids.add(call.apiCallId)
    validateBuckets(agent, call, `API 调用 ${call.apiCallId}`)
  }

  for (const session of details.sessions) {
    validateIdentity(agent, session, '会话')
    if (!session.sessionId.trim()) throw new Error(`${agent} 会话缺少 sessionId`)
    validateBuckets(agent, session, `会话 ${session.sessionId}`)
  }

  for (const record of details.records) {
    validateIdentity(agent, record, '日汇总')
    validateBuckets(agent, record, `日汇总 ${record.date}/${record.model}`)
  }

  if (details.apiCalls.length === 0) return
  assertTotalsEqual(
    agent,
    'API 调用与会话汇总',
    sumUsage(details.apiCalls),
    sumUsage(details.sessions),
  )
  assertTotalsEqual(
    agent,
    'API 调用与日汇总',
    sumUsage(details.apiCalls),
    sumUsage(details.records),
  )
}

type UsageWithAgent = TokenUsageApiCall | TokenUsageSession | TokenUsageRecord

function validateIdentity(agent: string, value: UsageWithAgent, label: string): void {
  if (value.agent !== agent) {
    throw new Error(`${agent} ${label}的 agent 字段不一致: ${value.agent}`)
  }
  if (!value.model.trim()) throw new Error(`${agent} ${label}缺少 model`)
}

function validateBuckets(agent: string, value: TokenBuckets, label: string): void {
  for (const field of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'totalTokens',
  ] as const) {
    const count = value[field]
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`${agent} ${label}的 ${field} 不是非负安全整数: ${count}`)
    }
  }
  const expected = tokenBucketSum(value)
  if (value.totalTokens !== expected) {
    throw new Error(`${agent} ${label}的 token 总量不守恒: ${value.totalTokens} != ${expected}`)
  }
}

function sumUsage(values: TokenBuckets[]): TokenBuckets {
  return values.reduce<TokenBuckets>(
    (sum, value) => ({
      inputTokens: safeTokenSum(sum.inputTokens, value.inputTokens),
      outputTokens: safeTokenSum(sum.outputTokens, value.outputTokens),
      cacheReadTokens: safeTokenSum(sum.cacheReadTokens, value.cacheReadTokens),
      cacheWriteTokens: safeTokenSum(sum.cacheWriteTokens, value.cacheWriteTokens),
      reasoningTokens: safeTokenSum(sum.reasoningTokens, value.reasoningTokens),
      totalTokens: safeTokenSum(sum.totalTokens, value.totalTokens),
    }),
    tokenBuckets({}),
  )
}

function assertTotalsEqual(
  agent: string,
  label: string,
  left: TokenBuckets,
  right: TokenBuckets,
): void {
  for (const field of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'totalTokens',
  ] as const) {
    if (left[field] !== right[field]) {
      throw new Error(`${agent} ${label}不一致: ${field}=${left[field]}/${right[field]}`)
    }
  }
}

function safeTokenSum(...values: number[]): number {
  const sum = values.reduce((total, value) => total + value, 0)
  if (!Number.isSafeInteger(sum) || sum < 0) {
    throw new Error(`token 计数超出安全整数范围: ${sum}`)
  }
  return sum
}
