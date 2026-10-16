import type { GenerationTiming } from '../../shared/models'
import { timestampEpochMs } from '../lib/date-utils'

export interface CodexGenerationEstimateState {
  sessionId: string
  turnId: string
  anchorAtMs: number
  acceptedAtMs: number
  modelPending: boolean
  nextAnchorAtMs: number
  /** 当前 API 最早的原生输出开始时间；-1 表示首个输出是只记录完成时间的工具调用。 */
  firstOutputAtMs: number
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
/** 带原生开始时间的模型输出项：推理项在输出推理摘要时于推理开始即创建。 */
const MODEL_OUTPUT_ITEMS = new Set(['Reasoning', 'AgentMessage'])

/**
 * Codex 默认 rollout 没有逐 API 的首个流 Token 时间。这里只估算响应区间，
 * 区间包含首字等待和客户端时间，缺少工具返回标记时还可能包含工具时间。
 * 推理与正文项保存原生开始时间，据此推导本次 API 的估算首字；首个输出是
 * 工具调用时 rollout 只有参数完整后的记录时间，不能当作首字。
 */
export class CodexGenerationEstimate {
  private state: CodexGenerationEstimateState

  constructor(state?: CodexGenerationEstimateState) {
    // 旧检查点没有首输出字段时按尚未观察处理。
    this.state = { ...this.emptyState(), ...state }
  }

  snapshot(): CodexGenerationEstimateState {
    return { ...this.state }
  }

  reset(): void {
    this.state = this.emptyState()
  }

  /** 输出/用量已出现后，当前响应触发的工具返回不能反过来成为它自己的起点。 */
  modelOutput(sessionId: string, turnId: string, toolCall = false): void {
    if (!this.matches(sessionId, turnId)) return
    if (toolCall && this.state.firstOutputAtMs === 0) this.state.firstOutputAtMs = -1
    this.state.modelPending = true
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
      eventType === 'item_completed' &&
      item?.type === 'ContextCompaction'
    ) {
      // 压缩是两次模型请求之间的独立步骤，下一次请求在压缩完成后才发出。
      this.restart(time(payload.completed_at_ms) || time(record.timestamp))
      return
    }
    if (
      record.type === 'event_msg' &&
      (eventType === 'token_usage_record' ||
        (eventType === 'item_completed' && MODEL_OUTPUT_ITEMS.has(string(item?.type))))
    ) {
      if (eventType === 'item_completed') this.firstOutput(time(payload.started_at_ms))
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
    const firstOutputAtMs = this.state.firstOutputAtMs
    const timeToFirstTokenMs =
      firstOutputAtMs > 0 &&
      firstOutputAtMs >= this.state.anchorAtMs &&
      firstOutputAtMs <= completedAtMs
        ? firstOutputAtMs - this.state.anchorAtMs
        : undefined
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
            ...(timeToFirstTokenMs !== undefined
              ? { timeToFirstTokenMs, ttftKind: 'estimate' as const }
              : {}),
          }
        : undefined
    // 没有更晚的用户/工具完成标记时，下一次调用回退到已接受的 API 用量时间。
    // 倒序记录不能把锚点退回过去。
    this.state.acceptedAtMs = completedAtMs
    this.state.modelPending = false
    this.state.firstOutputAtMs = 0
    this.state.anchorAtMs =
      this.state.nextAnchorAtMs > 0 && this.state.nextAnchorAtMs <= completedAtMs
        ? this.state.nextAnchorAtMs
        : Math.max(completedAtMs, this.state.anchorAtMs)
    this.state.nextAnchorAtMs = 0
    return timing
  }

  private bind(sessionId: string, turnId: string): void {
    if (this.state.sessionId === sessionId && this.state.turnId === turnId) return
    this.state = { ...this.emptyState(), sessionId, turnId }
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

  /** 只取当前起点之后最早的原生输出开始；工具调用先于推理/正文出现时保持无首字。 */
  private firstOutput(atMs: number): void {
    if (
      atMs <= 0 ||
      this.state.firstOutputAtMs < 0 ||
      atMs < this.state.anchorAtMs ||
      atMs < this.state.acceptedAtMs
    )
      return
    if (this.state.firstOutputAtMs === 0 || atMs < this.state.firstOutputAtMs)
      this.state.firstOutputAtMs = atMs
  }

  /** 压缩请求自身的用量记录不属于下一次 API；以压缩完成时间重新起算。 */
  private restart(atMs: number): void {
    if (atMs <= 0 || atMs < this.state.acceptedAtMs) return
    this.state.anchorAtMs = Math.max(this.state.anchorAtMs, atMs)
    this.state.modelPending = false
    this.state.nextAnchorAtMs = 0
    this.state.firstOutputAtMs = 0
  }

  private emptyState(): CodexGenerationEstimateState {
    return {
      sessionId: '',
      turnId: '',
      anchorAtMs: 0,
      acceptedAtMs: 0,
      modelPending: false,
      nextAnchorAtMs: 0,
      firstOutputAtMs: 0,
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
