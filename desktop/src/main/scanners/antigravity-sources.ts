import { createHash } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { basename, join, resolve } from 'path'
import type {
  ScanSourceStateRow,
  ScanSourceStateUpdate,
} from '../services/scan-source-state.service'
import { isIncrementalContext } from './incremental-utils'
import type { ScannerScanContext } from './types'

export const ANTIGRAVITY_SOURCE_TYPE = 'antigravity-conversation'

export function conversationFiles(root: string): Map<string, string> {
  const result = new Map<string, string>()
  const directory = join(root, 'conversations')
  for (const entry of listEntries(directory)) {
    if (entry.isFile() && entry.name.endsWith('.db'))
      result.set(basename(entry.name, '.db'), join(directory, entry.name))
  }
  return result
}

export function transcriptFiles(root: string): Map<string, string> {
  const result = new Map<string, string>()
  const directory = join(root, 'brain')
  for (const entry of listEntries(directory)) {
    if (!entry.isDirectory()) continue
    const logs = join(directory, entry.name, '.system_generated', 'logs')
    const canonical = join(logs, 'transcript.jsonl')
    const full = join(logs, 'transcript_full.jsonl')
    if (existsSync(canonical)) result.set(entry.name, canonical)
    else if (existsSync(full)) result.set(entry.name, full)
  }
  return result
}

function listEntries(directory: string): import('fs').Dirent[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** 一份会话快照同时依赖主库、WAL、转录以及摘要中的标题和归属。 */
export function antigravitySourceState(
  root: string,
  sessionId: string,
  database: string | undefined,
  transcript: string | undefined,
  metadata: unknown,
): ScanSourceStateUpdate {
  const scope = resolve(root)
  let size = 0
  let mtimeMs = 0
  const files = [database, database ? `${database}-wal` : undefined, transcript].map((file) => {
    if (!file) return null
    const stat = statSync(file, { bigint: true, throwIfNoEntry: false })
    if (!stat) return [file, null]
    size += Number(stat.size)
    mtimeMs = Math.max(mtimeMs, Number(stat.mtimeNs) / 1e6)
    // ctime 和文件身份也参与比较，识别同大小覆盖、恢复 mtime 及文件替换。
    return [file, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].map(
      String,
    )
  })
  return {
    agent: 'antigravity',
    source_id: createHash('sha256').update(scope).update('\0').update(sessionId).digest('hex'),
    source_type: ANTIGRAVITY_SOURCE_TYPE,
    source_scope: scope,
    current_path: database ?? transcript!,
    source_size: size,
    source_mtime_ms: mtimeMs,
    cursor_offset: 0,
    cursor_json: '{}',
    fingerprint:
      'v1:' +
      createHash('sha256')
        .update(JSON.stringify([files, metadata]))
        .digest('hex'),
    event_watermark_ms: 0,
  }
}

export function shouldScanAntigravitySource(
  current: ScanSourceStateUpdate,
  stored: ScanSourceStateRow | undefined,
  context: ScannerScanContext,
): boolean {
  if (!isIncrementalContext(context) || !stored) return true
  // 按上次成功事件水位回看五小时；边界上的会话也重读，供窗口删除/替换对账。
  // 窗口外仍检测全部文件变化，不以 DB mtime 或最大 idx 单独判定没有旧记录修正。
  return (
    !Number.isFinite(stored.event_watermark_ms) ||
    stored.event_watermark_ms < 0 ||
    stored.event_watermark_ms >= context.sinceMs ||
    current.source_mtime_ms >= context.sinceMs ||
    stored.fingerprint !== current.fingerprint
  )
}
