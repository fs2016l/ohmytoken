import type {
  GenerationSpeedKind,
  GenerationTiming,
  LatestFirstToken,
  LatestGeneration,
  TokenUsageApiCall,
} from './models'

const SPEED_KINDS: ReadonlySet<unknown> = new Set<GenerationSpeedKind>([
  'response-estimate',
  'stream-estimate',
])

function validTtft(value: unknown): number | undefined {
  return Number.isFinite(value) && (value as number) >= 0 ? (value as number) : undefined
}

/** 缺少边界的指标保持缺失，不能用零值补齐。 */
export function normalizeGenerationTiming(value: unknown): GenerationTiming | undefined {
  if (!value || typeof value !== 'object') return undefined
  const timing = value as GenerationTiming
  if (timing.timeSource !== undefined && timing.timeSource !== 'recorded') return undefined
  if (timing.speedKind !== undefined && !SPEED_KINDS.has(timing.speedKind)) return undefined
  if (timing.ttftKind !== undefined && timing.ttftKind !== 'estimate') return undefined
  if (timing.speedExcluded !== undefined && timing.speedExcluded !== true) return undefined
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
  const ttft = validTtft(timing.timeToFirstTokenMs)
  if (timing.speedExcluded) {
    // 仅首 Token 的调用不能携带任何速度区间，避免被当作速度样本。
    if (
      ttft === undefined ||
      timing.speedKind !== undefined ||
      timing.responseDurationMs !== undefined ||
      timing.streamDurationMs !== undefined
    )
      return undefined
    result.speedExcluded = true
    result.timeToFirstTokenMs = ttft
    if (timing.ttftKind === 'estimate') result.ttftKind = 'estimate'
    return result
  }
  if (timing.speedKind !== undefined) {
    if (
      timing.streamDurationMs !== undefined ||
      !Number.isFinite(timing.responseDurationMs) ||
      timing.responseDurationMs! <= 0
    )
      return undefined
    result.speedKind = timing.speedKind
    result.responseDurationMs = timing.responseDurationMs
  } else if (timing.responseDurationMs !== undefined) return undefined
  if (ttft !== undefined) {
    result.timeToFirstTokenMs = ttft
    if (timing.ttftKind === 'estimate') result.ttftKind = 'estimate'
  }
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
  const identity = {
    apiCallId: timing.apiCallId ?? call.apiCallId,
    sessionId: call.sessionId,
    model: call.model,
    completedAtMs: timing.completedAtMs,
    ...(timing.timeSource === 'recorded' ? { timeSource: timing.timeSource } : {}),
  }
  const ttftKind = timing.ttftKind === 'estimate' ? { ttftKind: timing.ttftKind } : {}
  if (timing.speedExcluded)
    return normalizeLatestGeneration({
      ...identity,
      timeToFirstTokenMs: timing.timeToFirstTokenMs,
      ...ttftKind,
      speedExcluded: true,
    })
  const tokens = timing.generatedTokens ?? call.outputTokens + call.reasoningTokens
  const duration = timing.responseDurationMs ?? timing.streamDurationMs
  const calculated = duration && tokens > 0 ? (tokens * 1000) / duration : undefined
  const speed = calculated && Number.isFinite(calculated) ? calculated : undefined
  if (timing.timeToFirstTokenMs === undefined && speed === undefined) return undefined
  return {
    ...identity,
    ...(timing.speedKind !== undefined
      ? {
          speedKind: timing.speedKind,
          responseDurationMs: timing.responseDurationMs,
          generatedTokens: tokens,
        }
      : {}),
    ...(timing.timeToFirstTokenMs !== undefined
      ? { timeToFirstTokenMs: timing.timeToFirstTokenMs, ...ttftKind }
      : {}),
    ...(timing.streamDurationMs !== undefined
      ? { streamDurationMs: timing.streamDurationMs, generatedTokens: tokens }
      : {}),
    ...(speed && Number.isFinite(speed) ? { tokensPerSecond: speed } : {}),
  }
}

/** 原生流 > 推导流区间 > 响应区间；0 表示没有速度证据。 */
export function generationSpeedRank(sample: LatestGeneration): number {
  if (sample.streamDurationMs) return 3
  if (sample.speedKind === 'stream-estimate') return 2
  if (sample.speedKind === 'response-estimate') return 1
  return 0
}

