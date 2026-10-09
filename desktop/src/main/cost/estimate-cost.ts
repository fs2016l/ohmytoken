import type { TokenUsageApiCall } from '../../shared/models'
import type { CostReason, UsageCostAssessment, UsageEvidence } from '../../shared/usage-cost'
import { findPriceCard, type TokenRates } from './price-catalog'
import { attributeModel } from './model-attribution'
import { evidenceForCall } from './usage-evidence'
import { selectTimePrice } from './time-pricing'
import { ANALYTICS_BUCKETS, type AnalyticsBucket } from '../../shared/analytics'

type Amount = { min: number; max: number }
type CostParts = Record<AnalyticsBucket, Amount>

/** Component bounds use the same request-size, time and cache-duration candidates as the total. */
export function estimateUsageCostBreakdown(call: TokenUsageApiCall): {
  total: UsageCostAssessment
  buckets: Record<AnalyticsBucket, UsageCostAssessment>
} {
  let parts: CostParts | undefined
  const total = estimateUsageCost(call, (values) => {
    parts = values
  })
  const buckets = Object.fromEntries(
    ANALYTICS_BUCKETS.map((bucket) => {
      const amount = parts?.[bucket]
      return [
        bucket,
        amount
          ? {
              ...total,
              ...amount,
              status: amount.min === amount.max ? 'estimated' : 'range',
              reportedCost: undefined,
            }
          : { ...total, reportedCost: undefined },
      ]
    }),
  ) as Record<AnalyticsBucket, UsageCostAssessment>
  return { total, buckets }
}

export function estimateUsageCost(
  call: TokenUsageApiCall,
  onParts?: (parts: CostParts) => void,
): UsageCostAssessment {
  const evidence = evidenceForCall(call)
  const modelId = evidence.modelId || call.model
  const identity = attributeModel(modelId)
  const unpriced = (reason: CostReason): UsageCostAssessment => ({
    identity,
    status: 'unpriced',
    reason,
    reportedCost: evidence.reportedCost,
  })
  const tokens = [
    call.inputTokens,
    call.outputTokens,
    call.cacheReadTokens,
    call.cacheWriteTokens,
    call.reasoningTokens,
  ]
  if (
    tokens.some((n) => !Number.isSafeInteger(n) || n < 0) ||
    !Number.isSafeInteger(call.totalTokens) ||
    tokens.reduce((a, b) => a + b, 0) !== call.totalTokens
  )
    return unpriced('invalid-tokens')
  if (evidence.modelSource !== 'response') return unpriced('model-not-historical')
  if (evidence.bucketQuality === 'uncertain') return unpriced('uncertain-buckets')
  const card = findPriceCard(modelId)
  if (!card) return unpriced('model-unpriced')
  if (!card.rates.length && !card.periods?.length) return unpriced('model-unpriced')
  const prompt = call.inputTokens + call.cacheReadTokens + call.cacheWriteTokens
  const timePrice = selectTimePrice(card, call, evidence)
  if (timePrice?.reason === 'historical-price-unavailable') return unpriced(timePrice.reason)
  let candidates = timePrice?.rates ?? card.rates
  let reason: CostReason | undefined = timePrice?.reason
  if (evidence.granularity === 'aggregate' && card.tiers?.length) {
    candidates = [...card.rates, ...card.tiers.flatMap((tier) => tier.rates)]
    reason = 'request-size'
  } else {
    const output = call.outputTokens + call.reasoningTokens
    for (const tier of card.tiers ?? []) {
      if (prompt >= tier.fromInput && output >= (tier.fromOutput ?? 0)) candidates = tier.rates
    }
  }
  if (candidates.length > 1) reason ??= 'price-variants'
  const estimates = candidates.map((rates) => costAtRates(call, evidence, rates, !!onParts))
  if (estimates.some((value) => value === null)) return unpriced('missing-bucket-rate')
  const amounts = estimates.filter((value) => value !== null)
  const min = Math.min(...amounts.map((value) => value.min))
  const max = Math.max(...amounts.map((value) => value.max))
  if (!Number.isFinite(min) || !Number.isFinite(max)) return unpriced('invalid-tokens')
  if (amounts.some((value) => value.min !== value.max)) reason ??= 'cache-duration'
  if (onParts)
    onParts(
      Object.fromEntries(
        ANALYTICS_BUCKETS.map((bucket) => [
          bucket,
          {
            min: Math.min(...amounts.map((value) => value.parts![bucket].min)),
            max: Math.max(...amounts.map((value) => value.parts![bucket].max)),
          },
        ]),
      ) as CostParts,
    )
  return {
    identity,
    status: min === max ? 'estimated' : 'range',
    currency: card.currency,
    min,
    max,
    reason: min === max ? undefined : reason,
    priceCard: card.id,
    source: timePrice?.source ?? card.source,
    ...(timePrice?.pricingPeriod
      ? {
          pricingPeriod: timePrice.pricingPeriod,
          pricingEffectiveFrom: timePrice.pricingEffectiveFrom,
        }
      : {}),
    reportedCost: evidence.reportedCost,
  }
}

function costAtRates(
  call: TokenUsageApiCall,
  evidence: UsageEvidence,
  rates: TokenRates,
  includeParts: boolean,
): { min: number; max: number; parts?: CostParts } | null {
  if (
    (call.cacheReadTokens > 0 && rates.cacheRead === undefined) ||
    (call.cacheWriteTokens > 0 && rates.cacheWrite === undefined)
  )
    return null
  const base =
    (call.inputTokens * rates.input +
      (call.outputTokens + call.reasoningTokens) * rates.output +
      call.cacheReadTokens * (rates.cacheRead ?? 0)) /
    1_000_000
  let minWrite = (call.cacheWriteTokens * (rates.cacheWrite ?? 0)) / 1_000_000
  let maxWrite = minWrite
  if (call.cacheWriteTokens > 0 && rates.cacheWrite1h !== undefined) {
    const short = evidence.cacheWrite5mTokens
    const long = evidence.cacheWrite1hTokens
    if (short !== undefined && long !== undefined && short + long === call.cacheWriteTokens) {
      minWrite = (short * (rates.cacheWrite ?? 0) + long * rates.cacheWrite1h) / 1_000_000
      maxWrite = minWrite
    } else {
      maxWrite = (call.cacheWriteTokens * rates.cacheWrite1h) / 1_000_000
    }
  }
  const result: { min: number; max: number; parts?: CostParts } = {
    min: base + minWrite,
    max: base + maxWrite,
  }
  if (includeParts) {
    const input = (call.inputTokens * rates.input) / 1_000_000
    const output = (call.outputTokens * rates.output) / 1_000_000
    const reasoning = (call.reasoningTokens * rates.output) / 1_000_000
    const read = (call.cacheReadTokens * (rates.cacheRead ?? 0)) / 1_000_000
    result.parts = {
      input: { min: input, max: input },
      output: { min: output, max: output },
      reasoning: { min: reasoning, max: reasoning },
      cache: { min: read + minWrite, max: read + maxWrite },
    }
  }
  return result
}
