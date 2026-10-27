import { statSync } from 'node:fs'
import Database from 'better-sqlite3'
import { object, type JsonObject } from './types'
import type { TokenPlanDiscoveryIssue } from '../../shared/token-plan'

/** OpenCode v2 moves auth.json into the credential table, including multiple logins. */
export function readOpenCodeCredentials(databases: string[]): {
  authoritative: boolean
  entries: Array<{ provider: string; auth: JsonObject }>
  issues: TokenPlanDiscoveryIssue[]
} {
  const result = {
    authoritative: false,
    entries: [] as Array<{ provider: string; auth: JsonObject }>,
    issues: [] as TokenPlanDiscoveryIssue[],
  }
  for (const file of databases) {
    let db: Database.Database | undefined
    try {
      statSync(file)
      db = new Database(file, { readonly: true, fileMustExist: true })
      db.exec('PRAGMA busy_timeout = 2000')
      const columns = db.prepare('PRAGMA table_info(credential)').all() as Array<{ name: string }>
      if (!columns.length) continue
      result.authoritative = true
      if (!['integration_id', 'value'].every((name) => columns.some((row) => row.name === name))) {
        result.issues.push({ source: 'OpenCode', reason: 'invalid_config' })
        break
      }
      const rows = db
        .prepare('SELECT integration_id, value FROM credential LIMIT 1001')
        .all() as Array<{ integration_id: unknown; value: unknown }>
      if (rows.length > 1000) throw new Error('invalid_config')
      for (const row of rows) {
        if (typeof row.integration_id !== 'string' || typeof row.value !== 'string') continue
        try {
          const value = object(JSON.parse(row.value))
          if (value.type !== 'key' && value.type !== 'api' && value.type !== 'oauth') continue
          result.entries.push({
            provider: row.integration_id,
            auth: {
              ...value,
              accountId: value.accountId ?? object(value.metadata).accountId,
            },
          })
        } catch {
          result.issues.push({ source: 'OpenCode', reason: 'invalid_config' })
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') continue
      // An unreadable current store cannot authorize fallback to a stale login.
      result.authoritative = true
      result.issues.push({ source: 'OpenCode', reason: 'unreadable' })
    } finally {
      db?.close()
    }
    // A current credential table, even empty after logout, supersedes migrated copies.
    if (result.authoritative) break
  }
  return result
}
