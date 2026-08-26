/**
 * 跨平台路径解析工具（对应 Java 各 Scanner 中的路径逻辑）
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir, platform } from 'os'
import { basename, dirname, join, resolve } from 'path'

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

/** Codex 自动清理前保存的 rollout 归档。 */
export function getCodexCleanupArchiveDir(): string {
  return join(getCodexHomeDir(), 'session-cleanup-archive')
}

/**
 * OpenCode 数据库候选路径（按优先级）
 * 对应 Java OpenCodeScanner.getDatabasePath()
 */
export function getOpencodeDbCandidates(): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()
  for (const directory of getOpencodeDataDirCandidates()) {
    for (const file of listOpencodeDatabases(directory)) {
      const key = isWindows() ? file.toLowerCase() : file
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(file)
    }
  }
  return candidates
}

/** OpenCode CLI/桌面端数据根目录，即使数据库未创建也保留作为 JSON 候选。 */
export function getOpencodeDataDirCandidates(): string[] {
  const home = homedir()
  const directories = [join(home, '.local', 'share', 'opencode')]
  if (isWindows()) {
    directories.push(join(getAppData(), 'ai.opencode.desktop'))
    directories.push(join(getLocalAppData(), 'opencode'))
  } else if (isMacos()) {
    directories.push(join(home, 'Library', 'Application Support', 'ai.opencode.desktop'))
    directories.push(join(home, '.config', 'opencode'))
  } else {
    directories.push(join(home, '.config', 'ai.opencode.desktop'))
    directories.push(join(home, '.local', 'share', 'ai.opencode.desktop'))
  }
  return [...new Set(directories)]
}

export function getOpencodeMessageDirCandidates(): string[] {
  return getOpencodeDataDirCandidates().map((directory) => join(directory, 'storage', 'message'))
}

function listOpencodeDatabases(directory: string): string[] {
  let entries: import('fs').Dirent[]
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }

  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name === 'opencode.db' || /^opencode-[A-Za-z0-9._-]+\.db$/.test(entry.name)),
    )
    .map((entry) => join(directory, entry.name))
  return files.sort((left, right) => {
    const leftDefault = left.endsWith(`${isWindows() ? '\\' : '/'}opencode.db`) ? 0 : 1
    const rightDefault = right.endsWith(`${isWindows() ? '\\' : '/'}opencode.db`) ? 0 : 1
    return leftDefault - rightDefault || left.localeCompare(right)
  })
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
  return [runtimeStateDb, ...legacyCandidates]
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

export type KimiWorkSessionsKind = 'desktop'

export interface KimiWorkSessionsSource {
  dir: string
  kind: KimiWorkSessionsKind
}

/**
 * KimiWork sessions 目录候选（跨平台）。
 *
 * 只包含 Kimi Work 桌面端目录。Kimi Code CLI 使用独立的
 * getKimiCodeSessionsSources()，避免两个 Agent 串数据。
 */
export function getKimiWorkSessionsSources(): KimiWorkSessionsSource[] {
  const home = homedir()
  const basePath = 'kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions'

  if (isWindows()) {
    return [{ dir: join(getAppData(), basePath), kind: 'desktop' }]
  } else if (isMacos()) {
    return [
      {
        dir: join(home, 'Library', 'Application Support', basePath),
        kind: 'desktop',
      },
    ]
  } else {
    return [{ dir: join(home, '.config', basePath), kind: 'desktop' }]
  }
}

/** 旧调用方的首选目录；新扫描器应遍历 getKimiWorkSessionsSources()。 */
export function getKimiWorkSessionsDir(): string {
  return getKimiWorkSessionsSources()[0].dir
}

export type KimiCodeSessionsKind = 'kimi-code' | 'kimi-cli'

export interface KimiCodeSessionsSource {
  dir: string
  kind: KimiCodeSessionsKind
}

/** Kimi Code 新版与旧 Kimi CLI 会话目录；二者统一归入独立的 kimi-code Agent。 */
export function getKimiCodeSessionsSources(): KimiCodeSessionsSource[] {
  const configuredCodeHome = process.env.KIMI_CODE_HOME?.trim()
  const codeHome = configuredCodeHome
    ? resolveUserPath(configuredCodeHome)
    : join(homedir(), '.kimi-code')
  const configuredShareDir = process.env.KIMI_SHARE_DIR?.trim()
  const legacyHome = configuredShareDir
    ? resolveUserPath(configuredShareDir)
    : join(homedir(), '.kimi')
  return uniqueSources([
    { dir: join(codeHome, 'sessions'), kind: 'kimi-code' },
    { dir: join(legacyHome, 'sessions'), kind: 'kimi-cli' },
  ])
}

