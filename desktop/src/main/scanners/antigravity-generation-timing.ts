import type { GenerationTiming } from '../../shared/models'
import type { AntigravityGeneration, AntigravityStepMetadata } from './antigravity-protobuf'

/**
 * 首个片段在 #12 窗口开始前已生成；窗口只覆盖一两个片段时速度系统性偏高
 * （本机纯文本 < 250 ms 为长窗口的 1.7–4.3 倍），短于该值的响应不作为流速样本。
 */
export const ANTIGRAVITY_MIN_STREAM_WINDOW_MS = 2000

/**
 * Antigravity 原生 #11 是 step 创建至首个可见片段，#12 是首个片段至完成。
 * 思考在首个片段前生成，工具调用参数整块下发，所以只有纯文本响应的可见正文
 * 落在 #12 窗口内；其他调用只提供首 Token，不替换会话已有的流速样本。
 */
export function antigravityGenerationTiming(
  generation: Partial<AntigravityGeneration>,
  step: AntigravityStepMetadata | undefined,
  linkedSteps: readonly AntigravityStepMetadata[],
  visibleTokens: number | undefined,
): GenerationTiming | undefined {
  const timeToFirstTokenMs = generation.timeToFirstTokenMs
  const streamDurationMs = generation.streamDurationMs
  const hasFirstToken = timeToFirstTokenMs !== undefined && timeToFirstTokenMs >= 0
  const completedAtMs = step?.finishedAtMs ?? step?.completedAtMs
  if (!completedAtMs) return undefined
  const identity = {
    completedAtMs,
    ...(step?.finishedAtMs ? {} : { timeSource: 'recorded' as const }),
  }
  const textStream =
    streamDurationMs !== undefined &&
    streamDurationMs >= ANTIGRAVITY_MIN_STREAM_WINDOW_MS &&
    visibleTokens !== undefined &&
    visibleTokens > 0 &&
    linkedSteps.length > 0 &&
    !linkedSteps.some((linked) => linked.toolCall)
  if (textStream)
    return {
      ...identity,
      ...(hasFirstToken ? { timeToFirstTokenMs } : {}),
      streamDurationMs,
      generatedTokens: visibleTokens,
    }
  if (!hasFirstToken) return undefined
  return { ...identity, timeToFirstTokenMs, speedExcluded: true }
}

/**
 * 调用方已核验同一原生请求与计量快照后，只补齐同完成边界的字段。
 * `toolCall` 汇总该请求全部关联 step；任一记录带工具调用时只保留首 Token。
 */
export function completeAntigravityGenerationTiming(
  previous: GenerationTiming | undefined,
  current: GenerationTiming | undefined,
  toolCall: boolean,
): GenerationTiming | undefined {
  if (!current) return previous
  if (!previous) return current
  if (
    previous.completedAtMs !== current.completedAtMs ||
    (previous.timeToFirstTokenMs !== undefined &&
      current.timeToFirstTokenMs !== undefined &&
      previous.timeToFirstTokenMs !== current.timeToFirstTokenMs) ||
    (previous.streamDurationMs !== undefined &&
      current.streamDurationMs !== undefined &&
      previous.streamDurationMs !== current.streamDurationMs)
  )
    return previous
  const timeSource =
    previous.timeSource === 'recorded' && current.timeSource === 'recorded'
      ? { timeSource: 'recorded' as const }
      : {}
  const timeToFirstTokenMs = previous.timeToFirstTokenMs ?? current.timeToFirstTokenMs
  const streamDurationMs = previous.streamDurationMs ?? current.streamDurationMs
  const generatedTokens = previous.generatedTokens ?? current.generatedTokens
  if (!toolCall && streamDurationMs !== undefined && generatedTokens !== undefined)
    return {
      completedAtMs: previous.completedAtMs,
      ...timeSource,
      ...(timeToFirstTokenMs !== undefined ? { timeToFirstTokenMs } : {}),
      streamDurationMs,
      generatedTokens,
    }
  return timeToFirstTokenMs === undefined
    ? undefined
    : {
        completedAtMs: previous.completedAtMs,
        ...timeSource,
        timeToFirstTokenMs,
        speedExcluded: true,
      }
}
