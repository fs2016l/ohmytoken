import type { TokenUsageApiCall } from '../../shared/models'
import type { UsageCostAssessment, UsageEvidence } from '../../shared/usage-cost'
import { hasExplicitTimezone, timestampEpochMs } from '../lib/date-utils'
import type { PriceCard, TokenRates } from './price-catalog'

interface TimePriceSelection {
  rates: TokenRates[]
  reason?: 'pricing-time-unknown' | 'historical-price-unavailable'
  pricingPeriod?: UsageCostAssessment['pricingPeriod']
  pricingEffectiveFrom?: string
  source?: string
}

export function selectTimePrice(
  card: PriceCard,
  call: TokenUsageApiCall,
  evidence: UsageEvidence,
): TimePriceSelection | undefined {
  if (!card.periods?.length) return undefined
  const raw = call.rawTimestamp?.trim() ?? ''
  const timestamp =
    /^\d+(?:\.\d+)?$/.test(raw) || hasExplicitTimezone(raw) ? timestampEpochMs(raw) : 0
  // 展示时间不带时区，且累计记录的时间不代表每次调用的发生时间。
  if (!timestamp || evidence.granularity === 'aggregate') {
    return {
      rates: card.periods.flatMap((period) => [
        period.rates,
        ...(period.peak ? [period.peak.rates] : []),
      ]),
      reason: 'pricing-time-unknown',
    }
  }
  const period = card.periods.findLast((entry) => timestamp >= Date.parse(entry.from))
  if (!period) return { rates: [], reason: 'historical-price-unavailable' }
  const utc = new Date(timestamp)
  const hour = utc.getUTCHours() + utc.getUTCMinutes() / 60 + utc.getUTCSeconds() / 3600
  const peak =
    period.peak?.utcWeekdays.includes(utc.getUTCDay()) &&
    period.peak.utcHours.some(([from, to]) => hour >= from && hour < to)
  return {
    rates: [peak ? period.peak!.rates : period.rates],
    pricingPeriod: !period.peak ? 'flat' : peak ? 'peak' : 'off-peak',
    pricingEffectiveFrom: period.from,
    source: period.source,
  }
}
