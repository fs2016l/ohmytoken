import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { decodeUtf8, decompressZstd } from '../lib/zstd-json'

const MAX_EVENT_BYTES = 4 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
type Row = Record<string, unknown>

export interface OpenClawStoredEvent {
  sessionId: string
  sourceId: string
  event: unknown
  fallbackTimestamp: number
}

/** 只读同一快照中的逐消息事实；不计导航投影、会话累计值或检索索引。 */
export function* readOpenClawDatabase(file: string): Generator<OpenClawStoredEvent> {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('BEGIN')
    const columns = requireColumns(db, 'transcript_events', [
      'session_id',
      'seq',
      'event_json',
      'created_at',
    ])
    const compressed = columns.has('event_zstd')
    if (compressed && !columns.has('event_utf8_bytes'))
      throw new Error('transcript_events 缺少压缩长度')
    const selected = compressed ? ', event_zstd, event_utf8_bytes' : ''
    for (const row of db
      .prepare(
        `SELECT session_id, seq, event_json, created_at${selected} FROM transcript_events ORDER BY session_id, seq`,
      )
      .iterate() as Iterable<Row>) {
      const sessionId = requiredString(row.session_id)
      let json: string
      if (typeof row.event_json === 'string' && row.event_zstd == null) {
        json = boundedText(row.event_json, MAX_EVENT_BYTES)
      } else {
        if (
          row.event_json !== null ||
          !(row.event_zstd instanceof Uint8Array) ||
          !Number.isSafeInteger(row.event_utf8_bytes) ||
          Number(row.event_utf8_bytes) < 1 ||
          Number(row.event_utf8_bytes) > MAX_EVENT_BYTES ||
          row.event_zstd.byteLength > MAX_EVENT_BYTES
        )
          throw new Error(`无效压缩事件: ${sessionId}/${row.seq}`)
        const bytes = decompressZstd(row.event_zstd, Number(row.event_utf8_bytes))
        if (bytes.length !== row.event_utf8_bytes) throw new Error('事件解压长度与元数据不符')
        json = decodeUtf8(bytes)
      }
      yield {
        sessionId,
        sourceId: `live:${sessionId}`,
        event: JSON.parse(json),
        fallbackTimestamp: timestamp(row.created_at),
      }
    }
    yield* readWarmArchives(db)
    yield* readColdArchives(db, file)
  } finally {
    db.close()
  }
}

function* readWarmArchives(db: Database.Database): Generator<OpenClawStoredEvent> {
  if (!tableExists(db, 'session_transcript_archives')) return
  requireColumns(db, 'session_transcript_archives', [
    'session_id',
    'generation',
    'encoding',
    'archive_blob',
    'archive_sha256',
    'created_at',
  ])
  for (const row of db
    .prepare(
      'SELECT session_id, generation, encoding, archive_blob, archive_sha256, created_at FROM session_transcript_archives ORDER BY session_id, created_at, generation',
    )
    .iterate() as Iterable<Row>) {
    const sessionId = requiredString(row.session_id)
    const bytes = archiveBytes(row.archive_blob, row.archive_sha256)
    if (row.encoding !== 'identity' && row.encoding !== 'zstd')
      throw new Error('未知 OpenClaw 归档编码')
    const decoded = row.encoding === 'zstd' ? decompressZstd(bytes, MAX_ARCHIVE_BYTES) : bytes
    const sourceId = `archive:${sessionId}:${requiredString(row.generation)}`
    for (const event of jsonLines(decoded)) {
      yield { sessionId, sourceId, event, fallbackTimestamp: timestamp(row.created_at) }
    }
  }
}

function* readColdArchives(db: Database.Database, file: string): Generator<OpenClawStoredEvent> {
  if (!tableExists(db, 'session_transcript_cold_archives')) return
  requireColumns(db, 'session_transcript_cold_archives', [
    'session_id',
    'generation',
    'archive_name',
    'archive_sha256',
    'event_count',
    'raw_bytes',
    'archive_bytes',
    'last_seq',
    'storage',
    'archive_blob',
  ])
  for (const row of db
    .prepare('SELECT * FROM session_transcript_cold_archives ORDER BY session_id')
    .iterate() as Iterable<Row>) {
    const sessionId = requiredString(row.session_id)
    const generation = requiredString(row.generation)
    let blob = row.archive_blob
    if (row.storage === 'file') {
      const name = requiredString(row.archive_name)
      if (!/^[a-f0-9]{64}\.jsonl\.zst$/.test(name)) throw new Error('无效 OpenClaw 冷归档文件名')
      const storeDir = dirname(file)
      const sessions =
        basename(storeDir) === 'agent' ? join(dirname(storeDir), 'sessions') : storeDir
      const archive = join(sessions, 'cold', name)
      if (statSync(archive).size > MAX_ARCHIVE_BYTES) throw new Error('OpenClaw 冷归档过大')
      blob = readFileSync(archive)
    } else if (row.storage !== 'sqlite') throw new Error('未知 OpenClaw 冷归档存储')
    const bytes = archiveBytes(blob, row.archive_sha256)
    if (bytes.length !== row.archive_bytes) throw new Error('冷归档压缩长度不符')
    const records = jsonLines(decompressZstd(bytes, MAX_ARCHIVE_BYTES))
    const header = records.next().value
    if (
      !isObject(header) ||
      header.kind !== 'header' ||
      header.version !== 1 ||
      header.sessionId !== sessionId ||
      header.generation !== generation
    )
      throw new Error('冷归档头与会话不符')
    let count = 0
    let rawBytes = 0
    let lastSeq = -1
    for (const record of records) {
      if (
        !isObject(record) ||
        !['event', 'identity', 'active', 'index', 'fts'].includes(String(record.kind))
      )
        throw new Error('未知冷归档记录')
      if (record.kind !== 'event') continue
      const event = record.row
      if (
        !isObject(event) ||
        typeof event.event_json !== 'string' ||
        !Number.isSafeInteger(event.seq) ||
        Number(event.seq) <= lastSeq
      )
        throw new Error('无效冷归档事件')
      count++
      lastSeq = Number(event.seq)
      const json = boundedText(event.event_json, MAX_EVENT_BYTES)
      rawBytes += Buffer.byteLength(json)
      yield {
        sessionId,
        sourceId: `cold:${sessionId}:${generation}`,
        event: JSON.parse(json),
        fallbackTimestamp: timestamp(event.created_at),
      }
    }
    if (
      count !== row.event_count ||
      lastSeq !== row.last_seq ||
      rawBytes + count - 1 !== row.raw_bytes
    )
      throw new Error('冷归档事件数量或长度与元数据不符')
  }
}

function archiveBytes(value: unknown, expectedHash: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error('无效或过大的 OpenClaw 归档')
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash)
    throw new Error('OpenClaw 归档校验失败')
  return bytes
}

function* jsonLines(bytes: Uint8Array): Generator<unknown> {
  for (const line of decodeUtf8(bytes).split('\n')) {
    if (line.trim()) yield JSON.parse(line)
  }
}

function boundedText(value: string, limit: number): string {
  if (Buffer.byteLength(value) > limit) throw new Error('OpenClaw 事件过大')
  return value
}

function tableExists(db: Database.Database, name: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
}

function requireColumns(db: Database.Database, table: string, required: string[]): Set<string> {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((row) => String(row.name)),
  )
  if (required.some((name) => !columns.has(name)))
    throw new Error(`OpenClaw ${table} 表结构不受支持`)
  return columns
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('OpenClaw 存储缺少身份字段')
  return value
}

function timestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function isObject(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
