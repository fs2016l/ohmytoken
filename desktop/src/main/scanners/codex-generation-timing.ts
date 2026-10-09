import type { GenerationTiming } from '../../shared/models'
import { timestampEpochMs } from '../lib/date-utils'

export interface CodexGenerationEstimateState {
  sessionId: string
  turnId: string
  anchorAtMs: number
  acceptedAtMs: number
  modelPending: boolean
  nextAnchorAtMs: number
}

const CLIENT_TOOL_ITEMS = new Set([
  'CommandExecution',
  'FileChange',
  'McpToolCall',
  'DynamicToolCall',
  'CollabAgentToolCall',
  'ImageView',
])
const CLIENT_TOOL_RESULTS = new Set([
  'exec_command_end',
  'patch_apply_end',
  'mcp_tool_call_end',
  'dynamic_tool_call_response',
])
const RESPONSE_TOOL_RESULTS = new Set(['function_call_output', 'custom_tool_call_output'])

/**
 * Codex 默认 rollout 没有逐 API 的首个流 Token 时间。这里只估算响应区间，
 * 区间包含首字等待和客户端时间，缺少工具返回标记时还可能包含工具时间。
 */
export class CodexGenerationEstimate {
  private state: CodexGenerationEstimateState

  constructor(state?: CodexGenerationEstimateState) {
    this.state = state ? { ...state } : this.emptyState()
  }

  snapshot(): CodexGenerationEstimateState {
    return { ...this.state }
  }

  reset(): void {
    this.state = this.emptyState()
  }

  /** 输出/用量已出现后，当前响应触发的工具返回不能反过来成为它自己的起点。 */
  modelOutput(sessionId: string, turnId: string): void {
    if (this.matches(sessionId, turnId)) this.state.modelPending = true
  }

  observe(record: Record<string, unknown>, sessionId: string, currentTurnId: string): void {
    const payload = object(record.payload)
    if (!payload) return
    const payloadSession = string(payload.thread_id)
    if (payloadSession && payloadSession !== sessionId) return
    const turnId = string(payload.turn_id) || currentTurnId

    if (record.type === 'turn_context') {
      this.bind(sessionId, turnId)
      return
    }

    const eventType = string(payload.type)
    if (record.type === 'event_msg' && eventType === 'task_started') {
      this.bind(sessionId, turnId)
      this.advance(time(record.timestamp) || time(payload.started_at))
      return
    }

    if (record.type === 'event_msg' && eventType === 'user_message') {
      this.bind(sessionId, turnId)
      this.advance(time(record.timestamp))
      return
    }
    const item = object(payload.item)
    if (
      record.type === 'event_msg' &&
      eventType === 'item_completed' &&
      item?.type === 'UserMessage'
    ) {
      this.bind(sessionId, turnId)
      this.advance(time(payload.completed_at_ms) || time(record.timestamp))
      return
    }

    if (!this.matches(sessionId, turnId)) return
    if (
      record.type === 'event_msg' &&
      (eventType === 'token_usage_record' ||
        (eventType === 'item_completed' &&
          (item?.type === 'Reasoning' || item?.type === 'AgentMessage')))
    ) {
      this.modelOutput(sessionId, turnId)
      return
    }
    if (
      record.type === 'event_msg' &&
      (eventType === 'task_complete' || eventType === 'turn_aborted')
    ) {
      this.reset()
      return
    }

    if (record.type === 'response_item' && RESPONSE_TOOL_RESULTS.has(eventType)) {
      this.advance(time(record.timestamp))
      return
    }
    if (record.type !== 'event_msg') return
    if (CLIENT_TOOL_RESULTS.has(eventType)) {
      this.advance(time(payload.completed_at_ms) || time(record.timestamp))
      return
    }
    if (eventType !== 'item_completed') return
    if (!item) return
    if (CLIENT_TOOL_ITEMS.has(string(item.type))) {
      this.advance(time(payload.completed_at_ms) || time(record.timestamp))
    }
  }

  /** 只由扫描器已经去重并接纳的物理用量调用；不把重复快照变成新样本。 */
  accept(
    sessionId: string,
    turnId: string,
    completedAtMs: number,
    generatedTokens: number,
    physicalProgress: boolean,
    payloadTurnId = '',
  ): GenerationTiming | undefined {
    if (
      !this.matches(sessionId, turnId) ||
      (payloadTurnId && payloadTurnId !== turnId) ||
      !Number.isSafeInteger(completedAtMs) ||
      completedAtMs <= 0 ||
      completedAtMs <= this.state.acceptedAtMs ||
      !physicalProgress
    )
      return undefined

    const responseDurationMs = completedAtMs - this.state.anchorAtMs
    const timing: GenerationTiming | undefined =
      this.state.anchorAtMs > 0 &&
      responseDurationMs > 0 &&
      Number.isSafeInteger(generatedTokens) &&
      generatedTokens > 0
        ? {
            completedAtMs,
            timeSource: 'recorded',
            speedKind: 'response-estimate',
            responseDurationMs,
            generatedTokens,
          }
        : undefined
    // 没有更晚的用户/工具完成标记时，下一次调用回退到已接受的 API 用量时间。
    // 倒序记录不能把锚点退回过去。
    this.state.acceptedAtMs = completedAtMs
    this.state.modelPending = false
    this.state.anchorAtMs =
      this.state.nextAnchorAtMs > 0 && this.state.nextAnchorAtMs <= completedAtMs
        ? this.state.nextAnchorAtMs
        : Math.max(completedAtMs, this.state.anchorAtMs)
    this.state.nextAnchorAtMs = 0
    return timing
  }

  private bind(sessionId: string, turnId: string): void {
    if (this.state.sessionId === sessionId && this.state.turnId === turnId) return
    this.state = {
      sessionId,
      turnId,
      anchorAtMs: 0,
      acceptedAtMs: 0,
      modelPending: false,
      nextAnchorAtMs: 0,
    }
  }

  private matches(sessionId: string, turnId: string): boolean {
    return Boolean(turnId && this.state.sessionId === sessionId && this.state.turnId === turnId)
  }

  private advance(atMs: number): void {
    if (this.state.modelPending) {
      if (
        atMs > this.state.nextAnchorAtMs &&
        atMs > this.state.anchorAtMs &&
        atMs >= this.state.acceptedAtMs
      )
        this.state.nextAnchorAtMs = atMs
      return
    }
    if (atMs > this.state.anchorAtMs && atMs >= this.state.acceptedAtMs)
      this.state.anchorAtMs = atMs
  }

  private emptyState(): CodexGenerationEstimateState {
    return {
      sessionId: '',
      turnId: '',
      anchorAtMs: 0,
      acceptedAtMs: 0,
      modelPending: false,
      nextAnchorAtMs: 0,
    }
  }
}

function time(value: unknown): number {
  return typeof value === 'string' || typeof value === 'number' ? timestampEpochMs(value) : 0
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
