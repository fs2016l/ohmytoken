/** Shared by SQLite session search and project / aggregate-only matching. */
export function normalizeWorkspaceSearchText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s\u200b-\u200d\ufeff]/gu, '')
    : ''
}

/** Keep the existing OR-keyword behavior; spacing and letter case do not affect a hit. */
export function workspaceSearchKeywords(query: string | undefined): string[] {
  if (typeof query !== 'string') return []
  const keywords = new Set<string>()
  for (const word of query
    .normalize('NFKC')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .trim()
    .split(/\s+/u)) {
    const keyword = normalizeWorkspaceSearchText(word).slice(0, 80)
    if (keyword) keywords.add(keyword)
    if (keywords.size >= 12) break
  }
  return [...keywords]
}

export function matchesWorkspaceSearch(keywords: readonly string[], fields: unknown[]): boolean {
  return (
    !keywords.length ||
    fields.some((field) => {
      const text = normalizeWorkspaceSearchText(field)
      return keywords.some((keyword) => text.includes(keyword))
    })
  )
}
