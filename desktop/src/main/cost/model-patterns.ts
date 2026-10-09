import { RE2JS } from 're2js'
import type { PriceCard } from './price-catalog'

export interface ModelPattern {
  card: PriceCard
  pattern: RE2JS
}

/** RE2 avoids backtracking on remotely published expressions. Match the entire name. */
export function compileModelPatterns(models: readonly PriceCard[]): ModelPattern[] {
  const result: ModelPattern[] = []
  let instructions = 0
  for (const card of models) {
    if (card.matchPatterns === undefined) continue
    if (!Array.isArray(card.matchPatterns) || card.matchPatterns.length > 8)
      throw new Error('每个模型最多配置 8 条正则')
    for (const expression of card.matchPatterns) {
      if (
        typeof expression !== 'string' ||
        expression.length > 512 ||
        !expression.startsWith('^') ||
        !expression.endsWith('$') ||
        /\(\?(?!:)/.test(expression)
      )
        throw new Error('模型正则需以 ^ 开头、$ 结尾；不支持环视或内嵌标志')
      const pattern = RE2JS.compile(expression, RE2JS.CASE_INSENSITIVE)
      instructions += pattern.programSize()
      if (pattern.testExact('') || pattern.programSize() > 2048 || instructions > 100_000)
        throw new Error('模型正则过于复杂或可匹配空名称')
      result.push({ card, pattern })
      if (result.length > 1024) throw new Error('模型正则总数不能超过 1024')
    }
  }
  return result
}

export function uniquePatternMatch(
  model: string,
  patterns: readonly ModelPattern[],
  vendor?: string,
): PriceCard | undefined {
  let found: PriceCard | undefined
  for (const { card, pattern } of patterns) {
    if (vendor && card.vendor !== vendor) continue
    if (!pattern.testExact(model)) continue
    if (found && found !== card) return undefined
    found = card
  }
  return found
}
