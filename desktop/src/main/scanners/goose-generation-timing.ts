import type Database from 'better-sqlite3'
import type { GenerationTiming } from '../../shared/models'

type TimingReader = (sessionId: string, model: string) => GenerationTiming | undefined
type JsonObject = Record<string, unknown>

/** Goose attaches native ProviderStats to the completed assistant message, then persists it. */
export function gooseGenerationTimingReader(db: Database.Database): TimingReader {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
  if (
    !['message_id', 'session_id', 'role', 'metadata_json', 'timestamp'].every((key) =>
      columns.has(key),
    )
  )
    return () => undefined

  const statement = db.prepare(`SELECT message_id, metadata_json, timestamp FROM messages
    WHERE session_id = ? AND role = 'assistant' AND metadata_json IS NOT NULL
    ORDER BY timestamp DESC, ${columns.has('id') ? 'id' : 'rowid'} DESC`)
  return (sessionId, model) => {
    for (const row of statement.iterate(sessionId) as Iterable<JsonObject>) {
      const timing = gooseMessageGenerationTiming(row, model)
      if (timing) return timing
    }
    return undefined
  }
}

function gooseMessageGenerationTiming(
  row: JsonObject,
  model: string,
): GenerationTiming | undefined {
  if (typeof row.message_id !== 'string' || !row.message_id.trim()) return undefined
  const completedAtMs = persistedMessageTime(row.timestamp)
  if (!completedAtMs || typeof row.metadata_json !== 'string') return undefined
  let metadata: unknown
  try {
    metadata = JSON.parse(row.metadata_json)
  } catch {
    return undefined
  }
  if (!isObject(metadata) || !isObject(metadata.usage)) return undefined
  // The aggregate row uses the current session model. A previous model's response cannot label it.
  if (!isObject(metadata.inference)) return undefined
  const sourceModels = [metadata.inference.requestedModel, metadata.inference.resolvedModel]
  if (!sourceModels.some((value) => typeof value === 'string' && value.trim() === model))
    return undefined

  const usage = metadata.usage
  const generatedTokens = usage.outputTokens
  const ttft = usage.timeToFirstTokenMs
  const elapsed = usage.elapsedMs
  if (!Number.isSafeInteger(generatedTokens) || Number(generatedTokens) <= 0) return undefined
  if (!Number.isSafeInteger(ttft) || Number(ttft) < 0) return undefined
  if (!Number.isSafeInteger(elapsed) || Number(elapsed) <= Number(ttft)) return undefined

  const streamDurationMs = Number(elapsed) - Number(ttft)
  return {
    apiCallId: `goose-message:${row.message_id.trim()}`,
    // 会话压缩/导入会重插旧消息；这只是原生响应落库排序时间，不是精确完成时间。
    completedAtMs,
    timeSource: 'recorded',
    // Goose's native stats can start at model prefill (MLX), after request preparation/load.
    // Their internal TTFT is useful for decode duration, but cannot label client request TTFT.
    streamDurationMs,
    generatedTokens: Number(generatedTokens),
  }
}

function persistedMessageTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined
  const timestamp = value.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(timestamp))
    return undefined
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp)
  const milliseconds = Date.parse(withZone ? timestamp : `${timestamp}Z`)
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? milliseconds : undefined
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
