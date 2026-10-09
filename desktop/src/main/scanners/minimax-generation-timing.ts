import type Database from 'better-sqlite3'
import type { LatestGeneration } from '../../shared/models'

type UsageRow = Record<string, unknown>

/** 原生助手消息自带单次 usage；不把相同 Token 桶的另一条请求当成其身份。 */
export function readMiniMaxLatestGenerations(
  db: Database.Database,
  sessionIds: readonly string[],
  fallbackModel: string,
): ReadonlyMap<string, LatestGeneration> {
  const result = new Map<string, LatestGeneration>()
  if (!sessionIds.length) return result
  const columns = new Set(
    (db.prepare('PRAGMA table_info(local_runtime_message_rows)').all() as { name: string }[]).map(
      (column) => column.name,
    ),
  )
  if (!['session_id', 'role', 'data_json'].every((column) => columns.has(column))) return result
  const select = [
    'data_json',
    columns.has('msg_id') ? 'msg_id' : 'NULL AS msg_id',
    columns.has('turn_id') ? 'turn_id' : 'NULL AS turn_id',
    columns.has('created_at_ms') ? 'created_at_ms' : 'NULL AS created_at_ms',
  ].join(', ')
  const id = columns.has('id') ? 'id' : 'rowid'
  // 原地更新可能晚补 usage 而不改变 id。按该会话的落库时间读取，不能只看最大 id。
  // session_id 索引限制读取范围；工具结束后才落库的消息无法恢复 API 的真实完成顺序。
  const query = db.prepare(`SELECT ${select} FROM local_runtime_message_rows
    WHERE session_id = ? AND role = 'assistant' AND data_json IS NOT NULL
      AND instr(data_json, '"decode_duration_ms"') > 0
    ORDER BY ${columns.has('created_at_ms') ? 'created_at_ms DESC, ' : ''}${id} DESC`)
  const identityUnique = columns.has('msg_id') && hasUniqueMessageIdentity(db)
  const duplicates = identityUnique
    ? undefined
    : db.prepare(`SELECT ${select} FROM local_runtime_message_rows
        WHERE session_id = ? AND role = 'assistant' AND
          ${columns.has('msg_id') ? 'msg_id = ?' : "json_valid(data_json) AND json_extract(data_json, '$.msg_id') = ?"}`)
  // AgentMessage 协议没有逐 API model；不能把 context_usage_telemetry 的模型当作此调用模型。
  const model =
    fallbackModel.trim() && fallbackModel.length <= 1024 ? fallbackModel.trim() : 'unknown'
  for (const sessionId of new Set(sessionIds)) {
    if (!sessionId || sessionId.length > 2048) continue
    for (const row of query.iterate(sessionId) as Iterable<UsageRow>) {
      const sample = latestMessageSample(row, sessionId, model)
      if (!sample) continue
      if (duplicates) {
        const messageId = sample.apiCallId.slice(`minimax-message:${sessionId}:`.length)
        let conflict = false
        for (const duplicate of duplicates.iterate(sessionId, messageId) as Iterable<UsageRow>) {
          const other = latestMessageSample(duplicate, sessionId, model)
          if (!other || JSON.stringify(other) !== JSON.stringify(sample)) {
            conflict = true
            break
          }
        }
        if (conflict) continue
      }
      result.set(sessionId, sample)
      // 每次只解码找到首个有效样本所需的助手消息，不解析其它会话或全部历史 JSON。
      break
    }
  }
  return result
}

function hasUniqueMessageIdentity(db: Database.Database): boolean {
  const indexes = db.prepare('PRAGMA index_list(local_runtime_message_rows)').all() as {
    name: string
    unique: number
    partial: number
  }[]
  const readColumns = db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno')
  return indexes.some((index) => {
    if (!index.unique || index.partial) return false
    const columns = (readColumns.all(index.name) as { name: string }[]).map((row) => row.name)
    return columns.length === 2 && columns.includes('session_id') && columns.includes('msg_id')
  })
}

function latestMessageSample(
  row: UsageRow,
  sessionId: string,
  model: string,
): LatestGeneration | undefined {
  if (typeof row.data_json !== 'string') return undefined
  let message: unknown
  try {
    message = JSON.parse(row.data_json)
  } catch {
    return undefined
  }
  if (
    !isObject(message) ||
    message.role !== 'assistant' ||
    typeof message.msg_id !== 'string' ||
    !message.msg_id.trim() ||
    (row.msg_id !== null && row.msg_id !== undefined && row.msg_id !== message.msg_id) ||
    (typeof row.turn_id === 'string' &&
      typeof message.turn_id === 'string' &&
      row.turn_id !== message.turn_id) ||
    !['stop', 'toolUse', 'tool_calls', 'length'].includes(String(message.finish_reason)) ||
    !isObject(message.usage)
  )
    return undefined
  const usage = message.usage
  const request = finiteNumber(usage.request_duration_ms)
  const decode = finiteNumber(usage.decode_duration_ms)
  const generatedTokens = tokenNumber(usage.output_tokens)
  const completedAtMs = tokenNumber(message.timestamp ?? row.created_at_ms)
  if (
    request === undefined ||
    // 原生 bridge 仅持久化 >0 的请求耗时；0 会被省略，不能把缺失计时补成首字 0。
    request <= 0 ||
    decode === undefined ||
    decode > request ||
    generatedTokens === undefined ||
    completedAtMs === undefined ||
    completedAtMs <= 0
  )
    return undefined
  // 只需要输出量和原生计时，但已提供的 Token 字段仍不能是负数或无效数值。
  for (const key of ['input_tokens', 'cache_read', 'cache_write', 'total_tokens']) {
    if (usage[key] !== undefined && tokenNumber(usage[key]) === undefined) return undefined
  }
  if (usage.total_tokens !== undefined && Number(usage.total_tokens) < generatedTokens)
    return undefined
  const apiCallId = `minimax-message:${sessionId}:${message.msg_id}`
  if (apiCallId.length > 2048) return undefined
  const speed = decode > 0 && generatedTokens > 0 ? (generatedTokens * 1000) / decode : undefined
  return {
    apiCallId,
    sessionId,
    model,
    // timestamp 是完整消息发布/落库的时间；toolUse 会等工具结果后发布，非精确模型完成时间。
    completedAtMs,
    timeSource: 'recorded',
    timeToFirstTokenMs: request - decode,
    generatedTokens,
    ...(decode > 0 ? { streamDurationMs: decode } : {}),
    ...(speed !== undefined && Number.isFinite(speed) ? { tokensPerSecond: speed } : {}),
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function tokenNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
