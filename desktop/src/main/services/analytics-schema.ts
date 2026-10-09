import type Database from 'better-sqlite3'
const initialized = new WeakSet<Database.Database>()

/** Disposable aggregates. Source metering and historic price evidence remain authoritative. */
export function ensureAnalyticsSchema(db: Database.Database): void {
  if (initialized.has(db)) return
  db.exec(`CREATE TABLE IF NOT EXISTS usage_analytics_cache (
    agent TEXT NOT NULL, session_id TEXT NOT NULL, date TEXT NOT NULL, model TEXT NOT NULL,
    revision TEXT NOT NULL, data BLOB NOT NULL,
    PRIMARY KEY (agent, session_id, date, model)
  )`)
  for (const table of ['usage_sessions', 'usage_session_data', 'usage_api_calls']) {
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
      const refs =
        operation === 'UPDATE' ? ['OLD', 'NEW'] : [operation === 'INSERT' ? 'NEW' : 'OLD']
      db.exec(`CREATE TRIGGER IF NOT EXISTS analytics_${table}_${operation.toLowerCase()}
        AFTER ${operation} ON ${table} BEGIN
        ${refs.map((ref) => `DELETE FROM usage_analytics_cache WHERE agent = ${ref}.agent AND session_id = ${ref}.session_id AND date = ${ref}.date AND model = ${ref}.model;`).join('\n')}
        END`)
    }
  }
  initialized.add(db)
}
