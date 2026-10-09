import type { UsageEvidence } from '../../shared/usage-cost'
import type { TokenUsageApiCall } from '../../shared/models'

export function usageEvidence(
  input: {
    granularity?: UsageEvidence['granularity']
    modelSource?: UsageEvidence['modelSource']
    modelId?: unknown
    modelDisplayNameSource?: UsageEvidence['modelDisplayNameSource']
    bucketQuality?: UsageEvidence['bucketQuality']
    cache5m?: unknown
    cache1h?: unknown
    reportedUsd?: unknown
  } = {},
): UsageEvidence {
  const evidence: UsageEvidence = {
    granularity: input.granularity ?? 'request',
    modelSource: input.modelSource ?? 'response',
    bucketQuality: input.bucketQuality ?? 'verified',
  }
  if (typeof input.modelId === 'string') {
    const modelId = input.modelId.trim()
    if (modelId && modelId.length <= 256 && !/\p{Cc}/u.test(modelId)) {
      evidence.modelId = modelId
      if (input.modelDisplayNameSource === 'current-config')
        evidence.modelDisplayNameSource = 'current-config'
    }
  }
  for (const [key, value] of [
    ['cacheWrite5mTokens', input.cache5m],
    ['cacheWrite1hTokens', input.cache1h],
  ] as const) {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      evidence[key] = value
  }
  if (
    typeof input.reportedUsd === 'number' &&
    Number.isFinite(input.reportedUsd) &&
    input.reportedUsd >= 0
  ) {
    evidence.reportedCost = { amount: input.reportedUsd, currency: 'USD' }
  }
  return evidence
}

/** 原始记录已不存在时保留旧数据；不把会话最终模型当作逐次调用证据。 */
export function evidenceForCall(call: TokenUsageApiCall): UsageEvidence {
  if (call.evidence) return call.evidence
  if (['goose', 'zed', 'hermes'].includes(call.agent)) {
    return usageEvidence({
      granularity: 'aggregate',
      modelSource: 'session',
      bucketQuality: 'uncertain',
    })
  }
  if (['codex', 'opencode', 'grok'].includes(call.agent))
    return usageEvidence({ modelSource: 'session' })
  if (['qwen', 'minimax-code'].includes(call.agent))
    return usageEvidence({ bucketQuality: 'uncertain' })
  if (call.agent === 'kimi-code') return usageEvidence({ modelSource: 'current-config' })
  if (call.agent === 'gemini')
    return usageEvidence({
      bucketQuality: 'uncertain',
      granularity: call.apiCallId.startsWith('gemini-stats:') ? 'aggregate' : 'request',
    })
  if (call.agent === 'workbuddy' || call.agent === 'zcode')
    return usageEvidence({ bucketQuality: 'uncertain' })
  return usageEvidence()
}

export function parseUsageEvidence(value: unknown): UsageEvidence | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const data = JSON.parse(value) as UsageEvidence
    if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
    const clean = usageEvidence({
      granularity: data.granularity === 'aggregate' ? 'aggregate' : 'request',
      modelSource:
        data.modelSource === 'response' || data.modelSource === 'current-config'
          ? data.modelSource
          : 'session',
      modelId: data.modelId,
      modelDisplayNameSource: data.modelDisplayNameSource,
      bucketQuality: data.bucketQuality === 'verified' ? 'verified' : 'uncertain',
      cache5m: data.cacheWrite5mTokens,
      cache1h: data.cacheWrite1hTokens,
      reportedUsd: data.reportedCost?.currency === 'USD' ? data.reportedCost.amount : undefined,
    })
    return clean
  } catch {
    return undefined
  }
}
