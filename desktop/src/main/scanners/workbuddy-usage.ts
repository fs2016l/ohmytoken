interface ParsedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

interface RawUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number | null
  freshInputTokens: number | null
}

interface OutputReasoningCandidate {
  outputTokens: number
  reasoningTokens: number
}

/** 解析并归一化 WorkBuddy providerData 中的 token 用量。 */
export function parseWorkBuddyProviderUsage(
  providerData: Record<string, unknown>,
): ParsedUsage | null {
  const usage = usageObject(providerData.usage)
  const rawUsage = usageObject(providerData.rawUsage)
  if (usage === null && rawUsage === null) return null

  const sources = [usage, rawUsage]
  const inputTokens = tokenFromSources(sources, [
    'inputTokens',
    'input_tokens',
    'promptTokens',
    'prompt_tokens',
    'totalInputTokens',
  ])
  const outputTokens = tokenFromSources(sources, [
    'outputTokens',
    'output_tokens',
    'completionTokens',
    'completion_tokens',
    'totalOutputTokens',
  ])
  const cacheReadTokens = firstPositive([
    detailTokens(usage, 'inputTokensDetails', [
      'cached_tokens',
      'cacheReadTokens',
      'cache_read_tokens',
    ]),
    detailTokens(rawUsage, 'prompt_tokens_details', [
      'cached_tokens',
      'cacheReadTokens',
      'cache_read_tokens',
    ]),
    tokenFromSources(sources, [
      'cacheReadTokens',
      'cache_read_tokens',
      'cache_read_input_tokens',
      'cachedInputTokens',
      'cached_input_tokens',
      'totalCachedTokens',
      'prompt_cache_hit_tokens',
      'cached_tokens',
    ]),
  ])
  const cacheWriteTokens = tokenFromSources(sources, [
    'cacheWriteTokens',
    'cache_write_tokens',
    'cache_creation_input_tokens',
    'prompt_cache_write_tokens',
  ])
  const reasoningTokens = firstPositive([
    detailTokens(usage, 'outputTokensDetails', ['reasoning_tokens', 'reasoningTokens']),
    detailTokens(rawUsage, 'completion_tokens_details', ['reasoning_tokens', 'reasoningTokens']),
    tokenFromSources(sources, [
      'reasoningTokens',
      'reasoning_tokens',
      'reasoning_output_tokens',
      'completion_thinking_tokens',
    ]),
  ])
  const totalTokens = optionalTokenFromSources(sources, ['totalTokens', 'total_tokens'])
  const freshInputTokens = optionalTokenFromSources(sources, [
    'cachedMissTokens',
    'cached_miss_tokens',
    'cacheMissTokens',
    'cache_miss_tokens',
  ])

  return normalizeUsage({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens,
    freshInputTokens,
  })
}

function normalizeUsage(raw: RawUsage): ParsedUsage | null {
  if (
    [
      raw.inputTokens,
      raw.outputTokens,
      raw.cacheReadTokens,
      raw.cacheWriteTokens,
      raw.reasoningTokens,
      raw.totalTokens ?? 0,
      raw.freshInputTokens ?? 0,
    ].some((value) => value < 0)
  ) {
    return null
  }
  if (
    raw.inputTokens === 0 &&
    raw.outputTokens === 0 &&
    raw.cacheReadTokens === 0 &&
    raw.cacheWriteTokens === 0 &&
    raw.reasoningTokens === 0
  ) {
    return null
  }

  if (raw.totalTokens === null) {
    if (raw.cacheReadTokens === 0 && raw.cacheWriteTokens === 0 && raw.reasoningTokens === 0) {
      return buildParsedUsage(raw, raw.inputTokens, raw.outputTokens, raw.reasoningTokens)
    }
    if (raw.freshInputTokens === null || raw.reasoningTokens > 0) return null
    return buildParsedUsage(raw, raw.freshInputTokens, raw.outputTokens, raw.reasoningTokens)
  }

  const inputCandidates =
    raw.freshInputTokens === null
      ? uniqueNonNegative([
          raw.inputTokens,
          raw.inputTokens - raw.cacheReadTokens,
          raw.inputTokens - raw.cacheWriteTokens,
          raw.inputTokens - raw.cacheReadTokens - raw.cacheWriteTokens,
        ])
      : [raw.freshInputTokens]
  // 重叠候选仅用于显式总量判定，不会全局截断 reasoning。
  const outputCandidates = uniqueOutputReasoningCandidates([
    { outputTokens: raw.outputTokens, reasoningTokens: raw.reasoningTokens },
    {
      outputTokens: Math.max(0, raw.outputTokens - raw.reasoningTokens),
      reasoningTokens: Math.min(raw.reasoningTokens, raw.outputTokens),
    },
  ])
  const matches = new Map<string, ParsedUsage>()
  for (const inputTokens of inputCandidates) {
    for (const outputCandidate of outputCandidates) {
      const usage = buildParsedUsage(
        raw,
        inputTokens,
        outputCandidate.outputTokens,
        outputCandidate.reasoningTokens,
        raw.totalTokens,
      )
      if (usage.totalTokens !== raw.totalTokens) continue
      matches.set(
        `${inputTokens}:${outputCandidate.outputTokens}:${outputCandidate.reasoningTokens}`,
        usage,
      )
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null
}

function buildParsedUsage(
  raw: RawUsage,
  inputTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  expectedTotal?: number,
): ParsedUsage {
  const bucketTotal =
    inputTokens + outputTokens + raw.cacheReadTokens + raw.cacheWriteTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    cacheReadTokens: raw.cacheReadTokens,
    cacheWriteTokens: raw.cacheWriteTokens,
    reasoningTokens,
    totalTokens: expectedTotal === bucketTotal ? expectedTotal : bucketTotal,
  }
}

function uniqueNonNegative(values: number[]): number[] {
  return [...new Set(values.filter((value) => value >= 0))]
}

function uniqueOutputReasoningCandidates(
  candidates: OutputReasoningCandidate[],
): OutputReasoningCandidate[] {
  const unique = new Map<string, OutputReasoningCandidate>()
  for (const candidate of candidates) {
    unique.set(`${candidate.outputTokens}:${candidate.reasoningTokens}`, candidate)
  }
  return [...unique.values()]
}

function usageObject(value: unknown): Record<string, unknown> | null {
  if (isObject(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function tokenFromSources(sources: (Record<string, unknown> | null)[], aliases: string[]): number {
  return optionalTokenFromSources(sources, aliases) ?? 0
}

function optionalTokenFromSources(
  sources: (Record<string, unknown> | null)[],
  aliases: string[],
): number | null {
  for (const source of sources) {
    if (source === null) continue
    for (const alias of aliases) {
      const token = numberValue(source[alias])
      if (token !== null) return token
    }
  }
  return null
}

function detailTokens(
  source: Record<string, unknown> | null,
  key: string,
  aliases: string[],
): number {
  if (source === null) return 0
  const value = source[key]
  if (Array.isArray(value)) {
    return value.reduce((total, item) => {
      if (!isObject(item)) return total
      return total + tokenFromSources([item], aliases)
    }, 0)
  }
  if (isObject(value)) return tokenFromSources([value], aliases)
  return 0
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'bigint') return Number(value)
  if (typeof value === 'string' && value.trim()) {
    const n = Number.parseInt(value, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function firstPositive(values: number[]): number {
  for (const value of values) {
    if (value > 0) return value
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
