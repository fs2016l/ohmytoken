import type { TokenUsageUserSession } from './models'

export type LocalFavoriteType = 'session' | 'project'
export interface LocalFavoriteTarget {
  type: LocalFavoriteType
  id: string
  agent?: string
}
export type FavoriteSessionSnapshot = Pick<
  TokenUsageUserSession,
  | 'agent'
  | 'rootSessionId'
  | 'title'
  | 'startedAt'
  | 'endedAt'
  | 'models'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadTokens'
  | 'cacheWriteTokens'
  | 'totalTokens'
  | 'reasoningTokens'
  | 'apiCallCount'
  | 'apiCallCountComplete'
  | 'turns'
  | 'latestGeneration'
  | 'latestTurnFirstToken'
> & { childCount: number }
export interface LocalFavorite extends LocalFavoriteTarget {
  agent: string
  position: number
  createdAt: number
  snapshot: FavoriteSessionSnapshot | null
}
export interface LocalFavoriteImport {
  target: LocalFavoriteTarget
  snapshot?: FavoriteSessionSnapshot
}
export interface LocalFavoritesState {
  revision: number
  items: LocalFavorite[]
}

export function localFavoriteKey(target: LocalFavoriteTarget): string {
  return JSON.stringify([target.type, target.agent || '', target.id])
}

export function sessionFavoriteSnapshot(session: TokenUsageUserSession): FavoriteSessionSnapshot {
  return {
    agent: session.agent,
    rootSessionId: session.rootSessionId,
    title: session.title,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    models: [...session.models],
    inputTokens: session.inputTokens,
    outputTokens: session.outputTokens,
    cacheReadTokens: session.cacheReadTokens,
    cacheWriteTokens: session.cacheWriteTokens,
    totalTokens: session.totalTokens,
    reasoningTokens: session.reasoningTokens,
    apiCallCount: session.apiCallCount,
    apiCallCountComplete: session.apiCallCountComplete,
    turns: session.turns,
    latestGeneration: session.latestGeneration,
    latestTurnFirstToken: session.latestTurnFirstToken,
    childCount: session.children.length,
  }
}
