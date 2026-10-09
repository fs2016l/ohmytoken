import type Database from 'better-sqlite3'
import { ensureSessionUsageSchema } from '../services/session-usage-schema'

function columns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  )
}

export function costSchemaReady(db: Database.Database): boolean {
  const triggers = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('usage_cost_api_insert', 'usage_cost_api_update', 'usage_cost_api_delete', 'usage_cost_cache_insert', 'usage_cost_cache_update', 'usage_cost_cache_delete')",
    )
    .all() as Array<{ sql: string }>
  return (
    columns(db, 'usage_api_calls').has('usage_evidence') &&
    ['usage_cost_cache', 'usage_evidence_state'].every((name) => columns(db, name).size > 0) &&
    ['usage_sessions', 'usage_records'].every((name) => {
      const names = columns(db, name)
      return names.has('cost_revision') && names.has('cost_summary')
    }) &&
    triggers.length === 6 &&
    triggers.every((trigger) =>
      trigger.sql.includes('cost_revision IS NOT NULL OR cost_summary IS NOT NULL'),
    )
  )
}

export function migrateCostSchema(db: Database.Database): void {
  db.transaction(() => {
    for (const table of ['api', 'cache']) {
      for (const event of ['insert', 'update', 'delete'])
        db.exec(`DROP TRIGGER IF EXISTS usage_cost_${table}_${event}`)
    }
    if (!columns(db, 'usage_api_calls').has('usage_evidence'))
      db.exec('ALTER TABLE usage_api_calls ADD COLUMN usage_evidence TEXT')
    db.exec(`CREATE TABLE IF NOT EXISTS usage_cost_cache (
      agent TEXT NOT NULL, api_call_id TEXT NOT NULL, revision TEXT NOT NULL,
      group_json TEXT NOT NULL, min_cost REAL, max_cost REAL,
      PRIMARY KEY (agent, api_call_id),
      FOREIGN KEY (agent, api_call_id) REFERENCES usage_api_calls(agent, api_call_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS usage_evidence_state (
      agent TEXT PRIMARY KEY, revision INTEGER NOT NULL, recovered_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_cost_rollup ON usage_api_calls(agent, date, model, session_id);`)
    for (const table of ['usage_sessions', 'usage_records']) {
      const names = columns(db, table)
      for (const column of ['cost_revision', 'cost_summary']) {
        if (!names.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`)
      }
    }
    for (const event of ['INSERT', 'UPDATE', 'DELETE'] as const) {
      const references = event === 'UPDATE' ? ['OLD', 'NEW'] : [event === 'DELETE' ? 'OLD' : 'NEW']
      db.exec(`CREATE TRIGGER IF NOT EXISTS usage_cost_api_${event.toLowerCase()}
        AFTER ${event} ON usage_api_calls BEGIN
          ${references
            .map(
              (
                ref,
              ) => `DELETE FROM usage_cost_cache WHERE agent = ${ref}.agent AND api_call_id = ${ref}.api_call_id;
            ${invalidateRollups(ref)}`,
            )
            .join('\n')}
        END;`)
      const ref = event === 'DELETE' ? 'OLD' : 'NEW'
      db.exec(`CREATE TRIGGER IF NOT EXISTS usage_cost_cache_${event.toLowerCase()}
        AFTER ${event} ON usage_cost_cache BEGIN
          UPDATE usage_sessions SET cost_revision = NULL, cost_summary = NULL
          WHERE (cost_revision IS NOT NULL OR cost_summary IS NOT NULL) AND (agent, session_id, date, model) IN (
            SELECT agent, session_id, date, model FROM usage_api_calls
            WHERE agent = ${ref}.agent AND api_call_id = ${ref}.api_call_id
          );
          UPDATE usage_records SET cost_revision = NULL, cost_summary = NULL
          WHERE (cost_revision IS NOT NULL OR cost_summary IS NOT NULL) AND (agent, date, model) IN (
            SELECT agent, date, model FROM usage_api_calls
            WHERE agent = ${ref}.agent AND api_call_id = ${ref}.api_call_id
          );
        END;`)
    }
    ensureSessionUsageSchema(db)
  })()
}

function invalidateRollups(ref: string): string {
  return `UPDATE usage_sessions SET cost_revision = NULL, cost_summary = NULL
    WHERE agent = ${ref}.agent AND session_id = ${ref}.session_id AND date = ${ref}.date AND model = ${ref}.model
      AND (cost_revision IS NOT NULL OR cost_summary IS NOT NULL);
    UPDATE usage_records SET cost_revision = NULL, cost_summary = NULL
    WHERE agent = ${ref}.agent AND date = ${ref}.date AND model = ${ref}.model
      AND (cost_revision IS NOT NULL OR cost_summary IS NOT NULL);`
}
