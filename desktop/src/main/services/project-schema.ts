import type Database from 'better-sqlite3'

export function ensureProjectSchema(db: Database.Database): void {
  const columns = db.prepare('PRAGMA table_info(tracked_projects)').all() as Array<{ name: string }>
  if (!columns.some((column) => column.name === 'source'))
    db.exec("ALTER TABLE tracked_projects ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'")
  if (!columns.some((column) => column.name === 'ignored'))
    db.exec('ALTER TABLE tracked_projects ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0')
  if (!columns.some((column) => column.name === 'notes'))
    db.exec("ALTER TABLE tracked_projects ADD COLUMN notes TEXT NOT NULL DEFAULT ''")
  db.exec(`CREATE TABLE IF NOT EXISTS project_directories (
    project_id TEXT NOT NULL REFERENCES tracked_projects(id) ON DELETE CASCADE,
    normalized_path TEXT NOT NULL,
    PRIMARY KEY (project_id, normalized_path)
  )`)
}
