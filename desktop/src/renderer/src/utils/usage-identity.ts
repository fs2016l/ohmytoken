import type { TokenUsageSession, TokenUsageUserSession } from '@shared/models'
import { orderByLatestActivity, updateLatestActivity } from '@shared/usage-activity'

/** Read existing participation lists; never infer links between independent sessions. */
export function sessionIdentity(session: TokenUsageSession, sources: TokenUsageSession[] = []) {
  const userSession = session as Partial<TokenUsageUserSession>
  const agents = userSession.agents?.length ? userSession.agents : [session.agent]
  const modelActivity = new Map<string, number>()
  if (!userSession.models) {
    for (const row of sources)
      updateLatestActivity(
        modelActivity,
        row.model,
        Date.parse(row.endedAt) || Date.parse(row.startedAt) || Date.parse(row.date),
      )
  }
  const models =
    userSession.models ?? (sources.length ? orderByLatestActivity(modelActivity) : [session.model])
  const modelTotals =
    userSession.modelTotals ??
    Object.fromEntries(
      [...new Set(models)].map((model) => [
        model,
        sources.length
          ? sources
              .filter((row) => row.model === model)
              .reduce((sum, row) => sum + row.totalTokens, 0)
          : session.totalTokens,
      ]),
    )
  return {
    agents,
    models,
    agentTotals: agents.length === 1 ? { [agents[0]]: session.totalTokens } : undefined,
    modelTotals,
  }
}
