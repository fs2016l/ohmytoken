import type { TokenUsageApiCall } from '../../shared/models'

export type ConversationTurn = NonNullable<TokenUsageApiCall['turn']>

export function conversationTurn(id: unknown, userInitiated = true): ConversationTurn | undefined {
  const value = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    ? { id: value, userInitiated }
    : undefined
}

/** 工具返回也可能使用 user 角色，只有实际输入内容才能开启新请求。 */
export function isUserPrompt(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (!Array.isArray(value)) return false
  if (
    value.some(
      (part) =>
        part &&
        typeof part === 'object' &&
        (part.type === 'tool_result' || part.type === 'functionResponse' || part.functionResponse),
    )
  )
    return false
  return value.some((part) => {
    if (!part || typeof part !== 'object') return false
    return (
      (typeof part.text === 'string' && part.text.trim().length > 0) ||
      ['image', 'image_url', 'input_image', 'file'].includes(part.type) ||
      Boolean(part.inlineData)
    )
  })
}

export function kimiConversationTurn(
  current: ConversationTurn | undefined,
  event: Record<string, unknown>,
  fallbackId: string,
): ConversationTurn | undefined {
  if (event.type !== 'turn.prompt' && event.type !== 'turn.steer') return current
  const origin =
    event.origin && typeof event.origin === 'object'
      ? (event.origin as Record<string, unknown>).kind
      : event.origin
  if (['retry', 'compaction_summary', 'injection', 'hook_result'].includes(String(origin)))
    return current
  if (typeof origin !== 'string') return undefined
  const id = event.promptId ?? event.id ?? fallbackId
  return conversationTurn(id, origin === 'user' && (!event.agentId || event.agentId === 'main'))
}
