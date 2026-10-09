import type Database from 'better-sqlite3'
import type { LatestTurnFirstToken } from '../../shared/models'
import { latestTurnFirstToken, normalizeLatestTurnFirstToken } from '../../shared/turn-timing'

interface TurnFirstTokenRow {
  session_id: string
  turn_id: string
  completed_at_ms: number
  time_to_first_token_ms: number
}

function sampleFromRow(row?: TurnFirstTokenRow): LatestTurnFirstToken | undefined {
  return row
    ? normalizeLatestTurnFirstToken({
        sessionId: row.session_id,
        turnId: row.turn_id,
        completedAtMs: row.completed_at_ms,
        timeToFirstTokenMs: row.time_to_first_token_ms,
      })
    : undefined
}

export function ensureSessionTurnTimingSchema(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS usage_session_turn_timing (
    agent TEXT NOT NULL,
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    completed_at_ms INTEGER NOT NULL,
    time_to_first_token_ms INTEGER NOT NULL,
    PRIMARY KEY (agent, session_id)
  )`)
}

/** 每个实际会话一行；没有新有效轮级记录时保留原值，重复样本不写入。 */
export function storeLatestTurnFirstTokens(
  db: Database.Database,
  agent: string,
  samples: readonly LatestTurnFirstToken[] = [],
): number {
  const latest = new Map<string, LatestTurnFirstToken>()
  for (const value of samples) {
    const sample = normalizeLatestTurnFirstToken(value)
    if (sample)
      latest.set(sample.sessionId, latestTurnFirstToken(latest.get(sample.sessionId), sample)!)
  }
  if (!latest.size) return 0
  const read = db.prepare(
    'SELECT * FROM usage_session_turn_timing WHERE agent = ? AND session_id = ?',
  )
  const write = db.prepare(`INSERT INTO usage_session_turn_timing
    (agent, session_id, turn_id, completed_at_ms, time_to_first_token_ms)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT (agent, session_id) DO UPDATE SET
    turn_id = excluded.turn_id, completed_at_ms = excluded.completed_at_ms,
    time_to_first_token_ms = excluded.time_to_first_token_ms`)
  return db.transaction(() => {
    let changed = 0
    for (const sample of latest.values()) {
      const previous = sampleFromRow(
        read.get(agent, sample.sessionId) as TurnFirstTokenRow | undefined,
      )
      const next = latestTurnFirstToken(previous, sample)!
      if (JSON.stringify(previous) === JSON.stringify(next)) continue
      write.run(agent, next.sessionId, next.turnId, next.completedAtMs, next.timeToFirstTokenMs)
      changed++
    }
    return changed
  })()
}

/** 全量刷新合并最近轮级样本，保留刷新期间主库更新的更晚记录。 */
export function mergeStagedTurnFirstTokens(
  db: Database.Database,
  agents: string[],
  schema: string,
): void {
  if (!db.inTransaction || !/^scan_staging(?:_\d+)?$/.test(schema))
    throw new Error('轮级计时归并必须在扫描替换事务中执行')
  if (
    !db
      .prepare(
        `SELECT 1 FROM ${schema}.sqlite_master
      WHERE type = 'table' AND name = 'usage_session_turn_timing'`,
      )
      .get()
  )
    return
  const read = db.prepare(`SELECT * FROM ${schema}.usage_session_turn_timing WHERE agent = ?`)
  for (const agent of agents) {
    const samples: LatestTurnFirstToken[] = []
    for (const row of read.iterate(agent) as Iterable<TurnFirstTokenRow>) {
      const sample = sampleFromRow(row)
      if (sample) samples.push(sample)
    }
    storeLatestTurnFirstTokens(db, agent, samples)
  }
}
