import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { conversationTurn, type ConversationTurn } from './conversation-turn'

interface UserRequest {
  turn: ConversationTurn
  fingerprint: string
  continued?: boolean
}
interface TurnReader {
  (sessionId: string, parentId: unknown, messageId?: string): ConversationTurn | undefined
  observe(sessionId: string, id: string, data: Record<string, unknown>): void
}

/** V2 uses typed, sequenced messages; compaction and synthetic inputs are separate row types. */
function nativeTurnReader(
  db: Database.Database,
  table: 'message' | 'session_message',
): (sessionId: string, id: unknown) => ConversationTurn | undefined {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
  if (
    table !== 'session_message' ||
    !['id', 'session_id', 'type', 'seq', 'data'].every((name) => columns.has(name))
  )
    return () => undefined
  const read = db.prepare(`SELECT u.id, u.data FROM session_message m
    JOIN session_message u ON u.session_id=m.session_id AND u.seq<=m.seq
    WHERE m.session_id=? AND m.id=? AND m.type IN ('user','assistant')
      AND json_valid(m.data) AND json_type(m.data,'$.role') IS NULL AND u.type='user'
    ORDER BY u.seq DESC LIMIT 1`)
  const cache = new Map<string, ConversationTurn | undefined>()
  return (sessionId, id) => {
    if (typeof id !== 'string') return undefined
    const key = JSON.stringify([sessionId, id])
    if (cache.has(key)) return cache.get(key)
    let turn: ConversationTurn | undefined
    const row = read.get(sessionId, id) as { id: string; data: string } | undefined
    if (row) {
      try {
        const data = JSON.parse(row.data) as Record<string, unknown> | null
        if (
          data &&
          !data.role &&
          !data.synthetic &&
          !data.ignored &&
          ((typeof data.text === 'string' && data.text.trim().length > 0) ||
            (Array.isArray(data.files) && data.files.length > 0) ||
            (Array.isArray(data.agents) && data.agents.length > 0))
        )
          turn = conversationTurn(row.id)
      } catch {
        // An unrecognized user boundary must not assign the next API to an older request.
      }
    }
    cache.set(key, turn)
    return turn
  }
}

/** 按用户消息 ID 读取内容块，自动压缩续跑与重放仍归入原请求。 */
export function openCodeTurnReader(
  db: Database.Database,
  table: 'message' | 'session_message',
  streamedUsers = false,
): TurnReader {
  const readNative = nativeTurnReader(db, table)
  const native = (
    sessionId: string,
    parentId: unknown,
    messageId?: string,
  ): ConversationTurn | undefined =>
    readNative(sessionId, typeof parentId === 'string' ? parentId : messageId)
  const columns = new Set(
    (db.prepare('PRAGMA table_info(part)').all() as Array<{ name: string }>).map((row) => row.name),
  )
  if (!['message_id', 'data', 'id'].every((name) => columns.has(name)))
    return Object.assign(native, { observe() {} })

  const readParts = db.prepare('SELECT data FROM part WHERE message_id = ? ORDER BY id')
  const readUser = db.prepare(`SELECT json_extract(data, '$.role') role,
    json_extract(data, '$.time.created') created FROM ${table}
    WHERE session_id = ? AND id = ? AND json_valid(data)`)
  const readPrevious = db.prepare(`SELECT id, json_extract(data, '$.role') role,
    json_extract(data, '$.parentID') parent_id, json_extract(data, '$.summary') summary FROM ${table}
    WHERE session_id = ? AND id < ? AND json_valid(data) ORDER BY id DESC LIMIT 1`)
  const cache = new Map<string, UserRequest | undefined>()
  const lastInSession = new Map<string, UserRequest | undefined>()
  const keyOf = (session: string, id: string): string => JSON.stringify([session, id])

  function assess(
    parentId: string,
    created: number,
    previous: () => UserRequest | undefined,
  ): UserRequest | undefined {
    const parts: Record<string, unknown>[] = []
    for (const row of readParts.iterate(parentId) as Iterable<{ data: string }>) {
      try {
        const part: unknown = JSON.parse(row.data)
        if (!part || typeof part !== 'object' || Array.isArray(part)) return undefined
        parts.push(part as Record<string, unknown>)
      } catch {
        return undefined
      }
    }
    const inputs = parts.filter(
      (part) => !part.synthetic && !part.ignored && (part.type === 'text' || part.type === 'file'),
    )
    if (!inputs.length) {
      if (
        !parts.length ||
        !parts.every((part) => part.synthetic || part.type === 'compaction' || part.ignored)
      )
        return undefined
      const prior = previous()
      return prior ? { ...prior, continued: true } : undefined
    }
    const times = inputs
      .map((part) => (part.time as { start?: number } | undefined)?.start)
      .filter((value): value is number => typeof value === 'number' && value > 0)
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          inputs.map((part) =>
            Object.fromEntries(
              Object.entries(part)
                .filter(([field]) => !['id', 'messageID', 'sessionID'].includes(field))
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        ),
      )
      .digest('hex')
    const original = !times.length || times.some((time) => time < created) ? previous() : undefined
    const duplicate =
      original?.fingerprint === fingerprint && (times.length > 0 || original.continued)
    // 旧内容块没有时间时，压缩后相同文本可能是重放，也可能是用户重发，只给出已确认下限。
    const turn = duplicate
      ? { ...original.turn, ...(!times.length ? { complete: false as const } : {}) }
      : conversationTurn(parentId)
    return turn ? { turn, fingerprint } : undefined
  }

  function resolve(sessionId: string, parentId: string, depth = 0): UserRequest | undefined {
    const key = keyOf(sessionId, parentId)
    if (cache.has(key)) return cache.get(key)
    if (depth > 32) return undefined
    cache.set(key, undefined)
    const parent = readUser.get(sessionId, parentId) as
      { role: string; created: number } | undefined
    if (parent?.role !== 'user') return undefined
    const result = assess(parentId, parent.created, () => {
      const row = readPrevious.get(sessionId, parentId) as
        | {
            id: string
            role: string
            parent_id?: string
            summary?: number
          }
        | undefined
      const id =
        row?.role === 'assistant' ? row.parent_id : row?.role === 'user' ? row.id : undefined
      const prior = id ? resolve(sessionId, id, depth + 1) : undefined
      return prior && row?.summary ? { ...prior, continued: true } : prior
    })
    cache.set(key, result)
    return result
  }

  return Object.assign(
    (sessionId: string, parentId: unknown, messageId?: string): ConversationTurn | undefined =>
      native(sessionId, parentId, messageId) ??
      (typeof parentId === 'string' ? resolve(sessionId, parentId)?.turn : undefined),
    {
      observe(sessionId: string, id: string, data: Record<string, unknown>): void {
        if (!streamedUsers) return
        const previous = lastInSession.get(sessionId)
        if (data.role === 'user') {
          const created = (data.time as { created?: number } | undefined)?.created ?? 0
          const current = assess(id, created, () => previous)
          cache.set(keyOf(sessionId, id), current)
          lastInSession.set(sessionId, current)
        } else if (data.summary === true && previous) {
          lastInSession.set(sessionId, { ...previous, continued: true })
        }
      },
    },
  )
}
