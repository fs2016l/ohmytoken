import { splitInclusiveTokenBuckets, tokenBuckets, type TokenBuckets } from './token-usage'

type ZCodeBucketSource = Omit<TokenBuckets, 'totalTokens'>
export type ZCodeOverlapFallback = 'none' | 'input-only' | 'input-and-output'

/** Z Code 的 input/output 可能包含 cache/reasoning；仅在有来源证据时拆分。 */
export function normalizeZCodeTokenBuckets(
  source: ZCodeBucketSource,
  reportedTotal: number,
  fallback: ZCodeOverlapFallback,
): TokenBuckets {
  const raw = tokenBuckets(source)
  const inputAndOutputInclusiveTotal = source.inputTokens + source.outputTokens
  const inputOnlyInclusiveTotal = inputAndOutputInclusiveTotal + source.reasoningTokens
  const hasOverlap =
    source.cacheReadTokens > 0 || source.cacheWriteTokens > 0 || source.reasoningTokens > 0
  const sourceProvesInputAndOutputInclusive =
    reportedTotal > 0 &&
    reportedTotal === inputAndOutputInclusiveTotal &&
    reportedTotal !== raw.totalTokens
  if (
    hasOverlap &&
    (sourceProvesInputAndOutputInclusive || (reportedTotal <= 0 && fallback === 'input-and-output'))
  ) {
    return splitInclusiveTokenBuckets(source)
  }
  const sourceProvesInputOnlyInclusive =
    reportedTotal > 0 &&
    reportedTotal === inputOnlyInclusiveTotal &&
    reportedTotal !== raw.totalTokens
  if (
    hasOverlap &&
    (sourceProvesInputOnlyInclusive || (reportedTotal <= 0 && fallback === 'input-only'))
  ) {
    const cacheOverlap = Math.min(
      source.inputTokens,
      source.cacheReadTokens + source.cacheWriteTokens,
    )
    return tokenBuckets({
      ...source,
      inputTokens: source.inputTokens - cacheOverlap,
    })
  }
  return raw
}
