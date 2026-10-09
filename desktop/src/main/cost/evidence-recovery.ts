import type Database from 'better-sqlite3'

/** 证据解析规则变化时重读来源，已被原程序清理的历史仍留在本地。 */
export const USAGE_EVIDENCE_REVISION = 3

export function needsEvidenceRecovery(db: Database.Database, agent: string): boolean {
  const state = db
    .prepare('SELECT revision FROM usage_evidence_state WHERE agent = ?')
    .get(agent) as { revision: number } | undefined
  return state?.revision !== USAGE_EVIDENCE_REVISION
}

export function completeEvidenceRecovery(
  db: Database.Database,
  agent: string,
  recoveredAt: number,
): void {
  db.prepare(
    `INSERT INTO usage_evidence_state (agent, revision, recovered_at) VALUES (?, ?, ?)
    ON CONFLICT(agent) DO UPDATE SET revision = excluded.revision,
      recovered_at = excluded.recovered_at`,
  ).run(agent, USAGE_EVIDENCE_REVISION, recoveredAt)
}
