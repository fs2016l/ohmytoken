import type { SessionTurnState, TokenUsageApiCall } from '../../shared/models'
import { aggregateSessionUsage } from '../services/session-usage-codec'

/** Supplement a cumulative scanner with actual per-message usage when the source provides it. */
export function reportedTurnUsage(calls: TokenUsageApiCall[]): SessionTurnState['reportedUsage'] {
  if (!calls.length) return undefined
  const { session, costs } = aggregateSessionUsage(calls)
  const modelTotals: Record<string, number> = {}
  for (const call of calls)
    modelTotals[call.model] = (modelTotals[call.model] ?? 0) + call.totalTokens
  return {
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    reasoningTokens: session.reasoningTokens,
    totalTokens: session.totalTokens,
    apiCallCount: calls.length,
    apiCallCountComplete: true,
    models: Object.keys(modelTotals),
    modelTotals,
    costSummary: costs,
  }
}
