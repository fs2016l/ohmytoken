import type Database from 'better-sqlite3'

const IMPORT_TABLES = [
  'usage_session_data',
  'usage_api_calls',
  'usage_cost_cache',
  'usage_sessions',
  'usage_records',
]

/** 调用方负责事务边界；唯一性索引始终参与写入校验。 */
export function removeUsageQueryIndexes(db: Database.Database): string[] {
  if (!db.inTransaction) throw new Error('查询索引调整必须在事务中执行')
  const definitions: string[] = []
  const readDefinition = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
  )
  for (const table of IMPORT_TABLES) {
    const indexes = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{
      name: string
      unique: number
    }>
    for (const index of indexes) {
      if (index.unique) continue
      const definition = readDefinition.get(index.name) as { sql: string }
      definitions.push(definition.sql)
      db.exec(`DROP INDEX "${index.name.replaceAll('"', '""')}"`)
    }
  }
  return definitions
}

/** 空重建库先保留写入约束，费用汇总前再补齐必要索引。 */
export function prepareScanImport(db: Database.Database): () => void {
  for (const table of IMPORT_TABLES) {
    if (db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()) {
      throw new Error('批量导入必须使用空的重建库')
    }
  }
  const rollupIndex = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_usage_cost_rollup'",
    )
    .get() as { sql: string } | undefined
  if (!rollupIndex) throw new Error('缺少费用汇总索引定义')

  db.transaction(() => {
    removeUsageQueryIndexes(db)
    for (const table of IMPORT_TABLES) {
      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?")
        .all(table) as Array<{ name: string }>
      for (const trigger of triggers) {
        db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`)
      }
    }
  })()

  let ready = false
  return () => {
    if (ready) return
    db.exec(rollupIndex.sql)
    ready = true
  }
}
