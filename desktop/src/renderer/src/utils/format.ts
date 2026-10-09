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
