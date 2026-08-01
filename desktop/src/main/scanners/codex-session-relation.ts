import type { TokenUsageApiCall } from './types'

export interface CodexSessionRelation {
  parentSessionId?: string
  subAgentName?: string
  isThreadSpawn?: boolean
}

export function applyCodexSessionRelations(
  apiCalls: TokenUsageApiCall[],
  relationBySessionId: Map<string, CodexSessionRelation>,
): void {
  for (const apiCall of apiCalls) {
    const relation = relationBySessionId.get(apiCall.sessionId)
    const parentSessionId =
      relation?.parentSessionId && relation.parentSessionId !== apiCall.sessionId
        ? relation.parentSessionId
        : ''
    const rootSessionId = resolveCodexRootSessionId(apiCall.sessionId, relationBySessionId)
    if (parentSessionId) apiCall.parentSessionId = parentSessionId
    if (rootSessionId !== apiCall.sessionId || parentSessionId) {
      apiCall.rootSessionId = rootSessionId
    }
    if (relation?.subAgentName) apiCall.subAgentName = relation.subAgentName
  }
}

export function readCodexSessionRelation(payload: unknown): CodexSessionRelation {
  if (!isObject(payload)) return {}
  let parentSessionId = readString(payload.parent_thread_id)
  let subAgentName = ''
  let isThreadSpawn = false
  const source = payload.source
  if (isObject(source)) {
    const subagent = source.subagent
    if (isObject(subagent)) {
      const threadSpawn = subagent.thread_spawn
      if (isObject(threadSpawn)) {
        isThreadSpawn = true
        parentSessionId = parentSessionId || readString(threadSpawn.parent_thread_id)
        subAgentName =
          normalizeCodexAgentPath(readString(threadSpawn.agent_path)) ||
          readString(threadSpawn.agent_nickname) ||
          readString(threadSpawn.agent_role)
      }
      subAgentName = subAgentName || readString(subagent.other)
    } else if (typeof subagent === 'string') {
      subAgentName = subagent.trim()
    }
  }
  if (!subAgentName && parentSessionId && readString(payload.thread_source) === 'subagent') {
    subAgentName = 'subagent'
  }
  return {
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(subAgentName ? { subAgentName } : {}),
    ...(isThreadSpawn ? { isThreadSpawn: true } : {}),
  }
}

function resolveCodexRootSessionId(
  sessionId: string,
  relationBySessionId: Map<string, CodexSessionRelation>,
): string {
  const seen = new Set<string>()
  let current = sessionId
  while (current) {
    if (seen.has(current)) return sessionId
    seen.add(current)
    const parentSessionId = relationBySessionId.get(current)?.parentSessionId
    if (!parentSessionId || parentSessionId === current) return current
    current = parentSessionId
  }
  return sessionId
}

function normalizeCodexAgentPath(value: string): string {
  if (!value) return ''
  return value.replace(/^\/+root\/+/, '').replace(/^\/+|\/+$/g, '')
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
