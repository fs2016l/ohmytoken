import type { TokenUsageApiCall } from '../../shared/models'
import { localTimestampFromValue } from '../lib/date-utils'

/** 预览与持久化使用相同的本地日期归属。 */
export function usageCallTime(call: Pick<TokenUsageApiCall, 'timestamp' | 'date' | 'hour'>): {
  timestamp: string
  date: string
  hour: number
} {
  const timestamp = localTimestampFromValue(call.timestamp, call.date)
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(timestamp)
  if (!match) return { timestamp, date: call.date, hour: call.hour }
  const hour = Number.parseInt(match[2], 10)
  return {
    timestamp,
    date: match[1],
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : call.hour,
  }
}