/** 按调用完成时间选择；不受用量事件的入库顺序、日期或模型分组影响。 */
function latestSpeedSample(
  previous: LatestGeneration | undefined,
  next: LatestGeneration | undefined,
): LatestGeneration | undefined {
  if (!next) return previous
  if (!previous) return next
  // 同一次调用取得更强的速度证据后，不让较晚读到的弱估算退化已有证据。
  if (previous.sessionId === next.sessionId && previous.apiCallId === next.apiCallId) {
    const previousRank = generationSpeedRank(previous)
    const nextRank = generationSpeedRank(next)
    if (previousRank && nextRank && previousRank !== nextRank)
      return previousRank > nextRank ? previous : next
  }
  if (next.completedAtMs !== previous.completedAtMs)
    return next.completedAtMs > previous.completedAtMs ? next : previous
  return JSON.stringify([next.sessionId, next.apiCallId]) >=
    JSON.stringify([previous.sessionId, previous.apiCallId])
    ? next
    : previous
}

export function latestFirstToken(
  previous: LatestFirstToken | undefined,
  next: LatestFirstToken | undefined,
): LatestFirstToken | undefined {
  if (!next) return previous
  if (!previous) return next
  if (next.completedAtMs !== previous.completedAtMs)
    return next.completedAtMs > previous.completedAtMs ? next : previous
  return JSON.stringify([next.sessionId, next.apiCallId]) >=
    JSON.stringify([previous.sessionId, previous.apiCallId])
    ? next
    : previous
}

/** 拆成速度样本和仅首 Token 样本，二者各自按完成时间取最近值。 */
export function splitLatestGeneration(
  sample: LatestGeneration | undefined,
): [LatestGeneration | undefined, LatestFirstToken | undefined] {
  if (!sample) return [undefined, undefined]
  if (sample.speedExcluded)
    return [
      undefined,
      {
        apiCallId: sample.apiCallId,
        sessionId: sample.sessionId,
        model: sample.model,
        completedAtMs: sample.completedAtMs,
        timeToFirstTokenMs: sample.timeToFirstTokenMs!,
        ...(sample.timeSource === 'recorded' ? { timeSource: sample.timeSource } : {}),
        ...(sample.ttftKind === 'estimate' ? { ttftKind: sample.ttftKind } : {}),
      },
    ]
  if (!sample.firstToken) return [sample, undefined]
  const { firstToken, ...main } = sample
  return [main, firstToken]
}

/** 速度样本自身的首 Token，转成可与其他调用独立比较的首字样本。 */
function ownFirstToken(sample: LatestGeneration | undefined): LatestFirstToken | undefined {
  if (!sample || sample.timeToFirstTokenMs === undefined) return undefined
  return {
    apiCallId: sample.apiCallId,
    sessionId: sample.sessionId,
    model: sample.model,
    completedAtMs: sample.completedAtMs,
    timeToFirstTokenMs: sample.timeToFirstTokenMs,
    ...(sample.timeSource === 'recorded' ? { timeSource: sample.timeSource } : {}),
    ...(sample.ttftKind === 'estimate' ? { ttftKind: sample.ttftKind } : {}),
  }
}

/** 样本代表的最近首 Token：另一次调用的首字或速度样本自身的首字，取完成时间更晚者。 */
export function generationFirstToken(
  sample: LatestGeneration | undefined,
): LatestFirstToken | undefined {
  const [main, firstToken] = splitLatestGeneration(sample)
  return latestFirstToken(ownFirstToken(main), firstToken)
}

/**
 * 速度与首 Token 各取最近的有效调用：速度样本自带首字时只另行保留更晚调用的首字；
 * 速度样本缺首字（如首块不是 thinking、以工具调用开头）时沿用最近一次有首字的调用，
 * 它可能更早。没有速度样本时以首字调用作为会话样本。
 */
export function composeLatestGeneration(
  main: LatestGeneration | undefined,
  firstToken: LatestFirstToken | undefined,
): LatestGeneration | undefined {
  if (!main) return firstToken ? { ...firstToken, speedExcluded: true } : undefined
  if (!firstToken) return main
  if (main.timeToFirstTokenMs !== undefined)
    return firstToken.completedAtMs > main.completedAtMs ? { ...main, firstToken } : main
  // 同一调用的首字并回速度样本，不显示成另一次调用。
  if (
    firstToken.apiCallId === main.apiCallId &&
    firstToken.sessionId === main.sessionId &&
    firstToken.completedAtMs === main.completedAtMs
  )
    return {
      ...main,
      timeToFirstTokenMs: firstToken.timeToFirstTokenMs,
      ...(firstToken.ttftKind === 'estimate' ? { ttftKind: firstToken.ttftKind } : {}),
    }
  return { ...main, firstToken }
}