/** Gemini CLI 会话根目录。 */
export function getGeminiTmpDir(): string {
  const configured = process.env.GEMINI_CLI_HOME?.trim()
  const root = configured ? resolveUserPath(configured) : join(homedir(), '.gemini')
  return join(root, 'tmp')
}

/** Qwen Code 会话目录。 */
export function getQwenProjectsDir(): string {
  return join(homedir(), '.qwen', 'projects')
}

/** OpenClaw Agent 转录目录。 */
export function getOpenClawAgentsDir(): string {
  return join(homedir(), '.openclaw', 'agents')
}

/** Grok Build 数据根目录。 */
export function getGrokHomeDir(): string {
  const configured = process.env.GROK_HOME?.trim()
  return configured ? resolveUserPath(configured) : join(homedir(), '.grok')
}

export function getGrokSessionsDir(): string {
  return join(getGrokHomeDir(), 'sessions')
}

export function getGrokUnifiedLogFile(): string {
  return join(getGrokHomeDir(), 'logs', 'unified.jsonl')
}

/** Zed Agent 线程数据库。 */
export function getZedThreadsDbCandidates(): string[] {
  const home = homedir()
  if (isWindows()) return [join(getLocalAppData(), 'Zed', 'threads', 'threads.db')]
  if (isMacos()) {
    return [join(home, 'Library', 'Application Support', 'Zed', 'threads', 'threads.db')]
  }
  const xdgData = process.env.XDG_DATA_HOME?.trim()
  return [
    join(
      xdgData ? resolveUserPath(xdgData) : join(home, '.local', 'share'),
      'zed',
      'threads',
      'threads.db',
    ),
  ]
}

/** Goose 会话数据库，按当前平台与官方覆盖变量排序。 */
export function getGooseSessionsDbCandidates(): string[] {
  const home = homedir()
  const candidates: string[] = []
  const configuredRoot = process.env.GOOSE_PATH_ROOT?.trim()
  if (configuredRoot) {
    candidates.push(join(resolveUserPath(configuredRoot), 'data', 'sessions', 'sessions.db'))
  }
  const xdgData = process.env.XDG_DATA_HOME?.trim()
  const dataHome = xdgData
    ? resolveUserPath(xdgData)
    : isWindows()
      ? getLocalAppData()
      : join(home, '.local', 'share')
  candidates.push(join(dataHome, 'goose', 'sessions', 'sessions.db'))
  candidates.push(join(dataHome, 'Block', 'goose', 'sessions', 'sessions.db'))
  if (isWindows()) {
    candidates.push(join(getAppData(), 'goose', 'sessions', 'sessions.db'))
  } else if (isMacos()) {
    candidates.push(
      join(home, 'Library', 'Application Support', 'goose', 'sessions', 'sessions.db'),
    )
    candidates.push(
      join(home, 'Library', 'Application Support', 'Block', 'goose', 'sessions', 'sessions.db'),
    )
  }
  return [...new Set(candidates)]
}

/** Hermes 主状态库及 profile 状态库。 */
export function getHermesStateDbCandidates(): string[] {
  const configured = process.env.HERMES_HOME?.trim()
  const roots = configured
    ? [resolveUserPath(configured)]
    : uniquePaths([
        join(homedir(), '.hermes'),
        ...(isWindows()
          ? [join(getLocalAppData(), 'hermes'), join(homedir(), 'AppData', 'Local', 'hermes')]
          : []),
      ])
  const candidates: string[] = []
  for (const root of roots) {
    candidates.push(join(root, 'state.db'))
    // HERMES_HOME 直指 profiles/<name> 时是隔离边界，不扫同级 profile。
    if (basename(dirname(root)).toLowerCase() === 'profiles') continue
    const profiles = join(root, 'profiles')
    try {
      for (const entry of readdirSync(profiles, { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(join(profiles, entry.name, 'state.db'))
      }
    } catch {
      // profile 目录是可选的。
    }
  }
  return uniquePaths(candidates)
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

function uniqueSources<T extends { dir: string }>(sources: T[]): T[] {
  const seen = new Set<string>()
  return sources.filter((source) => {
    const key = isWindows() ? source.dir.toLowerCase() : source.dir
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = isWindows() ? path.toLowerCase() : path
    if (seen.has(key)) return false
    seen.add(key)
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
