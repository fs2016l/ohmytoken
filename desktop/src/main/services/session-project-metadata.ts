import type Database from 'better-sqlite3'
import { aggregateSessionUsage, decodeMeterData, type SessionDataRow } from './session-usage-codec'
import { writeSessionProjectUsage } from './session-usage-storage'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'

const pending = new WeakMap<Database.Database, Promise<void>>()

/** Backfill only derived project metadata in bounded transactions; raw usage is unchanged. */
export function refreshProjectUsageMetadata(db: Database.Database): Promise<void> {
  const previous = pending.get(db)
  if (previous) return previous
  const request = rebuild(db).finally(() => pending.delete(db))
  pending.set(db, request)
  return request
}

async function rebuild(db: Database.Database): Promise<void> {
  const read = db.prepare(`SELECT d.* FROM usage_session_data d WHERE
    NOT EXISTS (SELECT 1 FROM usage_session_projects p
      WHERE p.agent = d.agent AND p.session_id = d.session_id AND p.date = d.date AND p.model = d.model)
    OR EXISTS (SELECT 1 FROM usage_session_projects p
      WHERE p.agent = d.agent AND p.session_id = d.session_id AND p.date = d.date AND p.model = d.model
      AND (p.cost_revision IS NULL OR p.cost_revision != ? OR p.cost_summary IS NULL
        OR p.api_call_count IS NULL OR p.turn_data IS NULL)) LIMIT 8`)
  const batch = db.transaction(() => {
    const rows = read.all(PRICE_CATALOG_VERSION) as SessionDataRow[]
    for (const row of rows)
      writeSessionProjectUsage(db, aggregateSessionUsage(decodeMeterData(row)))
    return rows.length
  })
  while (db.open && batch.immediate() > 0)
    await new Promise<void>((resolve) => setImmediate(resolve))
}
