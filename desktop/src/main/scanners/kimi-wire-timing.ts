import type { TokenUsageApiCall } from './types'

/** 兼容 step.end 在用量结算之前或之后落盘；后写的 step 必须核对请求归属。 */
export function kimiWireGenerationTiming(
  completedStep: Record<string, unknown> | undefined,
  settlement: Record<string, unknown>,
  request?: Record<string, unknown>,
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
  const stepAtMs = nonnegativeNumber(completedStep.time)
  const settledAtMs = nonnegativeNumber(settlement.time)
  if (
    stepAtMs === undefined ||
    !Number.isSafeInteger(stepAtMs) ||
    stepAtMs <= 0 ||
    settledAtMs === undefined ||
    !Number.isSafeInteger(settledAtMs) ||
    settledAtMs <= 0
  )
    return undefined
  const usageFirst = request !== undefined || settledAtMs < stepAtMs
  const startedAtMs = nonnegativeNumber(request?.time)
  if (usageFirst) {
    // 新版先结算模型用量，工具/交互结束后才写 step.end；不能把这段等待计入流时长。
    if (
      request?.type !== 'llm.request' ||
      (request.kind !== undefined && request.kind !== 'loop' && request.kind !== 'turn') ||
      startedAtMs === undefined ||
      !Number.isSafeInteger(startedAtMs) ||
      startedAtMs <= 0 ||
      startedAtMs > settledAtMs ||
      stepAtMs < settledAtMs ||
      request.turnStep !== `${step.turnId}.${step.step}` ||
      typeof request.model !== 'string' ||
      request.model !== settlement.model
    )
      return undefined
  } else if (settledAtMs - stepAtMs > 1000) return undefined
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
  if (
    request?.agentId !== undefined &&
    [completedStep.agentId, step.agentId, settlement.agentId].some(
      (agentId) => agentId !== undefined && agentId !== request.agentId,
    )
  )
    return undefined
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
  if (
    usageFirst &&
    (timeToFirstTokenMs ?? 0) + (streamDurationMs ?? 0) > settledAtMs - startedAtMs! + 1000
  )
    return undefined
  return {
    completedAtMs: usageFirst ? settledAtMs : stepAtMs,
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
