import { object, percentage, timestamp, type JsonObject } from './types'

/** Grok credits JSON omits zero usage; legacy monetary responses still need their amount ratio. */
export function grokCreditUsagePercent(config: JsonObject): number | null {
  if (config.creditUsagePercent !== undefined) return percentage(config.creditUsagePercent)
  if (config.monthlyLimit !== undefined || config.used !== undefined) return null

  const period = object(config.currentPeriod)
  const start = timestamp(period.start)
  const end = timestamp(period.end)
  // Only apply the official client's zero default to a complete, recognized credits period.
  // Partial responses and explicitly invalid percentages must remain unknown.
  return (period.type === 'USAGE_PERIOD_TYPE_WEEKLY' ||
    period.type === 'USAGE_PERIOD_TYPE_MONTHLY') &&
    start !== null &&
    end !== null &&
    end > start
    ? 0
    : null
}
