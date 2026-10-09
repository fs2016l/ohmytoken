import type { LatestTurnFirstToken } from './models'

export function normalizeLatestTurnFirstToken(value: unknown): LatestTurnFirstToken | undefined {
  if (!value || typeof value !== 'object') return undefined
  const sample = value as LatestTurnFirstToken
  if (
    typeof sample.sessionId !== 'string' ||
    !sample.sessionId ||
    sample.sessionId.length > 2048 ||
    typeof sample.turnId !== 'string' ||
    !sample.turnId ||
    sample.turnId.length > 2048 ||
    !Number.isSafeInteger(sample.completedAtMs) ||
    sample.completedAtMs <= 0 ||
    !Number.isSafeInteger(sample.timeToFirstTokenMs) ||
    sample.timeToFirstTokenMs < 0
  )
    return undefined
  return {
    sessionId: sample.sessionId,
    turnId: sample.turnId,
    completedAtMs: sample.completedAtMs,
    timeToFirstTokenMs: sample.timeToFirstTokenMs,
  }
}

/** 按轮完成记录选取；与最近 API 的时间及模型选择互不影响。 */
export function latestTurnFirstToken(
  previous: LatestTurnFirstToken | undefined,
  next: LatestTurnFirstToken | undefined,
): LatestTurnFirstToken | undefined {
  if (!next) return previous
  if (!previous) return next
  if (next.completedAtMs !== previous.completedAtMs)
    return next.completedAtMs > previous.completedAtMs ? next : previous
  return JSON.stringify([next.sessionId, next.turnId]) >=
    JSON.stringify([previous.sessionId, previous.turnId])
    ? next
    : previous
}
