/**
 * 跨平台路径解析工具（对应 Java 各 Scanner 中的路径逻辑）
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir, platform } from 'os'
import { join, resolve } from 'path'

export function getHome(): string {
  return homedir()
}

export function isWindows(): boolean {
  return platform() === 'win32'
}

export function isMacos(): boolean {
  return platform() === 'darwin'
}

export function isLinux(): boolean {
  return platform() === 'linux'
}

function getAppData(): string {
  return process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
}

function getLocalAppData(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
}

/** ~/.claude/projects */
export function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects')
}

/** Codex 状态根目录：优先使用官方 CODEX_HOME，默认 ~/.codex。 */
export function getCodexHomeDir(): string {
  return resolveUserPath(process.env.CODEX_HOME || join(homedir(), '.codex'))
}

/**
 * Codex SQLite 状态目录。
 * 官方优先级：config.toml 的 sqlite_home > CODEX_SQLITE_HOME > CODEX_HOME。
 */
export function getCodexSqliteHomeDir(): string {
  const configValue = readRootTomlString(join(getCodexHomeDir(), 'config.toml'), 'sqlite_home')
  return resolveUserPath(configValue || process.env.CODEX_SQLITE_HOME || getCodexHomeDir())
}

/**
 * Codex 状态库候选文件。
 * 不绑定 state_5.sqlite：优先最新 state_<version>，同时兼容未来的 .sqlite/.sqlite3/.db 名称。
 * 扫描器还会验证 threads 表，避免误读同目录下的其他数据库。
 */
