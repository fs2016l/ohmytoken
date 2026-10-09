import type { TokenUsageApiCall } from './types'

/** 原生 model_usage 是单次模型请求；turn_usage 的计时不能替代它。 */
export function zCodeGenerationTiming(
  row: Record<string, unknown>,
): TokenUsageApiCall['generationTiming'] {
  // 原生字段可能跨物理重试累计；没有重试边界时不把混合耗时当作最后一次调用。
  if (row.status !== 'completed' || (finiteDbNumber(row.retry_count) ?? 0) > 0) return undefined
  const startedAtMs = finiteDbNumber(row.started_at)
  const completedAtMs = finiteDbNumber(row.completed_at)
  const firstTokenAtMs = finiteDbNumber(row.first_token_at)
  const reportedTtftMs = finiteDbNumber(row.time_to_first_token_ms)
  if (
    startedAtMs === undefined ||
    completedAtMs === undefined ||
    !Number.isSafeInteger(startedAtMs) ||
    !Number.isSafeInteger(completedAtMs) ||
    startedAtMs <= 0 ||
    completedAtMs < startedAtMs ||
    (row.first_token_at != null &&
      (firstTokenAtMs === undefined || !Number.isSafeInteger(firstTokenAtMs))) ||
    (row.time_to_first_token_ms != null && reportedTtftMs === undefined)
  )
    return undefined
  const ttftMs = firstTokenAtMs !== undefined ? firstTokenAtMs - startedAtMs : reportedTtftMs
  if (
    ttftMs === undefined ||
    ttftMs < 0 ||
    ttftMs > completedAtMs - startedAtMs ||
    (firstTokenAtMs !== undefined && reportedTtftMs !== undefined && reportedTtftMs !== ttftMs)
  )
    return undefined
  const streamDurationMs = completedAtMs - startedAtMs - ttftMs
  return {
    completedAtMs,
    timeToFirstTokenMs: ttftMs,
    ...(streamDurationMs > 0 ? { streamDurationMs } : {}),
  }
}

function finiteDbNumber(value: unknown): number | undefined {
  if (!['number', 'string', 'bigint'].includes(typeof value)) return undefined
  if (typeof value === 'string' && !value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
