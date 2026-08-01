import type { TokenUsageApiCall } from './types'

export interface CodexUsageSnapshot {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  reasoningTokens: number
  reportedTotalTokens: number
}

export function readCodexUsage(value: unknown): CodexUsageSnapshot | null {
  if (!isObject(value)) return null
  return {
    inputTokens: toInteger(value.input_tokens),
    outputTokens: toInteger(value.output_tokens),
    cacheReadTokens: toInteger(value.cached_input_tokens),
    reasoningTokens: toInteger(value.reasoning_output_tokens),
    reportedTotalTokens: toInteger(value.total_tokens),
  }
}

export function hasTokenUsage(usage: CodexUsageSnapshot): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.reasoningTokens > 0
  )
}

export function codexUsageSignature(usage: CodexUsageSnapshot): string {
  if (usage.inputTokens > 0 || usage.outputTokens > 0) {
    return `${usage.inputTokens}|${usage.outputTokens}`
  }
  return `total|${usage.reportedTotalTokens}`
}

export function emptyCodexUsage(): CodexUsageSnapshot {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
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
          sum.reasoningTokens += call.reasoningTokens
          return sum
        },
        { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 },
      )
    : apiCallsOrUsage
  const fields: Array<'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'reasoningTokens'> = [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'reasoningTokens',
  ]
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

function toInteger(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(value) || 0
  if (typeof value === 'bigint') return Number(value) || 0
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