export function getCodexStateDbCandidates(): string[] {
  const sqliteHome = getCodexSqliteHomeDir()
  let names: string[]
  try {
    names = readdirSync(sqliteHome, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(?:sqlite|sqlite3|db)$/i.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return []
  }

  return names
    .sort((left, right) => compareCodexDbNames(left, right))
    .map((name) => join(sqliteHome, name))
}

/** 当前首选状态库；保留该方法供旧调用方使用。 */
export function getCodexStateDbFile(): string {
  return getCodexStateDbCandidates()[0] || join(getCodexSqliteHomeDir(), 'state_5.sqlite')
}

/** ~/.codex/session_index.jsonl */
export function getCodexSessionIndexFile(): string {
  return join(getCodexHomeDir(), 'session_index.jsonl')
}

/** ~/.codex/sessions */
export function getCodexSessionsDir(): string {
  return join(getCodexHomeDir(), 'sessions')
}

/** ~/.codex/archived_sessions */
export function getCodexArchivedSessionsDir(): string {
  return join(getCodexHomeDir(), 'archived_sessions')
}

/**
 * OpenCode 数据库候选路径（按优先级）
 * 对应 Java OpenCodeScanner.getDatabasePath()
 */
export function getOpencodeDbCandidates(): string[] {
  const home = homedir()
  const candidates: string[] = []

  // 1. CLI mode XDG path（所有平台都先查这个）
  candidates.push(join(home, '.local', 'share', 'opencode', 'opencode.db'))

  if (isWindows()) {
    candidates.push(join(getAppData(), 'ai.opencode.desktop', 'opencode.db'))
    candidates.push(join(getLocalAppData(), 'opencode', 'opencode.db'))
  } else if (isMacos()) {
    candidates.push(
      join(home, 'Library', 'Application Support', 'ai.opencode.desktop', 'opencode.db'),
    )
    candidates.push(join(home, '.config', 'opencode', 'opencode.db'))
  } else {
    candidates.push(join(home, '.config', 'ai.opencode.desktop', 'opencode.db'))
    candidates.push(join(home, '.local', 'share', 'ai.opencode.desktop', 'opencode.db'))
  }

  return candidates
}

/**
 * Z Code CLI 用量数据库候选路径。
 * db.sqlite 是现行文件名，zcode.db 兼容早期版本。
 */
export function getZCodeDbCandidates(): string[] {
  const home = homedir()
  return [
    join(home, '.zcode', 'cli', 'db', 'db.sqlite'),
    join(home, '.zcode', 'cli', 'db', 'zcode.db'),
  ]
}

/**
 * MiniMax Code 数据库候选路径
 * 对应 Java MiniMaxCodeScanner.getDatabasePath()
 */
export function getMavisDbCandidates(): string[] {
  const home = homedir()
  const runtimeStateDb = join(home, '.minimax', 'v2', 'sqlite', 'runtime-state.sqlite')
  const legacyCandidates = [join(home, '.mavis', 'sqlite.db'), join(home, '.minimax', 'sqlite.db')]

  // MiniMax Code 3.x on Windows writes current usage into the v2 runtime-state database.
  // Do not fall back to sqlite.db on Windows: that legacy database can remain present
  // and continue changing even though it no longer receives current token usage.
  if (isWindows()) return [runtimeStateDb]

  // Preserve the existing macOS compatibility fallback.
  if (isMacos()) return [runtimeStateDb, ...legacyCandidates]
  return legacyCandidates
}

/** ~/.workbuddy */
export function getWorkBuddyDir(): string {
  return join(homedir(), '.workbuddy')
}

/** ~/.workbuddy/workbuddy.db */
export function getWorkBuddyDb(): string {
  return join(getWorkBuddyDir(), 'workbuddy.db')
}

/** ~/.workbuddy/traces */
export function getWorkBuddyTracesDir(): string {
  return join(getWorkBuddyDir(), 'traces')
}

/** ~/.workbuddy/projects */
export function getWorkBuddyProjectsDir(): string {
  return join(getWorkBuddyDir(), 'projects')
}

export type KimiWorkSessionsKind = 'desktop' | 'kimi-cli'

export interface KimiWorkSessionsSource {
  dir: string
  kind: KimiWorkSessionsKind
}

/**
 * KimiWork sessions 目录候选（跨平台）。
 *
 * Windows 保持原有 kimi-desktop 路径不变。macOS 额外兼容 Kimi Code CLI 的
 * 官方 share 目录（默认 ~/.kimi，可由 KIMI_SHARE_DIR 覆盖）；两种数据源都使用
 * wire.jsonl，但 state.json 的元数据结构不同。
 */
export function getKimiWorkSessionsSources(): KimiWorkSessionsSource[] {
  const home = homedir()
  const basePath = 'kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions'

  if (isWindows()) {
    return [{ dir: join(getAppData(), basePath), kind: 'desktop' }]
  } else if (isMacos()) {
    const sources: KimiWorkSessionsSource[] = [
      {
        dir: join(home, 'Library', 'Application Support', basePath),
        kind: 'desktop',
      },
    ]
    const configuredShareDir = process.env.KIMI_SHARE_DIR?.trim()
    if (configuredShareDir) {
      sources.push({
        dir: join(resolveUserPath(configuredShareDir), 'sessions'),
        kind: 'kimi-cli',
      })
    }
    sources.push({ dir: join(home, '.kimi', 'sessions'), kind: 'kimi-cli' })
    return uniqueKimiSources(sources)
  } else {
    return [{ dir: join(home, '.config', basePath), kind: 'desktop' }]
  }
}

/** 旧调用方的首选目录；新扫描器应遍历 getKimiWorkSessionsSources()。 */
export function getKimiWorkSessionsDir(): string {
  return getKimiWorkSessionsSources()[0].dir
}

/**
 * 应用数据目录
 * ~/.ohmytoken/
 */
export function getAppDataDir(): string {
  return join(homedir(), '.ohmytoken')
}

/** ~/.ohmytoken/usage.db（SQLite 数据库文件） */
export function getUsageDbFile(): string {
  return join(getAppDataDir(), 'usage.db')
}

function resolveUserPath(value: string): string {
  const trimmed = value.trim()
  const expanded =
    trimmed === '~'
      ? homedir()
      : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
        ? join(homedir(), trimmed.substring(2))
        : trimmed
  return resolve(expanded)
}

function uniqueKimiSources(sources: KimiWorkSessionsSource[]): KimiWorkSessionsSource[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.dir)) return false
    seen.add(source.dir)
    return true
  })
}

function readRootTomlString(file: string, key: string): string {
  if (!existsSync(file)) return ''
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return ''
  }

  const escapedKey = key.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
  const assignment = new RegExp(`^\\s*${escapedKey}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')`)
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break
    const match = assignment.exec(line)
    if (!match) continue
    const literal = match[1]
    if (literal.startsWith("'")) return literal.slice(1, -1)
    try {
      const parsed: unknown = JSON.parse(literal)
      return typeof parsed === 'string' ? parsed : ''
    } catch {
      return ''
    }
  }
  return ''
}

function compareCodexDbNames(left: string, right: string): number {
  const leftRank = codexDbRank(left)
  const rightRank = codexDbRank(right)
  if (leftRank.kind !== rightRank.kind) return rightRank.kind - leftRank.kind
  if (leftRank.version !== rightRank.version) return rightRank.version - leftRank.version
  return right.localeCompare(left)
}

function codexDbRank(name: string): { kind: number; version: number } {
  const versioned = /^state_(\d+)\.(?:sqlite|sqlite3|db)$/i.exec(name)
  if (versioned) return { kind: 3, version: Number.parseInt(versioned[1], 10) || 0 }
  if (/^state\.(?:sqlite|sqlite3|db)$/i.test(name)) return { kind: 2, version: 0 }
  return { kind: 1, version: 0 }
}
