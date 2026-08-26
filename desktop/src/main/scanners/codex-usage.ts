import type { TokenUsageApiCall } from './types'
import { tokenCount } from './token-usage'

export interface CodexUsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  reportedTotalTokens: number
}

export function readCodexUsage(value: unknown): CodexUsageSnapshot | null {
  if (!isObject(value)) return null
  return {
    inputTokens: tokenCount(value.input_tokens),
    outputTokens: tokenCount(value.output_tokens),
    cacheReadTokens: tokenCount(value.cached_input_tokens),
    cacheWriteTokens: tokenCount(value.cache_write_input_tokens),
    reasoningTokens: tokenCount(value.reasoning_output_tokens),
    reportedTotalTokens: tokenCount(value.total_tokens),
  }
}

export function hasTokenUsage(usage: CodexUsageSnapshot): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheWriteTokens > 0 ||
    usage.reasoningTokens > 0
  )
}

/** 原始累计快照的比较量；只用于识别重复、回退和新累计周期。 */
export function codexUsageSum(usage: CodexUsageSnapshot): number {
  return usage.reportedTotalTokens > 0
    ? usage.reportedTotalTokens
    : usage.inputTokens + usage.outputTokens
}

/**
 * Codex input 包含 cached/cache-write，output 包含 reasoning；转换成应用的互斥五分桶。
 * 旧 rollout 未持久化 cache_write_input_tokens 时只能按 0 处理，无法观测的部分仍留在
 * inputTokens，因此 API 总量保持准确且不会凭空猜测历史 cache-write。
 */
export function normalizeCodexUsageExclusive(usage: CodexUsageSnapshot): CodexUsageSnapshot {
  const rawInput = tokenCount(usage.inputTokens)
  const rawOutput = tokenCount(usage.outputTokens)
  const cacheReadTokens = Math.min(tokenCount(usage.cacheReadTokens), rawInput)
  const cacheWriteTokens = Math.min(tokenCount(usage.cacheWriteTokens), rawInput - cacheReadTokens)
  const reasoningTokens = Math.min(tokenCount(usage.reasoningTokens), rawOutput)
  return {
    inputTokens: rawInput - cacheReadTokens - cacheWriteTokens,
    outputTokens: rawOutput - reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    reportedTotalTokens: tokenCount(usage.reportedTotalTokens),
  }
}

export function codexUsageSignature(usage: CodexUsageSnapshot): string {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
    usage.reportedTotalTokens,
  ].join('|')
}

export function emptyCodexUsage(): CodexUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    reportedTotalTokens: 0,
  }
}

export function addCodexUsage(
  left: CodexUsageSnapshot,
  right: CodexUsageSnapshot,
): CodexUsageSnapshot {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    reportedTotalTokens: left.reportedTotalTokens + right.reportedTotalTokens,
  }
}

export function subtractCodexUsage(
  total: CodexUsageSnapshot,
  delta: CodexUsageSnapshot,
): CodexUsageSnapshot | null {
  const baseline: CodexUsageSnapshot = {
    inputTokens: total.inputTokens - delta.inputTokens,
    outputTokens: total.outputTokens - delta.outputTokens,
    cacheReadTokens: total.cacheReadTokens - delta.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens - delta.cacheWriteTokens,
    reasoningTokens: total.reasoningTokens - delta.reasoningTokens,
    reportedTotalTokens: total.reportedTotalTokens - delta.reportedTotalTokens,
  }
  return Object.values(baseline).some((value) => value < 0) ? null : baseline
}

export function assertCodexCumulativeMatches(
  sessionFile: string,
  apiCallsOrUsage: TokenUsageApiCall[] | CodexUsageSnapshot,
  expected: CodexUsageSnapshot,
  inheritedBaseline: CodexUsageSnapshot | null = null,
): void {
  const actual = Array.isArray(apiCallsOrUsage)
    ? apiCallsOrUsage.reduce(
        (sum, call) => {
          sum.inputTokens += call.inputTokens
          sum.outputTokens += call.outputTokens
          sum.cacheReadTokens += call.cacheReadTokens
          sum.cacheWriteTokens += call.cacheWriteTokens
          sum.reasoningTokens += call.reasoningTokens
          return sum
        },
        {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          reasoningTokens: 0,
        },
      )
    : apiCallsOrUsage
  const fields: Array<
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens'
  > = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
  const mismatches = fields
    .filter((field) => actual[field] + (inheritedBaseline?.[field] ?? 0) !== expected[field])
    .map((field) => {
      const baseline = inheritedBaseline?.[field] ?? 0
      return `${field}=${actual[field]}+${baseline}/${expected[field]}`
    })
  if (mismatches.length > 0) {
    throw new Error(`Codex token 累计校验失败 (${sessionFile}): ${mismatches.join(', ')}`)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
