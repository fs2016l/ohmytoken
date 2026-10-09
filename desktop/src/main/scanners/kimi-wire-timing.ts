import type { TokenUsageApiCall } from './types'

/** step.end 已带模型的测量结果；仅与相邻同一份用量结算关联。 */
export function kimiWireGenerationTiming(
  completedStep: Record<string, unknown> | undefined,
  settlement: Record<string, unknown>,
): TokenUsageApiCall['generationTiming'] {
  if (!completedStep || !isObject(completedStep.event)) return undefined
  const step = completedStep.event
  if (
    completedStep.type !== 'context.append_loop_event' ||
    step.type !== 'step.end' ||
    settlement.type !== 'usage.record' ||
    settlement.usageScope === 'session' ||
    !isObject(step.usage) ||
    !isObject(settlement.usage)
  )
    return undefined
  const completedAtMs = nonnegativeNumber(completedStep.time)
  const settledAtMs = nonnegativeNumber(settlement.time)
  if (
    completedAtMs === undefined ||
    !Number.isSafeInteger(completedAtMs) ||
    completedAtMs <= 0 ||
    settledAtMs === undefined ||
    settledAtMs < completedAtMs ||
    settledAtMs - completedAtMs > 1000
  )
    return undefined
  for (const key of ['inputOther', 'output', 'inputCacheRead', 'inputCacheCreation']) {
    const generated = nonnegativeNumber(step.usage[key] ?? 0)
    const accounted = nonnegativeNumber(settlement.usage[key] ?? 0)
    if (generated === undefined || accounted === undefined || generated !== accounted)
      return undefined
  }
  // 新协议若提供身份则同时核对；旧 wire 只在相邻结算中提供 time + usage。
  for (const key of ['agentId', 'turnId', 'messageId']) {
    const source = completedStep[key] ?? step[key]
    if (source !== undefined && settlement[key] !== undefined && source !== settlement[key])
      return undefined
  }
  const timeToFirstTokenMs = nonnegativeNumber(step.llmFirstTokenLatencyMs)
  const streamDurationMs = nonnegativeNumber(step.llmStreamDurationMs)
  const generatedTokens = nonnegativeNumber(step.usage.output ?? 0)
  for (const key of [
    'llmRequestBuildMs',
    'llmServerFirstTokenMs',
    'llmServerDecodeMs',
    'llmClientConsumeMs',
    'llmClientBlockedMs',
  ])
    if (step[key] !== undefined && nonnegativeNumber(step[key]) === undefined) return undefined
  if (
    (step.llmFirstTokenLatencyMs !== undefined && timeToFirstTokenMs === undefined) ||
    (step.llmStreamDurationMs !== undefined && streamDurationMs === undefined) ||
    !Number.isSafeInteger(generatedTokens) ||
    (timeToFirstTokenMs === undefined && !(streamDurationMs && streamDurationMs > 0))
  )
    return undefined
  return {
    completedAtMs,
    ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
    ...(streamDurationMs && streamDurationMs > 0 ? { streamDurationMs } : {}),
    generatedTokens,
  }
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
