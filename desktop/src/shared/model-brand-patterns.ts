import { RE2JS } from 're2js'

/** Brand patterns classify display identity only, never a priced model. */
export function compileBrandPatterns(rows: readonly { matchPatterns?: unknown }[]): RE2JS[][] {
  let instructions = 0
  return rows.map(({ matchPatterns }) => {
    if (matchPatterns === undefined) return []
    if (!Array.isArray(matchPatterns) || matchPatterns.length > 8)
      throw new Error('每个品牌最多配置 8 条正则')
    return matchPatterns.map((expression) => {
      if (
        typeof expression !== 'string' ||
        expression.length > 512 ||
        !expression.startsWith('^') ||
        !expression.endsWith('$') ||
        /\(\?(?!:)/.test(expression)
      )
        throw new Error('品牌正则需以 ^ 开头、$ 结尾；不支持环视或内嵌标志')
      const pattern = RE2JS.compile(expression, RE2JS.CASE_INSENSITIVE)
      instructions += pattern.programSize()
      if (pattern.testExact('') || pattern.programSize() > 2048 || instructions > 100_000)
        throw new Error('品牌正则过于复杂或可匹配空名称')
      return pattern
    })
  })
}
