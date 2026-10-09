import type { LatestTurnFirstToken } from '../../shared/models'
import { normalizeLatestTurnFirstToken } from '../../shared/turn-timing'
import { timestampEpochMs } from '../lib/date-utils'

/** 直接读取 Codex 原生计时，不能用完整消息的落盘时间反推首个流 Token。 */
export function codexTurnFirstToken(
  record: Record<string, unknown>,
  sessionId: string,
  currentTurnId: string,
): LatestTurnFirstToken | undefined {
  if (record.type !== 'event_msg' || !record.payload || typeof record.payload !== 'object')
    return undefined
  const payload = record.payload as Record<string, unknown>
  if (payload.type !== 'task_complete') return undefined
  if (payload.thread_id !== undefined && payload.thread_id !== sessionId) return undefined
  if (currentTurnId && payload.turn_id !== currentTurnId) return undefined
  const ttft = payload.time_to_first_token_ms
  if (
    payload.duration_ms !== undefined &&
    payload.duration_ms !== null &&
    (!Number.isSafeInteger(payload.duration_ms) ||
      (payload.duration_ms as number) < 0 ||
      (typeof ttft === 'number' && ttft > (payload.duration_ms as number)))
  )
    return undefined
  // 外层记录有毫秒精度；completed_at 是原生 Unix 秒，仅作为旧格式回退。
  const recordedAt = epochMs(record.timestamp)
  return normalizeLatestTurnFirstToken({
    sessionId,
    turnId: payload.turn_id,
    completedAtMs: recordedAt || epochMs(payload.completed_at),
    timeToFirstTokenMs: ttft,
  })
}

function epochMs(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0
  const time = timestampEpochMs(value)
  return Number.isSafeInteger(time) && time > 0 ? time : 0
}
