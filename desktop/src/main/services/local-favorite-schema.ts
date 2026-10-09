import type Database from 'better-sqlite3'

const ready = new WeakSet<Database.Database>()
export function ensureLocalFavoriteSchema(db: Database.Database): void {
  if (ready.has(db)) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_favorites (
      entity_type TEXT NOT NULL CHECK(entity_type IN ('session', 'project')),
      entity_id TEXT NOT NULL,
      agent TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      snapshot_json TEXT,
      PRIMARY KEY(entity_type, agent, entity_id)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_local_favorites_order ON local_favorites(entity_type, position);
    CREATE TABLE IF NOT EXISTS local_favorite_migrations (
      source TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `)
  ready.add(db)
}
