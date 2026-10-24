import { formatNumber } from './number-format'

/**
 * 将 token 数量格式化为人类可读的简短形式
 *
 * - null / NaN / undefined → '0'
 * 与动画数字共用 K/M/B 进位，最多两位小数，去掉无意义的末尾零。
 *
 * @example
 *   formatTokens(1500)      // '1.5K'
 *   formatTokens(2_300_000) // '2.3M'
 *   formatTokens(null)      // '0'
 */
export function formatTokens(n: number | null | undefined): string {
  return formatNumber(n != null && Number.isFinite(n) ? n : 0, { compact: true })
}

/**
 * formatTokens 的"空值占位"版本：0 或 falsy 时返回 '-' 而非 '0'
 * 适用于表格/卡片中"无数据"的视觉提示
 *
 * @example
 *   formatTokensOrDash(0)        // '-'
 *   formatTokensOrDash(null)     // '-'
 *   formatTokensOrDash(1500)     // '1.5K'
 */
export function formatTokensOrDash(n: number | null | undefined): string {
  if (!n) return '-'
  return formatTokens(n)
}

/**
 * 把一组数值相对总量的占比整体分配为整数百分比，供 "16.27K(1%)" 这类展示拼接
 *
 * 各项不是独立四舍五入，而是按最大余数法联合分配，保证显示值能对得上合计：
 * - 数值为 0 / 空，或总量为 0 / 空时返回 null，调用方不渲染
 * - 不足 1% 的非零项显示 '<1%'，并至少从合计中预留 1 个百分点，
 *   因此其余各项之和严格小于合计，避免出现 "<1% + <1% + 100%"
 * - 其余各项先取整数部分，再把剩余百分点按小数余量从大到小补齐
 *
 * @example
 *   allocateShares([16_780, 8_010_000, 2_371_000_000], 2_380_000_000) // ['<1%', '<1%', '99%']
 *   allocateShares([304, 696], 1_000)                                // ['30%', '70%']
 *   allocateShares([0, 500], 500)                                    // [null, '100%']
 */
export function allocateShares(
  values: ReadonlyArray<number | null | undefined>,
  total: number | null | undefined,
): (string | null)[] {
  const result: (string | null)[] = values.map(() => null)
  if (!total || !Number.isFinite(total) || total <= 0) return result
  const percents = values.map((value) =>
    value && Number.isFinite(value) && value > 0 ? (value / total) * 100 : 0,
  )
  const active = percents.map((_, index) => index).filter((index) => percents[index] > 0)
  if (!active.length) return result
  const small = active.filter((index) => percents[index] < 1)
  const large = active.filter((index) => percents[index] >= 1)
  for (const index of small) result[index] = '<1%'
  if (!large.length) return result
  const sum = active.reduce((acc, index) => acc + percents[index], 0)
  const smallSum = small.reduce((acc, index) => acc + percents[index], 0)
  const reserved = small.length ? Math.max(1, Math.round(smallSum)) : 0
  const allocation = new Map(large.map((index) => [index, Math.floor(percents[index])]))
  const fraction = (index: number): number => percents[index] - Math.floor(percents[index])
  const byRemainder = [...large].sort((a, b) => fraction(b) - fraction(a))
  let diff =
    Math.round(sum) - reserved - large.reduce((acc, index) => acc + allocation.get(index)!, 0)
  for (let cursor = 0; diff > 0; cursor = (cursor + 1) % byRemainder.length, diff--) {
    const index = byRemainder[cursor]
    allocation.set(index, allocation.get(index)! + 1)
  }
  for (let cursor = byRemainder.length - 1; diff < 0 && cursor >= 0; cursor--) {
    const index = byRemainder[cursor]
    const current = allocation.get(index)!
    if (current > 1) {
      allocation.set(index, current - 1)
      diff++
    }
  }
  for (const index of large) result[index] = `${allocation.get(index)}%`
  return result
}

export type TokenShareBucket = 'input' | 'output' | 'cache' | 'reasoning'

export interface TokenShareUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
}

/** 输入 / 输出 / 缓存（读+写）/ 推理 相对 totalTokens 的联合占比，缺少用量时全部为 null */
export function tokenShares(
  usage: TokenShareUsage | null | undefined,
): Record<TokenShareBucket, string | null> {
  if (!usage) return { input: null, output: null, cache: null, reasoning: null }
  const [input, output, cache, reasoning] = allocateShares(
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens + usage.cacheWriteTokens,
      usage.reasoningTokens,
    ],
    usage.totalTokens,
  )
  return { input, output, cache, reasoning }
}
