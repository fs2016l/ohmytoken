import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

export interface ClaudeDesktopSession {
  /** 桌面端侧栏显示的会话标题。 */
  title?: string
  /** 派生出本会话的 Claude Code 会话（JSONL 会话 ID）。 */
  parentSessionId?: string
}

type Entry = {
  localId: string
  cliSessionId: string
  title?: string
  spawnedFrom?: string
  detached: boolean
}

const cache = new Map<string, { mtimeMs: number; size: number; entry: Entry | undefined }>()

/**
 * Claude 桌面端为每个 Code 会话另存 `<账号>/<用户>/local_*.json`：`cliSessionId` 对应 JSONL
 * 会话，`spawnedFrom.sessionId` 是派生它的桌面会话。JSONL 不记录侧边会话的父会话，
 * 与桌面端一致，`lineageDetached` 的会话已移到顶层，不再挂到父会话下。
 * 元数据只是辅助来源，不可读或结构不符的文件跳过，不影响用量扫描。
 */
export function readClaudeDesktopSessions(
  roots: readonly string[],
): Map<string, ClaudeDesktopSession> {
  const entries = new Map<string, Entry>()
  for (const root of roots)
    for (const account of directories(root))
      for (const user of directories(account))
        for (const name of fileNames(user)) {
          if (!/^local_[\w-]{1,128}\.json$/.test(name)) continue
          const entry = readEntry(join(user, name))
          if (entry && !entries.has(entry.localId)) entries.set(entry.localId, entry)
        }
  const sessions = new Map<string, ClaudeDesktopSession>()
  for (const entry of entries.values()) {
    const parent =
      entry.spawnedFrom && !entry.detached
        ? entries.get(entry.spawnedFrom)?.cliSessionId
        : undefined
    sessions.set(entry.cliSessionId, {
      ...(entry.title ? { title: entry.title } : {}),
      ...(parent && parent !== entry.cliSessionId ? { parentSessionId: parent } : {}),
    })
  }
  return sessions
}

function readEntry(file: string): Entry | undefined {
  let stat: import('fs').Stats
  try {
    stat = statSync(file)
  } catch {
    return undefined
  }
  const cached = cache.get(file)
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.entry
  let entry: Entry | undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    entry = parseEntry(value)
  } catch {
    entry = undefined
  }
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, entry })
  return entry
}

function parseEntry(value: unknown): Entry | undefined {
  if (!isObject(value)) return undefined
  const localId = text(value.sessionId)
  const cliSessionId = text(value.cliSessionId)
  if (!localId?.startsWith('local_') || !cliSessionId || cliSessionId.length > 256) return undefined
  const title = text(value.title)
  const spawnedFrom = isObject(value.spawnedFrom) ? text(value.spawnedFrom.sessionId) : undefined
  return {
    localId,
    cliSessionId,
    ...(title && title.length <= 1024 ? { title } : {}),
    ...(spawnedFrom ? { spawnedFrom } : {}),
    detached: value.lineageDetached === true,
  }
}

function directories(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name))
  } catch {
    return []
  }
}

function fileNames(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
