import type { TokenUsageSession, TokenUsageUserSession, SessionTurnScope } from './models'
import type { LatestSessionTurn, SessionTurnStatus } from './models'
import { normalizeLatestGeneration } from './generation-timing'
import { normalizeLatestTurnFirstToken } from './turn-timing'

const tokenFields = [
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'totalTokens',
] as const
export function normalizeLatestSessionTurn(
  input: unknown,
  sessionId?: string,
): LatestSessionTurn | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = input as LatestSessionTurn
  if (
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    value.sessionId.length > 2048 ||
    (sessionId && value.sessionId !== sessionId) ||
    typeof value.turnId !== 'string' ||
    !value.turnId ||
    value.turnId.length > 2048 ||
    !Number.isSafeInteger(value.startedAtMs) ||
    value.startedAtMs < 0 ||
    !Number.isSafeInteger(value.updatedAtMs) ||
    value.updatedAtMs < 0 ||
    !tokenFields.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0) ||
    value.totalTokens !==
      value.inputTokens +
        value.outputTokens +
        value.cacheReadTokens +
        value.cacheWriteTokens +
        value.reasoningTokens ||
    !Number.isSafeInteger(value.apiCallCount) ||
    value.apiCallCount < 0 ||
    !Array.isArray(value.models) ||
    value.models.length > 100 ||
    value.models.some((m) => typeof m !== 'string' || m.length > 1024)
  )
    return undefined
  const result: LatestSessionTurn = {
    sessionId: value.sessionId,
    turnId: value.turnId,
    startedAtMs: value.startedAtMs,
    updatedAtMs: value.updatedAtMs,
    usageAvailable: value.usageAvailable === true,
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    cacheReadTokens: value.cacheReadTokens,
    cacheWriteTokens: value.cacheWriteTokens,
    reasoningTokens: value.reasoningTokens,
    totalTokens: value.totalTokens,
    apiCallCount: value.apiCallCount,
    apiCallCountComplete: value.apiCallCountComplete === true,
    models: [...value.models],
    modelTotals: {},
  }
  if (['running', 'completed', 'interrupted', 'failed', 'waiting'].includes(String(value.status)))
    result.status = value.status as SessionTurnStatus
  for (const model of result.models) {
    const total = value.modelTotals?.[model]
    if (Number.isSafeInteger(total) && total >= 0) result.modelTotals[model] = total
  }
  const generation = normalizeLatestGeneration(value.latestGeneration)
  if (generation?.sessionId === value.sessionId) result.latestGeneration = generation
  const firstToken = normalizeLatestTurnFirstToken(value.latestTurnFirstToken)
  if (firstToken?.sessionId === value.sessionId && firstToken.turnId === value.turnId)
    result.latestTurnFirstToken = firstToken
  return result
}

/** Keep identity/favorites stable when changing the displayed usage scope. */
export function sessionTurnView<T extends TokenUsageSession>(
  session: T,
  scope: SessionTurnScope,
): T {
  if (scope !== 'latest') return session
  const turn = session.latestTurn
  const models = turn?.models ?? []
  return {
    ...session,
    turnScope: 'latest',
    startedAt: turn?.startedAtMs ? new Date(turn.startedAtMs).toISOString() : '',
    endedAt: turn?.updatedAtMs ? new Date(turn.updatedAtMs).toISOString() : '',
    inputTokens: turn?.inputTokens ?? 0,
    outputTokens: turn?.outputTokens ?? 0,
    cacheReadTokens: turn?.cacheReadTokens ?? 0,
    cacheWriteTokens: turn?.cacheWriteTokens ?? 0,
    reasoningTokens: turn?.reasoningTokens ?? 0,
    totalTokens: turn?.totalTokens ?? 0,
    apiCallCount: turn?.apiCallCount ?? 0,
    apiCallCountComplete: turn?.apiCallCountComplete ?? false,
    costSummary: turn?.costSummary,
    latestGeneration: turn?.latestGeneration,
    latestTurnFirstToken: turn?.latestTurnFirstToken,
    model: models[0] ?? 'unknown',
    turns: turn?.turnId ? { count: 1, complete: true } : { count: 0, complete: false },
    models,
    modelTotals: turn?.modelTotals ?? {},
    ...('agents' in session ? { agents: [session.agent] } : {}),
    ...('children' in session
      ? {
          children: [
            ...new Map(
              (session as unknown as TokenUsageUserSession).children.map((child) => [
                JSON.stringify([child.agent, child.sessionId]),
                child,
              ]),
            ).values(),
          ].map((child) => sessionTurnView(child, scope)),
        }
      : {}),
  }
}

export function hasTurnUsage(
  session: Pick<TokenUsageSession, 'turnScope' | 'latestTurn'>,
): boolean {
  return session.turnScope !== 'latest' || session.latestTurn?.usageAvailable === true
}
