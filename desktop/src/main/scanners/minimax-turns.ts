import type Database from 'better-sqlite3'
import { conversationTurn, type ConversationTurn } from './conversation-turn'

export type MiniMaxTurnReader = (sessionId: string, turnId: unknown) => ConversationTurn | undefined

/** 问卷回答属于 Agent 在同一任务中的追问；后台任务与自动续跑由运行时发起。 */
const AUTOMATIC_SOURCES = new Set(['questionnaire', 'background-task', 'turn-continuation'])

/**
 * 按 runtime 的 turn_id 归轮：该轮用户消息来源为 api 才算用户发起；
 * 只有自动来源的轮次不计，没有可判断消息行的轮次保留未知。
 */
export function miniMaxTurnReader(db: Database.Database): MiniMaxTurnReader {
  const columns = new Set(
    (
      db.prepare('PRAGMA table_info(local_runtime_message_rows)').all() as Array<{ name: string }>
    ).map((row) => row.name.toLowerCase()),
  )
  if (!['session_id', 'turn_id', 'role', 'source'].every((name) => columns.has(name)))
    return () => undefined

  const readRows = db.prepare(`SELECT role, source FROM local_runtime_message_rows
    WHERE session_id = ? AND turn_id = ?`)
  const cache = new Map<string, ConversationTurn | undefined>()

  return (sessionId, turnId) => {
    if (typeof turnId !== 'string' || !turnId) return undefined
    const key = JSON.stringify([sessionId, turnId])
    if (cache.has(key)) return cache.get(key)
    const rows = readRows.all(sessionId, turnId) as Array<{ role: unknown; source: unknown }>
    const turn = rows.some((row) => row.role === 'user' && row.source === 'api')
      ? conversationTurn(turnId)
      : rows.some((row) => typeof row.source === 'string' && AUTOMATIC_SOURCES.has(row.source))
        ? conversationTurn(turnId, false)
        : undefined
    cache.set(key, turn)
    return turn
  }
}
