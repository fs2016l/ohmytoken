import { readFileSync, realpathSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve, sep } from 'path'
import type Database from 'better-sqlite3'
import { readUtf8Lines } from '../lib/line-reader'

type ObjectValue = Record<string, unknown>

function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' && value.length <= 2048 && !/\p{Cc}/u.test(value)
    ? value.trim()
    : ''
}

/** Both lexical and real paths must stay inside this runtime's history directory. */
function childPath(root: string, relative: unknown): string | undefined {
  const name = text(relative)
  if (!name || isAbsolute(name)) return undefined
  const path = resolve(root, name)
  if (!path.startsWith(resolve(root) + sep)) return undefined
  try {
    const real = realpathSync(path)
    return real.startsWith(realpathSync(root) + sep) ? real : undefined
  } catch {
    return undefined
  }
}

function readMetadata(path: string | undefined): ObjectValue | undefined {
  if (!path) return undefined
  try {
    if (statSync(path).size > 2 * 1024 * 1024) return undefined
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return object(value) ? value : undefined
  } catch {
    return undefined
  }
}

function signature(turn: unknown, timestamp: unknown, buckets: unknown[]): string | undefined {
  if (
    !text(turn) ||
    !Number.isSafeInteger(timestamp) ||
    Number(timestamp) <= 0 ||
    buckets.some((value) => !Number.isSafeInteger(value) || Number(value) < 0)
  )
    return undefined
  return JSON.stringify([text(turn), timestamp, ...buckets])
}

function modelId(message: ObjectValue): string {
  const model = text(message.model)
  const provider = text(message.provider)
  if (!model || model.length > 256) return ''
  if (model.includes('/') || !provider) return model
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(provider)) return ''
  const qualified = `${provider}/${model}`
  return qualified.length <= 256 ? qualified : ''
}

/**
 * The usage table can omit model while native assistant history retains it.
 * Join only the same session, turn, request timestamp and complete Token buckets.
 * Context telemetry, session's final model and llm-call.json are not call evidence.
 */
export function miniMaxModelHistoryReader(
  db: Database.Database,
  dbPath: string,
): (row: ObjectValue) => string | undefined {
  const columns = new Set(
    (db.prepare('PRAGMA table_info(local_runtime_sessions)').all() as { name: string }[]).map(
      (column) => column.name,
    ),
  )
  if (!columns.has('session_id') || !columns.has('history_relative_dir')) return () => undefined
  const session = db.prepare(
    'SELECT history_relative_dir FROM local_runtime_sessions WHERE session_id = ?',
  )
  const root = resolve(dirname(dbPath), '..', 'sessions')
  const cache = new Map<string, Map<string, string | null>>()

  function history(sessionId: string): Map<string, string | null> {
    const existing = cache.get(sessionId)
    if (existing) return existing
    const models = new Map<string, string | null>()
    cache.set(sessionId, models)
    const row = session.get(sessionId) as { history_relative_dir: unknown } | undefined
    const directory = childPath(root, row?.history_relative_dir)
    if (!directory) return models
    const manifest = readMetadata(childPath(directory, 'manifest.json'))
    if (manifest?.schemaVersion !== 1 || manifest.sessionId !== sessionId) return models
    const files = new Set([childPath(directory, 'messages.jsonl')])
    const catalog = readMetadata(childPath(directory, 'history-catalog.json'))
    if (
      catalog?.schemaVersion === 1 &&
      catalog.sessionId === sessionId &&
      Array.isArray(catalog.artifacts)
    ) {
      for (const artifact of catalog.artifacts) {
        if (
          object(artifact) &&
          artifact.kind === 'snapshot' &&
          typeof artifact.fileName === 'string' &&
          /^[a-z0-9][a-z0-9._-]{0,220}\.jsonl$/i.test(artifact.fileName)
        )
          files.add(childPath(directory, join('snapshots', artifact.fileName)))
      }
    }
    for (const file of files) {
      if (!file) continue
      try {
        for (const { line, truncated, terminated } of readUtf8Lines(
          file,
          256 * 1024,
          0,
          16 * 1024 * 1024,
        )) {
          if (truncated || !terminated || !line.includes('"model"') || !line.includes('"usage"'))
            continue
          let entry: unknown
          try {
            entry = JSON.parse(line)
          } catch {
            continue
          }
          if (!object(entry) || !object(entry.message)) continue
          const message = entry.message
          if (message.role !== 'assistant' || !object(message.usage)) continue
          const usage = message.usage
          const buckets = [
            usage.input,
            usage.output,
            usage.cacheRead ?? 0,
            usage.cacheWrite ?? 0,
            0,
          ]
          const key = signature(entry.turn_id, message.timestamp, buckets)
          const model = modelId(message)
          if (
            !key ||
            !model ||
            usage.totalTokens !== buckets.reduce<number>((sum, n) => sum + Number(n), 0)
          )
            continue
          // Compaction snapshots repeat messages. Conflicting models remain unknown.
          models.set(key, models.has(key) && models.get(key) !== model ? null : model)
        }
      } catch {
        // A missing/rotating history file must not discard the native Token rows.
      }
    }
    return models
  }

  return (row) => {
    const sessionId = text(row.session_id)
    const key = signature(row.turn_id, row.ts, [
      row.input_tokens,
      row.output_tokens,
      row.cache_read_tokens ?? 0,
      row.cache_write_tokens ?? 0,
      row.reasoning_tokens ?? 0,
    ])
    return sessionId && key ? (history(sessionId).get(key) ?? undefined) : undefined
  }
}