export function latestGeneration(
  previous: LatestGeneration | undefined,
  next: LatestGeneration | undefined,
): LatestGeneration | undefined {
  if (!next) return previous
  if (!previous) return next
  const [previousMain] = splitLatestGeneration(previous)
  const [nextMain] = splitLatestGeneration(next)
  return composeLatestGeneration(
    latestSpeedSample(previousMain, nextMain),
    latestFirstToken(generationFirstToken(previous), generationFirstToken(next)),
  )
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

function validIdentity(sample: {
  apiCallId?: unknown
  sessionId?: unknown
  model?: unknown
  completedAtMs?: unknown
  timeSource?: unknown
}): boolean {
  return (
    typeof sample.apiCallId === 'string' &&
    !!sample.apiCallId &&
    sample.apiCallId.length <= 2048 &&
    typeof sample.sessionId === 'string' &&
    !!sample.sessionId &&
    sample.sessionId.length <= 2048 &&
    typeof sample.model === 'string' &&
    sample.model.length <= 1024 &&
    Number.isSafeInteger(sample.completedAtMs) &&
    (sample.completedAtMs as number) > 0 &&
    (sample.timeSource === undefined || sample.timeSource === 'recorded')
  )
}

export function normalizeLatestFirstToken(value: unknown): LatestFirstToken | undefined {
  const sample = value as LatestFirstToken
  if (!sample || typeof sample !== 'object' || !validIdentity(sample)) return undefined
  const ttft = validTtft(sample.timeToFirstTokenMs)
  if (ttft === undefined || (sample.ttftKind !== undefined && sample.ttftKind !== 'estimate'))
    return undefined
  return {
    apiCallId: sample.apiCallId,
    sessionId: sample.sessionId,
    model: sample.model,
    completedAtMs: sample.completedAtMs,
    timeToFirstTokenMs: ttft,
    ...(sample.timeSource === 'recorded' ? { timeSource: sample.timeSource } : {}),
    ...(sample.ttftKind === 'estimate' ? { ttftKind: sample.ttftKind } : {}),
  }
}

export function normalizeLatestGeneration(value: unknown): LatestGeneration | undefined {
  const sample = value as LatestGeneration
  if (!sample || typeof sample !== 'object' || !validIdentity(sample)) return undefined
  if (sample.speedKind !== undefined && !SPEED_KINDS.has(sample.speedKind)) return undefined
  if (sample.ttftKind !== undefined && sample.ttftKind !== 'estimate') return undefined
  if (sample.speedExcluded !== undefined && sample.speedExcluded !== true) return undefined
  const ttft = validTtft(sample.timeToFirstTokenMs)
  const identity = {
    apiCallId: sample.apiCallId,
    sessionId: sample.sessionId,
    model: sample.model,
    completedAtMs: sample.completedAtMs,
    ...(sample.timeSource === 'recorded' ? { timeSource: sample.timeSource } : {}),
  }
  const ttftFields =
    ttft === undefined
      ? {}
      : {
          timeToFirstTokenMs: ttft,
          ...(sample.ttftKind === 'estimate' ? { ttftKind: sample.ttftKind } : {}),
        }
  if (sample.speedExcluded) {
    if (
      ttft === undefined ||
      sample.speedKind !== undefined ||
      sample.responseDurationMs !== undefined ||
      sample.streamDurationMs !== undefined ||
      sample.generatedTokens !== undefined ||
      sample.tokensPerSecond !== undefined ||
      sample.firstToken !== undefined
    )
      return undefined
    return { ...identity, ...ttftFields, speedExcluded: true }
  }
  if (sample.speedKind !== undefined) {
    if (
      sample.streamDurationMs !== undefined ||
      !Number.isFinite(sample.responseDurationMs) ||
      sample.responseDurationMs! <= 0
    )
      return undefined
  } else if (sample.responseDurationMs !== undefined) return undefined
  const speed = sample.tokensPerSecond
  if (ttft === undefined && !(Number.isFinite(speed) && speed! > 0)) return undefined
  const main: LatestGeneration = {
    ...identity,
    ...(sample.speedKind !== undefined
      ? { speedKind: sample.speedKind, responseDurationMs: sample.responseDurationMs }
      : {}),
    ...ttftFields,
    ...(Number.isFinite(sample.streamDurationMs) && sample.streamDurationMs! > 0
      ? { streamDurationMs: sample.streamDurationMs }
      : {}),
    ...(Number.isSafeInteger(sample.generatedTokens) && sample.generatedTokens! >= 0
      ? { generatedTokens: sample.generatedTokens }
      : {}),
    ...(Number.isFinite(speed) && speed! > 0 ? { tokensPerSecond: speed } : {}),
  }
  // 嵌套首 Token 只是附加证据；无效时丢弃，速度样本自带首字时只保留更晚的调用。
  return composeLatestGeneration(main, normalizeLatestFirstToken(sample.firstToken))
}
