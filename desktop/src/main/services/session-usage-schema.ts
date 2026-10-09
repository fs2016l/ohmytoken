import type Database from 'better-sqlite3'

export function ensureSessionUsageSchema(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(usage_sessions)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'api_count_complete'))
    db.exec('ALTER TABLE usage_sessions ADD COLUMN api_count_complete INTEGER NOT NULL DEFAULT 1')
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_session_data (
      agent TEXT NOT NULL, session_id TEXT NOT NULL, date TEXT NOT NULL, model TEXT NOT NULL,
      first_ms INTEGER NOT NULL, last_ms INTEGER NOT NULL,
      meter_data BLOB NOT NULL, second_data BLOB NOT NULL,
      PRIMARY KEY (agent, session_id, date, model)
    );
    CREATE INDEX IF NOT EXISTS idx_session_data_time ON usage_session_data(last_ms, first_ms);
    CREATE INDEX IF NOT EXISTS idx_session_data_date ON usage_session_data(date);
    CREATE TABLE IF NOT EXISTS usage_session_projects (
      agent TEXT NOT NULL, session_id TEXT NOT NULL, date TEXT NOT NULL, model TEXT NOT NULL,
      project_path TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER NOT NULL, cache_write_tokens INTEGER NOT NULL,
      reasoning_tokens INTEGER NOT NULL, total_tokens INTEGER NOT NULL,
      PRIMARY KEY (agent, session_id, date, model, project_path)
    );
    CREATE VIEW IF NOT EXISTS usage_project_totals AS
      SELECT agent, date, model, project_path, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens FROM usage_api_calls
      UNION ALL SELECT agent, date, model, project_path, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens FROM usage_session_projects;
    CREATE VIEW IF NOT EXISTS usage_token_totals AS
      SELECT agent, date, model, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens FROM usage_api_calls
      UNION ALL
      SELECT agent, date, model, input_tokens, output_tokens, cache_read_tokens,
        cache_write_tokens, reasoning_tokens, total_tokens FROM usage_records r
      WHERE EXISTS (SELECT 1 FROM usage_session_data d WHERE d.agent = r.agent);
  `)
  const dataColumns = db.prepare('PRAGMA table_info(usage_session_data)').all() as Array<{
    name: string
  }>
  if (!dataColumns.some((column) => column.name === 'turn_data'))
    db.exec('ALTER TABLE usage_session_data ADD COLUMN turn_data BLOB')
  const projectColumns = new Set(
    (db.prepare('PRAGMA table_info(usage_session_projects)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
  for (const [column, type] of Object.entries({
    api_call_count: 'INTEGER',
    api_count_complete: 'INTEGER',
    cost_revision: 'TEXT',
    cost_summary: 'TEXT',
    first_ms: 'INTEGER',
    last_ms: 'INTEGER',
    turn_data: 'BLOB',
  })) {
    if (!projectColumns.has(column))
      db.exec(`ALTER TABLE usage_session_projects ADD COLUMN ${column} ${type}`)
  }
}
