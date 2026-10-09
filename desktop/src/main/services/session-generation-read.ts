import type Database from 'better-sqlite3'
import type {
  LatestGeneration,
  LatestTurnFirstToken,
  TokenUsageSession,
  TokenUsageUserSession,
} from '../../shared/models'
import { latestGeneration } from '../../shared/generation-timing'
import { latestTurnFirstToken, normalizeLatestTurnFirstToken } from '../../shared/turn-timing'
import { sessionGenerationFromRow, type SessionGenerationRow } from './session-generation-storage'

interface GenerationRow extends SessionGenerationRow {
  root_session_id: string
  metric_agent: string
  metric_session_id: string
  turn_id: string | null
  turn_completed_at_ms: number | null
  turn_time_to_first_token_ms: number | null
}

const READ_BATCH_SIZE = 200
const identity = (agent: string, sessionId: string): string => JSON.stringify([agent, sessionId])

/** Current API metrics belong to the session, independently of usage date/model/project filters. */
export function attachSessionGeneration(
  db: Database.Database,
  sessions: TokenUsageSession[],
  includeFamily = false,
): void {
  if (!sessions.length) return
  const keys = [
    ...new Map(
      sessions.map((session) => [identity(session.agent, session.sessionId), session]),
    ).values(),
  ]
  const direct = new Map<string, LatestGeneration>()
  const roots = new Map<string, LatestGeneration>()
  const directTurns = new Map<string, LatestTurnFirstToken>()
  const rootTurns = new Map<string, LatestTurnFirstToken>()
  for (let offset = 0; offset < keys.length; offset += READ_BATCH_SIZE) {
    const batch = keys.slice(offset, offset + READ_BATCH_SIZE)
    const rows = db
      .prepare(
        `
      WITH selected(agent, session_id) AS (VALUES ${batch.map(() => '(?, ?)').join(',')}),
      identities AS (
        SELECT agent, session_id AS root_session_id, session_id FROM selected
        ${
          includeFamily
            ? `UNION
        SELECT s.agent, k.session_id AS root_session_id, s.session_id
          FROM selected k JOIN main.usage_sessions s
          ON s.agent = k.agent AND s.root_session_id = k.session_id`
            : ''
        }
      )
      SELECT i.root_session_id, i.agent AS metric_agent, i.session_id AS metric_session_id,
        g.*, t.turn_id, t.completed_at_ms AS turn_completed_at_ms,
        t.time_to_first_token_ms AS turn_time_to_first_token_ms FROM identities i
        LEFT JOIN main.usage_session_generation g USING (agent, session_id)
        LEFT JOIN main.usage_session_turn_timing t USING (agent, session_id)
        WHERE g.session_id IS NOT NULL OR t.session_id IS NOT NULL
    `,
      )
      .all(...batch.flatMap((session) => [session.agent, session.sessionId])) as GenerationRow[]
    for (const row of rows) {
      const sample = sessionGenerationFromRow(row)
      const key = identity(row.metric_agent, row.metric_session_id)
      const root = identity(row.metric_agent, row.root_session_id)
      if (sample) {
        direct.set(key, sample)
        roots.set(root, latestGeneration(roots.get(root), sample)!)
      }
      const turnSample = normalizeLatestTurnFirstToken({
        sessionId: row.metric_session_id,
        turnId: row.turn_id,
        completedAtMs: row.turn_completed_at_ms,
        timeToFirstTokenMs: row.turn_time_to_first_token_ms,
      })
      if (turnSample) {
        directTurns.set(key, turnSample)
        rootTurns.set(root, latestTurnFirstToken(rootTurns.get(root), turnSample)!)
      }
    }
  }
  for (const session of sessions) {
    const key = identity(session.agent, session.sessionId)
    session.latestGeneration = includeFamily ? roots.get(key) : direct.get(key)
    session.latestTurnFirstToken = includeFamily ? rootTurns.get(key) : directTurns.get(key)
    if (includeFamily)
      for (const child of (session as TokenUsageUserSession).children ?? []) {
        child.latestGeneration = direct.get(identity(child.agent, child.sessionId))
        child.latestTurnFirstToken = directTurns.get(identity(child.agent, child.sessionId))
      }
  }
}
