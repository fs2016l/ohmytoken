import type { GenerationTiming, LatestGeneration } from '../../shared/models'
import { latestGeneration, normalizeLatestGeneration } from '../../shared/generation-timing'
import { isUserPrompt } from './conversation-turn'

type ResponseRecord = {
  id: string
  model: string
  anchorMs?: number
  turn?: number
  completedAtMs?: number
  outputTokens: number
  completed: boolean
  invalid: boolean
}

type SessionState = {
  nextAnchorMs?: number
  turn?: number
  previous?: ResponseRecord
  responses: Map<string, ResponseRecord>
}

const completedReasons = new Set([
  'end_turn',
  'tool_use',
  'max_tokens',
  'stop_sequence',
  'pause_turn',
  'refusal',
  'model_context_window_exceeded',
])

/**
 * JSONL 只记录内容块落盘时间，不能恢复首 Token 或原生流时长。
 * 这里只估算可观察响应区间；同一 message.id 的内容块共用起点。
 */
export class ClaudeResponseEstimator {
  private readonly sessions = new Map<string, SessionState>()

  observe(sessionId: string, row: Record<string, unknown>): void {
    const message = object(row.message)
    if (!message || (row.type !== 'user' && row.type !== 'assistant')) return
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { responses: new Map() }
      this.sessions.set(sessionId, state)
    }
    const timestamp = recordedTimestamp(row.timestamp)
    if (row.type === 'user') {
      if (row.isMeta === true || row.isCompactSummary === true) return
      const prompt = isUserPrompt(message.content)
      const toolResult =
        Array.isArray(message.content) &&
        message.content.some((part) => object(part)?.type === 'tool_result')
      if (!prompt && !toolResult) return
      if (prompt) state.turn = (state.turn ?? 0) + 1
      // 新起点缺时间时也清掉旧区间，不能跨越另一轮用户输入估算。
      state.nextAnchorMs = timestamp
      state.previous = undefined
      return
    }

    const id = typeof message.id === 'string' ? message.id : ''
    if (!id) {
      state.nextAnchorMs = undefined
      state.previous = undefined
      return
    }
    let response = state.responses.get(id)
    if (!response) {
      const previous = state.previous
      const previousEnd =
        state.turn !== undefined &&
        previous?.turn === state.turn &&
        previous.completed &&
        !previous.invalid
          ? previous.completedAtMs
          : undefined
      response = {
        id,
        model: typeof message.model === 'string' ? message.model : 'unknown',
        anchorMs: state.nextAnchorMs ?? previousEnd,
        turn: state.turn,
        outputTokens: 0,
        completed: false,
        invalid: false,
      }
      state.responses.set(id, response)
      state.nextAnchorMs = undefined
      state.previous = response
    }
    if (
      row.isApiErrorMessage === true ||
      row.error !== undefined ||
      message.model === '<synthetic>' ||
      (typeof message.stop_reason === 'string' && !completedReasons.has(message.stop_reason))
    )
      response.invalid = true
    const usage = object(message.usage)
    if (
      !usage ||
      typeof usage.output_tokens !== 'number' ||
      !Number.isSafeInteger(usage.output_tokens) ||
      usage.output_tokens < 0 ||
      timestamp === undefined
    )
      return
    response.outputTokens = Math.max(response.outputTokens, usage.output_tokens)
    response.completedAtMs = Math.max(response.completedAtMs ?? 0, timestamp)
    if (typeof message.stop_reason === 'string' && completedReasons.has(message.stop_reason))
      response.completed = true
  }

  timingFor(sessionId: string, messageId: string): GenerationTiming | undefined {
    const response = this.sessions.get(sessionId)?.responses.get(messageId)
    if (
      !response ||
      response.invalid ||
      !response.completed ||
      response.anchorMs === undefined ||
      response.completedAtMs === undefined ||
      response.completedAtMs <= response.anchorMs ||
      response.outputTokens <= 0
    )
      return undefined
    return {
      completedAtMs: response.completedAtMs,
      timeSource: 'recorded',
      speedKind: 'response-estimate',
      responseDurationMs: response.completedAtMs - response.anchorMs,
      generatedTokens: response.outputTokens,
    }
  }

  latest(): LatestGeneration[] {
    const samples: LatestGeneration[] = []
    for (const [sessionId, state] of this.sessions) {
      let latest: LatestGeneration | undefined
      for (const response of state.responses.values()) {
        const timing = this.timingFor(sessionId, response.id)
        if (!timing) continue
        const sample = normalizeLatestGeneration({
          ...timing,
          apiCallId: response.id,
          sessionId,
          model: response.model,
          tokensPerSecond: (timing.generatedTokens! * 1000) / timing.responseDurationMs!,
        })
        latest = latestGeneration(latest, sample)
      }
      if (latest) samples.push(latest)
    }
    return samples
  }
}

function recordedTimestamp(value: unknown): number | undefined {
  // Claude 原生记录是 ISO 时间；不以文件 mtime 或扫描时间补缺失边界。
  if (typeof value !== 'string') return undefined
  const milliseconds = Date.parse(value)
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
