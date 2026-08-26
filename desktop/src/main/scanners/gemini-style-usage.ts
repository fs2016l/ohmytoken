import { tokenBuckets, tokenCount } from './token-usage'

/** 将 usageMetadata 形态的计数转换为应用内部的五类 token 记录。 */

export interface ExclusiveTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

export interface GeminiStyleTokenParts {
  /** 原始输入计数 */
  input: number
  /** 原始输出计数 */
  output: number
  /** 缓存读取计数 */
  cached: number
  /** 推理计数 */
  thoughts: number
  /** 计入输入的工具调用计数 */
  tool: number
  /** 数据源附带的总量 */
  reportedTotal: number
  /** headless usage_metadata 的 prompt/input 明确包含缓存命中。 */
  inputIncludesCache?: boolean
  /** 来源明确声明 candidates/output 已包含 thoughts/reasoning。 */
  outputIncludesThoughts?: boolean
}

export function normalizeGeminiStyleUsage(
  parts: GeminiStyleTokenParts,
): ExclusiveTokenUsage | null {
  const input = tokenCount(parts.input)
  const tool = tokenCount(parts.tool)
  const grossInput = input + tool
  const rawOutput = tokenCount(parts.output)
  const rawCache = tokenCount(parts.cached)
  const rawThoughts = tokenCount(parts.thoughts)
  const reportedTotal = tokenCount(parts.reportedTotal)

  // usageMetadata 的 cachedContentTokenCount 是 promptTokenCount 的子集；部分旧的
  // message.tokens 则已经把 input/cache 拆开。调用方必须按来源形态明确标记。
  const cacheIsIncluded = parts.inputIncludesCache === true
  const cacheReadTokens = cacheIsIncluded ? Math.min(input, rawCache) : rawCache
  const inputTokens = cacheIsIncluded ? grossInput - cacheReadTokens : grossInput
  const accountedInput = inputTokens + cacheReadTokens

  let reasoningTokens = parts.outputIncludesThoughts
    ? Math.min(rawThoughts, rawOutput)
    : rawThoughts
  let outputTokens = parts.outputIncludesThoughts ? rawOutput - reasoningTokens : rawOutput
  if (reportedTotal >= accountedInput && reportedTotal > 0) {
    const outputPool = reportedTotal - accountedInput

    if (outputPool === rawOutput + rawThoughts) {
      // Gemini 常见形态：candidates 与 thoughts 彼此独立。
      outputTokens = rawOutput
      reasoningTokens = rawThoughts
    } else if (outputPool === rawOutput && rawThoughts <= rawOutput) {
      // Qwen/OpenAI 兼容形态：candidates 已包含 thoughts。
      outputTokens = rawOutput - rawThoughts
      reasoningTokens = rawThoughts
    } else {
      // 字段组合不完整或供应商口径发生变化时，以官方 total 为锚点，优先保留
      // 明确给出的 thoughts，其余归入普通输出，避免总量重复或丢失。
      reasoningTokens = Math.min(rawThoughts, outputPool)
      outputTokens = outputPool - reasoningTokens
    }
  }

  const usage = tokenBuckets({
    inputTokens,
    outputTokens,
    cacheReadTokens,
    reasoningTokens,
  })
  return usage.totalTokens > 0 ? usage : null
}
