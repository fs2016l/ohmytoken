import type { TokenUsageSessionChild, TrackedProject } from '@shared/models'
import { combineCostRollups, unpricedCostRollup } from '@shared/cost-rollup'
import { latestGeneration } from '@shared/generation-timing'
import { latestTurnFirstToken } from '@shared/turn-timing'

export function sessionKey(session: { agent: string; sessionId: string }): string {
  return JSON.stringify([session.agent, session.sessionId])
}

/** One expandable child per real session, including all matching days and models. */
export function sessionChildren(rows: TokenUsageSessionChild[]): TokenUsageSessionChild[] {
  const grouped = new Map<string, TokenUsageSessionChild>()
  const incompleteCost = new Set<string>()
  for (const row of rows) {
    const key = sessionKey(row)
    if (!row.costSummary) incompleteCost.add(key)
    const previous = grouped.get(key)
    if (!previous) {
      grouped.set(key, { ...row })
      continue
    }
    const version = previous.costSummary?.catalogVersion ?? row.costSummary?.catalogVersion
    if (version) {
      previous.costSummary = combineCostRollups(
        [
          previous.costSummary ??
            unpricedCostRollup(
              previous.agent,
              previous.model,
              previous.totalTokens,
              previous.apiCallCount,
              version,
            ),
          row.costSummary ??
            unpricedCostRollup(row.agent, row.model, row.totalTokens, row.apiCallCount, version),
        ],
        version,
      )
    }
    for (const field of [
      'inputTokens',
      'outputTokens',
      'cacheReadTokens',
      'cacheWriteTokens',
      'reasoningTokens',
      'totalTokens',
      'apiCallCount',
    ] as const)
      previous[field] += row[field]
    previous.apiCallCountComplete =
      previous.apiCallCountComplete !== false && row.apiCallCountComplete !== false
    previous.latestGeneration = latestGeneration(previous.latestGeneration, row.latestGeneration)
    previous.latestTurnFirstToken = latestTurnFirstToken(
      previous.latestTurnFirstToken,
      row.latestTurnFirstToken,
    )
    if (row.endedAt > previous.endedAt) previous.endedAt = row.endedAt
    if (row.startedAt && (!previous.startedAt || row.startedAt < previous.startedAt))
      previous.startedAt = row.startedAt
    if (row.model !== previous.model) previous.model = '—'
  }
  for (const key of incompleteCost) {
    const session = grouped.get(key)!
    if (!session.costSummary?.pricedRecords) session.costSummary = undefined
  }
  return [...grouped.values()].sort((a, b) => b.endedAt.localeCompare(a.endedAt))
}

export function projectForPath(
  path: string | undefined,
  projects: TrackedProject[],
): TrackedProject | undefined {
  if (!path) return undefined
  const normalize = (value: string): string => {
    const slashes = value.replaceAll('\\', '/').replace(/\/+$/, '')
    return /^[a-z]:/i.test(slashes) || slashes.startsWith('//') ? slashes.toLowerCase() : slashes
  }
  const candidate = normalize(path)
  return projects
    .flatMap((project) =>
      (project.directories ?? [project.normalizedPath]).map((root) => ({
        project,
        root: normalize(root),
      })),
    )
    .filter((item) => candidate === item.root || candidate.startsWith(`${item.root}/`))
    .sort((a, b) => b.root.length - a.root.length)[0]?.project
}
