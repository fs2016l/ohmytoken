import { readUtf8Lines } from '../lib/line-reader'
import { conversationTurn, type ConversationTurn } from './conversation-turn'
import {
  ANTIGRAVITY_USER_EXPLICIT_SOURCE,
  type AntigravityStepMetadata,
  type AntigravityUsage,
} from './antigravity-protobuf'

/** transcript 只保留轮次和用量需要的字段，不在内存中留存消息内容。 */
export type AntigravityTranscriptRow = {
  stepIndex?: number
  userInput: boolean
  usage?: AntigravityUsage
  createdAt: unknown
  byteOffset: number
}

export function readAntigravityTranscript(file: string): AntigravityTranscriptRow[] {
  const rows: AntigravityTranscriptRow[] = []
  for (const line of readUtf8Lines(file)) {
    if (!line.line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line.line)
    } catch (error) {
      if (line.terminated === false) continue
      throw new Error(`transcript 第 ${line.lineIndex + 1} 行无效: ${message(error)}`)
    }
    if (!isObject(value)) continue
    rows.push({
      stepIndex: count(value.step_index),
      userInput: value.type === 'USER_INPUT' && value.source === 'USER_EXPLICIT',
      usage: transcriptUsage(value),
      createdAt: value.created_at,
      byteOffset: line.byteOffset,
    })
  }
  return rows
}

/**
 * 用户明确输入的 USER_INPUT 步骤开启新一轮；同一请求中的模型续跑、工具步骤和系统消息不新增轮次。
 * transcript 可能落后于 SQLite，未覆盖的步骤按原生 step 来源补齐。
 */
export function antigravityUserInputSteps(
  steps: ReadonlyMap<number, AntigravityStepMetadata>,
  rows: readonly AntigravityTranscriptRow[],
): number[] {
  const transcript = new Map<number, boolean>()
  for (const row of rows)
    if (row.stepIndex !== undefined)
      transcript.set(row.stepIndex, row.userInput || !!transcript.get(row.stepIndex))
  const result = [...transcript].filter(([, user]) => user).map(([idx]) => idx)
  for (const [idx, step] of steps)
    if (!transcript.has(idx) && step.source === ANTIGRAVITY_USER_EXPLICIT_SOURCE) result.push(idx)
  return result.sort((a, b) => a - b)
}

/** 归属到该 step 之前最近一次用户输入；之前没有用户输入时保持未知。 */
export function antigravityTurnForStep(
  userSteps: readonly number[],
  step: number | undefined,
): ConversationTurn | undefined {
  if (step === undefined) return undefined
  let low = 0
  let high = userSteps.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (userSteps[middle] <= step) low = middle + 1
    else high = middle
  }
  return low ? conversationTurn(`user:${userSteps[low - 1]}`) : undefined
}

function transcriptUsage(row: Record<string, unknown>): AntigravityUsage | undefined {
  const keys = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
  if (!keys.some((key) => count(row[key]) !== undefined)) return undefined
  return {
    inputTokens: count(row.input_tokens) ?? 0,
    outputTokens: count(row.output_tokens) ?? 0,
    cacheReadTokens: count(row.cache_read_tokens) ?? 0,
    cacheWriteTokens: count(row.cache_write_tokens) ?? 0,
    thinkingTokens: count(row.thinking_output_tokens) ?? 0,
    responseTokens: count(row.response_output_tokens),
  }
}

function count(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
