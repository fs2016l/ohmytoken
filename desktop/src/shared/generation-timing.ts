import type { GenerationTiming, LatestGeneration, TokenUsageApiCall } from './models'

/** 缺少边界的指标保持缺失，不能用零值补齐。 */
export function normalizeGenerationTiming(value: unknown): GenerationTiming | undefined {
  if (!value || typeof value !== 'object') return undefined
  const timing = value as GenerationTiming
  if (timing.timeSource !== undefined && timing.timeSource !== 'recorded') return undefined
  if (timing.speedKind !== undefined && timing.speedKind !== 'response-estimate') return undefined
  if (
    timing.apiCallId !== undefined &&
    (typeof timing.apiCallId !== 'string' || !timing.apiCallId || timing.apiCallId.length > 2048)
  )
    return undefined
  if (!Number.isSafeInteger(timing.completedAtMs) || timing.completedAtMs <= 0) return undefined
  if (
    timing.generatedTokens !== undefined &&
    (!Number.isSafeInteger(timing.generatedTokens) || timing.generatedTokens < 0)
  )
    return undefined
  const result: GenerationTiming = { completedAtMs: timing.completedAtMs }
  if (timing.apiCallId !== undefined) result.apiCallId = timing.apiCallId
  if (timing.timeSource === 'recorded') result.timeSource = 'recorded'
  if (timing.speedKind === 'response-estimate') {
    if (
      timing.streamDurationMs !== undefined ||
      !Number.isFinite(timing.responseDurationMs) ||
      timing.responseDurationMs! <= 0
    )
      return undefined
    result.speedKind = 'response-estimate'
    result.responseDurationMs = timing.responseDurationMs
  } else if (timing.responseDurationMs !== undefined) return undefined
  if (Number.isFinite(timing.timeToFirstTokenMs) && timing.timeToFirstTokenMs! >= 0)
    result.timeToFirstTokenMs = timing.timeToFirstTokenMs
  if (Number.isFinite(timing.streamDurationMs) && timing.streamDurationMs! > 0)
    result.streamDurationMs = timing.streamDurationMs
  if (Number.isSafeInteger(timing.generatedTokens) && timing.generatedTokens! >= 0)
    result.generatedTokens = timing.generatedTokens
  return result.timeToFirstTokenMs !== undefined ||
    result.streamDurationMs !== undefined ||
    result.responseDurationMs !== undefined
    ? result
    : undefined
}

export function generationSample(call: TokenUsageApiCall): LatestGeneration | undefined {
  const timing = normalizeGenerationTiming(call.generationTiming)
  if (!timing) return undefined
  const tokens = timing.generatedTokens ?? call.outputTokens + call.reasoningTokens
  const duration = timing.responseDurationMs ?? timing.streamDurationMs
  const calculated = duration && tokens > 0 ? (tokens * 1000) / duration : undefined
  const speed = calculated && Number.isFinite(calculated) ? calculated : undefined
  if (timing.timeToFirstTokenMs === undefined && speed === undefined) return undefined
  return {
    apiCallId: timing.apiCallId ?? call.apiCallId,
    sessionId: call.sessionId,
    model: call.model,
    completedAtMs: timing.completedAtMs,
    ...(timing.timeSource === 'recorded' ? { timeSource: timing.timeSource } : {}),
    ...(timing.speedKind === 'response-estimate'
      ? {
          speedKind: timing.speedKind,
          responseDurationMs: timing.responseDurationMs,
          generatedTokens: tokens,
        }
      : {}),
    ...(timing.timeToFirstTokenMs !== undefined
      ? { timeToFirstTokenMs: timing.timeToFirstTokenMs }
      : {}),
    ...(timing.streamDurationMs !== undefined
      ? { streamDurationMs: timing.streamDurationMs, generatedTokens: tokens }
      : {}),
    ...(speed && Number.isFinite(speed) ? { tokensPerSecond: speed } : {}),
  }
}

/** 按调用完成时间选择；不受用量事件的入库顺序、日期或模型分组影响。 */
export function latestGeneration(
  previous: LatestGeneration | undefined,
  next: LatestGeneration | undefined,
): LatestGeneration | undefined {
  if (!next) return previous
  if (!previous) return next
  // 同一次调用取得真实流计时后，不让较晚读到的估算退化已有证据。
  if (previous.sessionId === next.sessionId && previous.apiCallId === next.apiCallId) {
    if (previous.streamDurationMs && next.speedKind === 'response-estimate') return previous
    if (next.streamDurationMs && previous.speedKind === 'response-estimate') return next
  }
  if (next.completedAtMs !== previous.completedAtMs)
    return next.completedAtMs > previous.completedAtMs ? next : previous
  return JSON.stringify([next.sessionId, next.apiCallId]) >=
    JSON.stringify([previous.sessionId, previous.apiCallId])
    ? next
    : previous
}

export function parseLatestGeneration(
  value: string | null | undefined,
): LatestGeneration | undefined {
  if (!value) return undefined
  try {
    return normalizeLatestGeneration(JSON.parse(value))
  } catch {
    return undefined
  }
}

export function normalizeLatestGeneration(value: unknown): LatestGeneration | undefined {
  const sample = value as LatestGeneration
  if (
    !sample ||
    typeof sample.apiCallId !== 'string' ||
    !sample.apiCallId ||
    sample.apiCallId.length > 2048 ||
    typeof sample.sessionId !== 'string' ||
    !sample.sessionId ||
    sample.sessionId.length > 2048 ||
    typeof sample.model !== 'string' ||
    sample.model.length > 1024 ||
    !Number.isSafeInteger(sample.completedAtMs) ||
    sample.completedAtMs <= 0
  )
    return undefined
  if (sample.timeSource !== undefined && sample.timeSource !== 'recorded') return undefined
  if (sample.speedKind !== undefined && sample.speedKind !== 'response-estimate') return undefined
  if (sample.speedKind === 'response-estimate') {
    if (
      sample.streamDurationMs !== undefined ||
      !Number.isFinite(sample.responseDurationMs) ||
      sample.responseDurationMs! <= 0
    )
      return undefined
  } else if (sample.responseDurationMs !== undefined) return undefined
  const ttft = sample.timeToFirstTokenMs
  const speed = sample.tokensPerSecond
  if (!(Number.isFinite(ttft) && ttft! >= 0) && !(Number.isFinite(speed) && speed! > 0))
    return undefined
  return {
    apiCallId: sample.apiCallId,
    sessionId: sample.sessionId,
    model: sample.model,
    completedAtMs: sample.completedAtMs,
    ...(sample.timeSource === 'recorded' ? { timeSource: sample.timeSource } : {}),
    ...(sample.speedKind === 'response-estimate'
      ? { speedKind: sample.speedKind, responseDurationMs: sample.responseDurationMs }
      : {}),
    ...(Number.isFinite(ttft) && ttft! >= 0 ? { timeToFirstTokenMs: ttft } : {}),
    ...(Number.isFinite(sample.streamDurationMs) && sample.streamDurationMs! > 0
      ? { streamDurationMs: sample.streamDurationMs }
      : {}),
    ...(Number.isSafeInteger(sample.generatedTokens) && sample.generatedTokens! >= 0
      ? { generatedTokens: sample.generatedTokens }
      : {}),
    ...(Number.isFinite(speed) && speed! > 0 ? { tokensPerSecond: speed } : {}),
  }
}
