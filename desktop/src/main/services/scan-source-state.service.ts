/** 保存各数据源下一次增量扫描所需的恢复状态。 */
import type Database from 'better-sqlite3'
import { openDatabase } from './sqlite-storage.service'

export interface ScanSourceStateRow {
  agent: string
  source_id: string
  source_type: string
  source_scope: string
  current_path: string
  source_size: number
  source_mtime_ms: number
  cursor_offset: number
  cursor_json: string
  fingerprint: string
  event_watermark_ms: number
  last_success_ms: number
}

export type ScanSourceStateUpdate = Omit<ScanSourceStateRow, 'last_success_ms'> & {
  last_success_ms?: number
}

export function getSourceStatesByType(agent: string, sourceType: string): ScanSourceStateRow[] {
  return openDatabase()
    .prepare('SELECT * FROM scan_source_state WHERE agent = ? AND source_type = ?')
    .all(agent, sourceType) as ScanSourceStateRow[]
}

/** 调用方可传入现有事务连接，使游标与本轮用量原子提交。 */
export function saveSourceState(
  state: ScanSourceStateUpdate,
  connection: Database.Database = openDatabase(),
): void {
  connection
    .prepare(
      `INSERT INTO scan_source_state
        (agent, source_id, source_type, source_scope, current_path, source_size,
         source_mtime_ms, cursor_offset, cursor_json, fingerprint, event_watermark_ms,
         last_success_ms)
       VALUES (@agent, @source_id, @source_type, @source_scope, @current_path, @source_size,
         @source_mtime_ms, @cursor_offset, @cursor_json, @fingerprint, @event_watermark_ms,
         @last_success_ms)
       ON CONFLICT(agent, source_id) DO UPDATE SET
         source_type = excluded.source_type,
         source_scope = excluded.source_scope,
         current_path = excluded.current_path,
         source_size = excluded.source_size,
         source_mtime_ms = excluded.source_mtime_ms,
         cursor_offset = excluded.cursor_offset,
         cursor_json = excluded.cursor_json,
         fingerprint = excluded.fingerprint,
         event_watermark_ms = excluded.event_watermark_ms,
         last_success_ms = excluded.last_success_ms`,
    )
    .run({
      agent: state.agent,
      source_id: state.source_id,
      source_type: state.source_type,
      source_scope: state.source_scope,
      current_path: state.current_path,
      source_size: state.source_size,
      source_mtime_ms: state.source_mtime_ms,
      cursor_offset: state.cursor_offset,
      cursor_json: state.cursor_json,
      fingerprint: state.fingerprint,
      event_watermark_ms: state.event_watermark_ms,
      last_success_ms: state.last_success_ms ?? Date.now(),
    })
}
