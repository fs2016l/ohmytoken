import { timestampEpochMs } from '../lib/date-utils'
import type { TokenUsageApiCall } from './types'
import { normalizeGeminiStyleUsage } from './gemini-style-usage'

type GenerationTiming = NonNullable<TokenUsageApiCall['generationTiming']>

interface QwenTimingSample {
  responseId: string
  model: string
  usageKey: string
  timing: GenerationTiming
}

interface QwenTranscriptNode {
  sessionId: string
  parentUuid: string
  type: string
  inferenceBoundary: boolean
  sample?: QwenTimingSample
}

export interface QwenTimingCandidate {
  call: TokenUsageApiCall
  parentUuid: string
}

/** 原生完成事件沿转录的父链对应助手记录；不按相同 Token 数猜测调用身份。 */
export class QwenGenerationTiming {
  private readonly nodes = new Map<string, QwenTranscriptNode | null>()

  record(value: Record<string, unknown>, fallbackSessionId: string): void {
    const uuid = nonemptyString(value.uuid)
    if (!uuid) return
    const sessionId = nonemptyString(value.sessionId) || fallbackSessionId
    const node: QwenTranscriptNode = {
      sessionId,
      parentUuid: nonemptyString(value.parentUuid),
      type: nonemptyString(value.type),
      inferenceBoundary: isInferenceBoundary(value),
      sample: readQwenTimingSample(value),
    }
    const key = nodeKey(sessionId, uuid)
    if (!this.nodes.has(key)) {
      this.nodes.set(key, node)
      return
    }
    const previous = this.nodes.get(key)
    if (!previous || JSON.stringify(previous) !== JSON.stringify(node)) this.nodes.set(key, null)
  }

  apply(candidates: readonly QwenTimingCandidate[]): void {
    const matches = new Map<string, Array<{ call: TokenUsageApiCall; sample: QwenTimingSample }>>()
    for (const { call, parentUuid } of candidates) {
      const sample = this.findSample(call, parentUuid)
      if (!sample) continue
      const key = nodeKey(call.sessionId, sample.responseId)
      const entries = matches.get(key) ?? []
      entries.push({ call, sample })
      matches.set(key, entries)
    }
    for (const entries of matches.values()) {
      // 一个响应被多个助手记录引用时不把整次生成计时挂到其中一段。
      if (entries.length === 1) entries[0].call.generationTiming = entries[0].sample.timing
    }
  }

  private findSample(call: TokenUsageApiCall, parentUuid: string): QwenTimingSample | undefined {
    const visited = new Set<string>()
    let current = parentUuid
    let found: QwenTimingSample | undefined
    while (current) {
      if (visited.has(current)) return undefined
      visited.add(current)
      const node = this.nodes.get(nodeKey(call.sessionId, current))
      if (!node) return undefined
      if (node.type !== 'system') break
      if (node.inferenceBoundary && !node.sample) return undefined
      if (node.sample) {
        if (found || node.sample.model !== call.model || node.sample.usageKey !== usageKey(call))
          return undefined
        found = node.sample
      }
      current = node.parentUuid
    }
    return found
  }
}

function isInferenceBoundary(value: Record<string, unknown>): boolean {
  if (value.type !== 'system' || value.subtype !== 'ui_telemetry') return false
  const event = object(object(value.systemPayload)?.uiEvent)
  return ['qwen-code.api_response', 'qwen-code.api_error', 'qwen-code.api_cancel'].includes(
    String(event?.['event.name']),
  )
}

function readQwenTimingSample(value: Record<string, unknown>): QwenTimingSample | undefined {
  if (value.type !== 'system' || value.subtype !== 'ui_telemetry') return undefined
  const payload = object(value.systemPayload)
  const event = object(payload?.uiEvent)
  if (!event || event['event.name'] !== 'qwen-code.api_response' || event.status_code !== 200)
    return undefined
  const responseId = nonemptyString(event.response_id)
  const model = nonemptyString(event.model)
  const completedAtMs = timestampEpochMs(nonemptyString(event['event.timestamp']))
  const durationMs = nonnegativeNumber(event.duration_ms)
  const timeToFirstTokenMs = nonnegativeNumber(event.ttft_ms)
  if (
    !responseId ||
    !model ||
    completedAtMs <= 0 ||
    durationMs === undefined ||
    timeToFirstTokenMs === undefined ||
    durationMs < timeToFirstTokenMs
  )
    return undefined
  const counters = [
    event.input_token_count,
    event.output_token_count,
    event.cached_content_token_count,
    event.thoughts_token_count,
    event.total_token_count,
  ]
  if (counters.some((counter) => !Number.isSafeInteger(counter) || (counter as number) < 0))
    return undefined
  const usage = normalizeGeminiStyleUsage({
    input: counters[0] as number,
    output: counters[1] as number,
    cached: counters[2] as number,
    thoughts: counters[3] as number,
    reportedTotal: counters[4] as number,
    tool: 0,
    inputIncludesCache: true,
    outputIncludesThoughts: true,
  })
  if (!usage || usage.bucketQuality !== 'verified') return undefined
  return {
    responseId,
    model,
    usageKey: usageKey(usage),
    timing: {
      completedAtMs,
      timeToFirstTokenMs,
      streamDurationMs: durationMs - timeToFirstTokenMs,
      generatedTokens: usage.outputTokens + usage.reasoningTokens,
    },
  }
}

function usageKey(
  usage: Pick<
    TokenUsageApiCall,
    | 'inputTokens'
    | 'outputTokens'
    | 'cacheReadTokens'
    | 'cacheWriteTokens'
    | 'reasoningTokens'
    | 'totalTokens'
  >,
): string {
  return JSON.stringify([
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens,
    usage.cacheWriteTokens,
    usage.reasoningTokens,
    usage.totalTokens,
  ])
}

function nodeKey(sessionId: string, uuid: string): string {
  return JSON.stringify([sessionId, uuid])
}

function nonemptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function nonnegativeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
