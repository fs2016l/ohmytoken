import type { GenerationTiming } from '../../shared/models'

/** 新版的 streamed 在模型流结束时写入，completed 还可能包含后续工具执行。 */
export function openCodeGenerationTiming(
  data: Record<string, unknown>,
  generatedTokens: number,
): GenerationTiming | undefined {
  const time = data.time
  if (!time || typeof time !== 'object' || Array.isArray(time)) return undefined
  const { created, streamed, completed } = time as Record<string, unknown>
  if (
    !epochMs(created) ||
    !epochMs(streamed) ||
    streamed <= created ||
    !epochMs(completed) ||
    completed < streamed ||
    (data.error !== undefined && data.error !== null) ||
    (data.retry !== undefined && data.retry !== null) ||
    !['stop', 'tool-calls', 'length'].includes(String(data.finish)) ||
    !Number.isSafeInteger(generatedTokens) ||
    generatedTokens <= 0
  )
    return undefined
  const firstOutput = firstReasoningOutput(data, created, streamed)
  if (firstOutput !== undefined)
    return {
      completedAtMs: streamed,
      timeToFirstTokenMs: firstOutput - created,
      streamDurationMs: streamed - firstOutput,
      generatedTokens,
    }
  // created 是客户端步骤起点，区间包含首输出等待，不能当成纯流时长或首字延迟。
  return {
    completedAtMs: streamed,
    speedKind: 'response-estimate',
    responseDurationMs: streamed - created,
    generatedTokens,
  }
}

/** 兼容协议只有收到非空标量推理内容才创建此块；其他协议的空块不能作首输出。 */
function firstReasoningOutput(
  data: Record<string, unknown>,
  started: number,
  streamed: number,
): number | undefined {
  // 不跳过更早的正文或工具块，以免把中途推理当成整次 API 的首输出。
  if (record(data.model)?.providerID !== 'opencode' || !Array.isArray(data.content))
    return undefined
  const first = record(data.content[0])
  if (first?.type !== 'reasoning' || typeof first.text !== 'string' || !first.text.length)
    return undefined
  const state = record(first.state)
  if (
    !state ||
    state.reasoningField !== 'reasoning_content' ||
    Object.hasOwn(state, 'reasoningDetails')
  )
    return undefined
  const time = record(first.time)
  if (
    !time ||
    !epochMs(time.created) ||
    !epochMs(time.completed) ||
    time.created < started ||
    time.created >= streamed ||
    time.completed < time.created ||
    time.completed > streamed
  )
    return undefined
  return time.created
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function epochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
