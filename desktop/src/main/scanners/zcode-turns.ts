import type Database from 'better-sqlite3'
import { conversationTurn, type ConversationTurn } from './conversation-turn'

export type ZCodeTurnReader = (
  sessionId: string,
  userMessageId: unknown,
  childSession: boolean,
) => ConversationTurn | undefined

/**
 * 按触发请求的用户消息归轮：semantics.origin 为 real_user 的输入开启新轮次；
 * 提醒、后台通知和压缩摘要等运行时消息归入同一会话此前最近的真实输入。
 * 缺少 semantics 的旧格式保留未知，子 Agent 的任务输入不计为用户轮次。
 */
export function zCodeTurnReader(db: Database.Database): ZCodeTurnReader {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(message)').all() as Array<{ name: string }>).map((row) =>
      row.name.toLowerCase(),
    ),
  )
  if (!['id', 'session_id', 'data', 'time_created'].every((name) => columns.has(name)))
    return () => undefined

  const readUser = db.prepare(`SELECT json_extract(data, '$.semantics.origin') origin, time_created
    FROM message WHERE id = ? AND session_id = ? AND json_valid(data)
      AND json_extract(data, '$.role') = 'user'`)
  const readPrompt = db.prepare(`SELECT id FROM message
    WHERE session_id = ? AND (time_created < ? OR (time_created = ? AND id < ?)) AND json_valid(data)
      AND json_extract(data, '$.role') = 'user'
      AND json_extract(data, '$.semantics.origin') = 'real_user'
    ORDER BY time_created DESC, id DESC LIMIT 1`)
  const cache = new Map<string, ConversationTurn | undefined>()

  return (sessionId, userMessageId, childSession) => {
    if (typeof userMessageId !== 'string' || !userMessageId) return undefined
    if (childSession) return conversationTurn(userMessageId, false)
    const key = JSON.stringify([sessionId, userMessageId])
    if (cache.has(key)) return cache.get(key)
    const user = readUser.get(userMessageId, sessionId) as
      { origin: unknown; time_created: number } | undefined
    let turn: ConversationTurn | undefined
    if (user?.origin === 'real_user') turn = conversationTurn(userMessageId)
    else if (typeof user?.origin === 'string') {
      const prompt = readPrompt.get(
        sessionId,
        user.time_created,
        user.time_created,
        userMessageId,
      ) as { id: string } | undefined
      turn = prompt ? conversationTurn(prompt.id) : conversationTurn(userMessageId, false)
    }
    cache.set(key, turn)
    return turn
  }
}
