import type Database from 'better-sqlite3'
import { canonicalModelName } from '../cost/price-catalog'
import { openDatabase } from './sqlite-storage.service'

interface ModelRow {
  model: string
}

interface StoredNamesCache {
  dataVersion: number
  totalChanges: number
  names: string[]
}

const storedNamesCache = new WeakMap<Database.Database, StoredNamesCache>()

function distinctStoredModels(db: Database.Database): string[] {
  const { dataVersion, totalChanges } = db
    .prepare(
      'SELECT data_version AS dataVersion, total_changes() AS totalChanges FROM pragma_data_version',
    )
    .get() as { dataVersion: number; totalChanges: number }
  const cached = storedNamesCache.get(db)
  if (cached?.dataVersion === dataVersion && cached.totalChanges === totalChanges)
    return cached.names
  const names = (
    db
      .prepare(
        `SELECT model FROM usage_records UNION SELECT model FROM usage_sessions
        UNION SELECT model FROM usage_session_data UNION SELECT model FROM usage_api_calls`,
      )
      .all() as ModelRow[]
  ).map(({ model }) => model)
  // A scanner may commit on another connection while the query runs. The next read must retry.
  if ((db.pragma('data_version', { simple: true }) as number) === dataVersion)
    storedNamesCache.set(db, { dataVersion, totalChanges, names })
  return names
}

/** Expand a displayed model to the original spellings kept in the local database. */
export function storedModelNames(
  selected: readonly string[],
  db: Database.Database = openDatabase(),
): string[] {
  if (!selected.length) return []
  const wanted = new Set(selected.map(canonicalModelName))
  const matches = distinctStoredModels(db).filter((model) => wanted.has(canonicalModelName(model)))
  return matches.length ? matches : [...selected]
}

export function modelSqlSelection(
  column: string,
  selected: readonly string[],
  db?: Database.Database,
): { sql: string; params: string[] } {
  const names = storedModelNames(selected, db)
  const clauses: string[] = []
  for (let index = 0; index < names.length; index += 256) {
    const group = names.slice(index, index + 256)
    clauses.push(`${column} IN (${group.map(() => '?').join(',')})`)
  }
  return {
    sql: clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0] || '0 = 1',
    params: names,
  }
}
