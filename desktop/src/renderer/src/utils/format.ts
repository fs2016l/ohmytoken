/**
 * 通用格式化工具函数（跨页面共享）
 *
 * 设计原则：纯函数、零业务依赖、无副作用
 */

/**
 * 将 token 数量格式化为人类可读的简短形式
 *
 * - null / NaN / undefined → '0'
 * - >= 1e9 → 'X.XXB'（Billion）
 * - >= 1e6 → 'X.XXM'（Million）
 * - >= 1e3 → 'X.XK'（Thousand）
 * - 其他 → 原数字字符串
 *
 * @example
 *   formatTokens(1500)      // '1.5K'
 *   formatTokens(2_300_000) // '2.30M'
 *   formatTokens(null)      // '0'
 */
export function formatTokens(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '0'
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return n.toString()
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
