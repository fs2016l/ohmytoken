import type Database from 'better-sqlite3'
import type { AccountFavorite, AccountFavoriteTarget } from '../../shared/account-favorites'
import { parseAccountFavorite, validateAccountFavoriteTarget } from '../../shared/account-favorites'

export function createAccountFavoriteCache(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_favorite_cache(
      account_id INTEGER NOT NULL, target_type TEXT NOT NULL, target_id INTEGER NOT NULL,
      saved_at TEXT NOT NULL, available INTEGER NOT NULL,
      PRIMARY KEY(account_id,target_type,target_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS discovery_favorite_sync(
      account_id INTEGER PRIMARY KEY, synced_at INTEGER NOT NULL
    );
  `)
  const upsert =
    db.prepare(`INSERT INTO discovery_favorite_cache(account_id,target_type,target_id,saved_at,available)
    VALUES(?,?,?,?,?) ON CONFLICT(account_id,target_type,target_id) DO UPDATE SET saved_at=excluded.saved_at,available=excluded.available`)
  function account(id: number): void {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid account')
  }
  function read(id: number) {
    account(id)
    const rows = db
      .prepare(
        `SELECT target_type AS targetType,target_id AS targetId,saved_at AS savedAt,available
      FROM discovery_favorite_cache WHERE account_id=? ORDER BY saved_at DESC,target_id DESC`,
      )
      .all(id) as Array<Omit<AccountFavorite, 'available'> & { available: number }>
    const sync = db
      .prepare('SELECT synced_at FROM discovery_favorite_sync WHERE account_id=?')
      .get(id) as { synced_at: number } | undefined
    return {
      items: rows.map((row) => ({ ...row, available: row.available === 1 })),
      syncedAt: sync?.synced_at ?? null,
    }
  }
  function replace(id: number, values: AccountFavorite[], time: number): void {
    account(id)
    if (values.length > 10000 || !Number.isSafeInteger(time) || time <= 0)
      throw new Error('Invalid favorite snapshot')
    const items = values.map(parseAccountFavorite)
    db.transaction(() => {
      db.prepare('DELETE FROM discovery_favorite_cache WHERE account_id=?').run(id)
      for (const item of items)
        upsert.run(id, item.targetType, item.targetId, item.savedAt, item.available ? 1 : 0)
      db.prepare(
        'INSERT INTO discovery_favorite_sync VALUES(?,?) ON CONFLICT(account_id) DO UPDATE SET synced_at=excluded.synced_at',
      ).run(id, time)
    })()
  }
  function put(id: number, value: AccountFavorite): void {
    account(id)
    const item = parseAccountFavorite(value)
    upsert.run(id, item.targetType, item.targetId, item.savedAt, item.available ? 1 : 0)
  }
  function remove(id: number, value: AccountFavoriteTarget): void {
    account(id)
    const item = validateAccountFavoriteTarget(value)
    db.prepare(
      'DELETE FROM discovery_favorite_cache WHERE account_id=? AND target_type=? AND target_id=?',
    ).run(id, item.targetType, item.targetId)
  }
  return { read, replace, put, remove }
}
