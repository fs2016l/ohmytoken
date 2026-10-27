/**
 * 跨平台路径解析工具（对应 Java 各 Scanner 中的路径逻辑）
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { homedir, platform } from 'os'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { miniMaxDesktopDataRoots, miniMaxProfileRoots } from './minimax-desktop'
import { zCodeDatabaseCandidates } from './zcode-storage'
import { parseJsonConfig } from './json-config'

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
  return getClaudeProjectsDirCandidates()[0]
}

export function getClaudeProjectsDirCandidates(): string[] {
  const configured = process.env.CLAUDE_CONFIG_DIR?.trim()
  const initial = configured ? resolveUserPath(configured) : join(homedir(), '.claude')
  let saved: unknown
  try {
    const file = join(initial, 'settings.json')
    if (statSync(file).size > 1024 * 1024) throw new Error()
    const bytes = readFileSync(file)
    if (bytes.length > 1024 * 1024) throw new Error()
    const settings = parseJsonConfig(bytes.toString('utf8')) as {
      env?: { CLAUDE_CONFIG_DIR?: unknown }
    } | null
    saved = settings?.env?.CLAUDE_CONFIG_DIR
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'ENOTDIR')
      throw new Error('Claude Code 用户目录设置不可读，无法确定完整统计来源')
  }
  return uniquePaths([
    ...(typeof saved === 'string' && isAbsolute(saved.trim())
      ? [join(resolveUserPath(saved), 'projects')]
      : []),
    ...(configured ? [join(resolveUserPath(configured), 'projects')] : []),
    join(homedir(), '.claude', 'projects'),
  ])
}

/** Claude 桌面端为 Code 会话保存标题与派生关系的目录；MSIX 安装可能重定向到包目录。 */
export function getClaudeDesktopSessionRoots(): string[] {
  const home = homedir()
  if (isMacos())
    return [join(home, 'Library', 'Application Support', 'Claude', 'claude-code-sessions')]
  if (!isWindows())
    return [
      join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude-code-sessions'),
    ]
  const roots = [join(getAppData(), 'Claude', 'claude-code-sessions')]
  const packages = join(getLocalAppData(), 'Packages')
  try {
    for (const entry of readdirSync(packages, { withFileTypes: true }))
      if (entry.isDirectory() && /^Claude_/i.test(entry.name))
        roots.push(
          join(packages, entry.name, 'LocalCache', 'Roaming', 'Claude', 'claude-code-sessions'),
        )
  } catch {
    // 没有 MSIX 包目录时只使用默认位置。
  }
  return roots
}

/** Codex 状态根目录：优先使用官方 CODEX_HOME，默认 ~/.codex。 */
export function getCodexHomeDir(home = homedir(), env: NodeJS.ProcessEnv = process.env): string {
  return resolveUserPath(env.CODEX_HOME?.trim() || join(home, '.codex'), home)
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
export function getOpencodeDbCandidates(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  osPlatform = platform(),
): string[] {
  const directories = getOpencodeDataDirCandidates(home, env, osPlatform)
  const configured = env.OPENCODE_DB?.trim()
  const candidates: string[] =
    configured && configured !== ':memory:' ? [resolve(directories[0], configured)] : []
  const seen = new Set<string>()
  for (const directory of directories) {
    for (const file of listOpencodeDatabases(directory)) {
      const key = osPlatform === 'win32' ? file.toLowerCase() : file
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push(file)
    }
  }
  return uniquePaths(candidates, osPlatform === 'win32')
}

/** OpenCode CLI/桌面端数据根目录，即使数据库未创建也保留作为 JSON 候选。 */
export function getOpencodeDataDirCandidates(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  osPlatform = platform(),
): string[] {
  const xdg = env.XDG_DATA_HOME?.trim()
  const directories = [
    ...(xdg ? [join(resolveUserPath(xdg, home), 'opencode')] : []),
    join(home, '.local', 'share', 'opencode'),
  ]
  if (osPlatform === 'win32') {
    directories.push(join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'ai.opencode.desktop'))
    directories.push(join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'opencode'))
  } else if (osPlatform === 'darwin') {
    directories.push(join(home, 'Library', 'Application Support', 'ai.opencode.desktop'))
    directories.push(join(home, '.config', 'opencode'))
  } else {
    directories.push(join(home, '.config', 'ai.opencode.desktop'))
    directories.push(join(home, '.local', 'share', 'ai.opencode.desktop'))
  }
  return uniquePaths(directories, osPlatform === 'win32')
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
    const leftDefault = basename(left) === 'opencode.db' ? 0 : 1
    const rightDefault = basename(right) === 'opencode.db' ? 0 : 1
    return leftDefault - rightDefault || left.localeCompare(right)
  })
}

/**
 * Z Code CLI 用量数据库候选路径。
 * db.sqlite 是现行文件名，zcode.db 兼容早期版本。
 */
export function getZCodeDbCandidates(): string[] {
  const home = homedir()
  return zCodeDatabaseCandidates(home)
}

/**
 * MiniMax Code 数据根目录：官方覆盖变量、桌面端自定义目录及迁移前目录、默认历史。
 * 只枚举已知数据父目录的直接 profile 子目录，不递归查找磁盘。
 */
export function getMavisDataDirCandidates(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
  osPlatform: NodeJS.Platform = platform(),
): string[] {
  const configured = env.MINIMAX_DATA_DIR?.trim() || env.MAVIS_DATA_DIR?.trim()
  const roots = configured ? [resolveUserPath(configured, home)] : []
  roots.push(...miniMaxDesktopDataRoots(home, env, osPlatform))
  roots.push(join(home, '.minimax'))
  roots.push(...miniMaxProfileRoots(home))
  roots.push(join(home, '.minimax-code'), join(home, '.mavis'))
  return uniquePaths(roots, osPlatform === 'win32')
}

/** MiniMax Code 新版 runtime 与早期 SQLite 数据库候选，逐根目录按版本排序。 */
export function getMavisDbCandidates(): string[] {
  return uniquePaths(
    getMavisDataDirCandidates().flatMap((root) => [
      join(root, 'v2', 'sqlite', 'runtime-state.sqlite'),
      join(root, 'sqlite.db'),
    ]),
  )
}

/**
 * 新版 runtime 用量行的 model 常为空，由同一数据根目录的 config.yaml 兜底。
 * 指定数据库时仅返回该库所属根目录配置，避免读取其他 profile 的 defaultModel。
 */
export function getMavisConfigCandidates(dbPath?: string): string[] {
  if (dbPath) {
    const database = resolveUserPath(dbPath)
    const directory = dirname(database)
    const runtime =
      basename(database) === 'runtime-state.sqlite' &&
      basename(directory) === 'sqlite' &&
      basename(dirname(directory)) === 'v2'
    const root = runtime ? dirname(dirname(directory)) : directory
    return [join(root, 'config.yaml')]
  }
  return getMavisDataDirCandidates().map((root) => join(root, 'config.yaml'))
}

/** ~/.workbuddy */
export function getWorkBuddyDirCandidates(): string[] {
  const configured =
    process.env.WORKBUDDY_CONFIG_DIR?.trim() || process.env.CODEBUDDY_CONFIG_DIR?.trim()
  return uniquePaths([
    ...(configured ? [resolveUserPath(configured)] : []),
    join(homedir(), '.workbuddy'),
  ])
}

export function getWorkBuddyDir(): string {
  return getWorkBuddyDirCandidates()[0]
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

/** KimiWork 桌面端配置目录（kimi-desktop），daimon-storage.json 所在处。 */
function getKimiDesktopConfigDir(): string {
  const home = homedir()
  if (isWindows()) return join(getAppData(), 'kimi-desktop')
  if (isMacos()) return join(home, 'Library', 'Application Support', 'kimi-desktop')
  return join(home, '.config', 'kimi-desktop')
}

/** Kimi Work 桌面端手动重命名的会话标题，独立于可重定向的运行时目录。 */
export function getKimiWorkTitleOverridesFile(): string {
  return join(getKimiDesktopConfigDir(), 'kimi-agent', 'conversation-titles.json')
}

/** 从 daimon-storage.json 文本提取 shareDir；损坏或字段无效时返回空串。 */
export function kimiWorkShareDirFromStorageText(text: string): string {
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return ''
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return ''
  const shareDir = (obj as Record<string, unknown>).shareDir
  return typeof shareDir === 'string' && shareDir.trim() ? shareDir.trim() : ''
}

/** 读取 kimi-desktop 的 daimon-storage.json 中重定向的 shareDir；缺失或不可读返回空串。 */
function readKimiWorkShareDir(): string {
  try {
    return kimiWorkShareDirFromStorageText(
      readFileSync(join(getKimiDesktopConfigDir(), 'daimon-storage.json'), 'utf8'),
    )
  } catch {
    return ''
  }
}

/** 由默认 sessions 目录与 daimon-storage.json 的 shareDir 组合候选源；shareDir 无效时只剩默认。 */
export function kimiWorkSessionsSourcesFrom(
  defaultDir: string,
  shareDir: string,
): KimiWorkSessionsSource[] {
  const redirected = shareDir
    ? join(resolveUserPath(shareDir), 'daimon', 'runtime', 'kimi-code', 'home', 'sessions')
    : ''
  const sources: KimiWorkSessionsSource[] = redirected
    ? [
        { dir: redirected, kind: 'desktop' },
        { dir: defaultDir, kind: 'desktop' },
      ]
    : [{ dir: defaultDir, kind: 'desktop' }]
  return uniqueSources(sources)
}

/**
 * KimiWork sessions 目录候选（跨平台）。
 *
 * 只包含 Kimi Work 桌面端目录。Kimi Code CLI 使用独立的
 * getKimiCodeSessionsSources()，避免两个 Agent 串数据。
 *
 * 桌面端把 daimon-share 重定向到自定义位置时会写入 kimi-desktop 配置目录的
 * daimon-storage.json（shareDir 字段）；重定向目录排在默认目录前，
 * 未重定向、配置损坏或旧目录残留历史数据时默认目录继续兜底。
 */
export function getKimiWorkSessionsSources(): KimiWorkSessionsSource[] {
  const home = homedir()
  const basePath = 'kimi-desktop/daimon-share/daimon/runtime/kimi-code/home/sessions'
  const defaultDir = isWindows()
    ? join(getAppData(), basePath)
    : isMacos()
      ? join(home, 'Library', 'Application Support', basePath)
      : join(home, '.config', basePath)
  return kimiWorkSessionsSourcesFrom(defaultDir, readKimiWorkShareDir())
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
export function getKimiCodeSessionsSources(
  home = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): KimiCodeSessionsSource[] {
  const configuredCodeHome = env.KIMI_CODE_HOME?.trim()
  const codeHome = configuredCodeHome
    ? resolveUserPath(configuredCodeHome, home)
    : join(home, '.kimi-code')
  const configuredShareDir = env.KIMI_SHARE_DIR?.trim()
  const legacyHome = configuredShareDir
    ? resolveUserPath(configuredShareDir, home)
    : join(home, '.kimi')
  return uniqueSources([
    { dir: join(codeHome, 'sessions'), kind: 'kimi-code' },
    { dir: join(home, '.kimi-code', 'sessions'), kind: 'kimi-code' },
    { dir: join(legacyHome, 'sessions'), kind: 'kimi-cli' },
    { dir: join(home, '.kimi', 'sessions'), kind: 'kimi-cli' },
  ])
}

/** Gemini CLI 会话根目录。 */
export function getGeminiTmpDir(): string {
  return getGeminiTmpDirCandidates()[0]
}

/** 覆写 home 后仍保留默认历史；Seatbelt 的运行时与配置目录不同。 */
export function getGeminiTmpDirCandidates(): string[] {
  const configured = process.env.GEMINI_CLI_HOME?.trim()
  const homes = uniquePaths([...(configured ? [resolveUserPath(configured)] : []), homedir()])
  return uniquePaths(
    homes.flatMap((home) => {
      const normal = join(home, '.gemini', 'tmp')
      const sandbox = join(home, '.cache', '.gemini', 'tmp')
      return process.env.SANDBOX === 'sandbox-exec' ? [sandbox, normal] : [normal, sandbox]
    }),
  )
}

/** Antigravity 桌面端的本地会话与摘要目录。 */
export function getAntigravityDataDir(): string {
  return join(homedir(), '.gemini', 'antigravity')
}

/** Qwen Code 会话目录。 */
export function getQwenProjectsDir(): string {
  return getQwenProjectsDirCandidates()[0]
}

export function getQwenHomeDirCandidates(): string[] {
  const configured = process.env.QWEN_HOME?.trim()
  return uniquePaths([
    ...(configured ? [resolveUserPath(configured)] : []),
    join(homedir(), '.qwen'),
  ])
}

/** 相对运行时目录必须基于 CLI 的项目路径，不能用桌面进程的 cwd 猜测。 */
export function getQwenProjectsDirCandidates(
  projectRoots: readonly string[] = [],
  requireResolvedProject = false,
): string[] {
  const homes = getQwenHomeDirCandidates()
  const projects = uniquePaths([...projectRoots, ...homes.flatMap(qwenKnownProjects)])
  const runtime = process.env.QWEN_RUNTIME_DIR?.trim()
  let currentRuntime = runtime
  const roots: string[] = []
  const addRuntime = (value: string | undefined, project?: string): void => {
    if (!value) return
    if (value.startsWith('~') || isAbsolute(value)) roots.push(resolveUserPath(value))
    else if (project) roots.push(resolve(project, value))
  }
  addRuntime(runtime)
  for (const home of homes) {
    const globalSetting = readRuntimeOutputDir(join(home, 'settings.json'))
    if (home === homes[0]) currentRuntime ??= globalSetting
    addRuntime(globalSetting)
    for (const project of projects) {
      addRuntime(runtime, project)
      addRuntime(
        readRuntimeOutputDir(join(project, '.qwen', 'settings.json')) ?? globalSetting,
        project,
      )
    }
  }
  if (
    requireResolvedProject &&
    currentRuntime &&
    !currentRuntime.startsWith('~') &&
    !isAbsolute(currentRuntime) &&
    !projects.length
  )
    throw new Error(
      'Qwen 相对运行时目录缺少项目路径，已中止扫描；请将运行时目录配置为绝对路径或保留项目索引',
    )
  return uniquePaths([...roots, ...homes].map((root) => join(root, 'projects')))
}

/** 只读已注册项目和原生目录标记，不遍历用户磁盘或反解有歧义的目录编码。 */
function qwenKnownProjects(home: string): string[] {
  const projects: string[] = []
  try {
    const registry = JSON.parse(readFileSync(join(home, 'projects.json'), 'utf8'))
    if (registry?.projects && typeof registry.projects === 'object')
      projects.push(...Object.keys(registry.projects).filter(isAbsolute))
  } catch {
    /* 索引可选，目录标记或转录也能提供项目路径。 */
  }
  try {
    for (const entry of readdirSync(join(home, 'projects'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const project = readFileSync(
          join(home, 'projects', entry.name, '.project_root'),
          'utf8',
        ).trim()
        if (isAbsolute(project)) projects.push(project)
      } catch {
        /* 老版本不一定保存目录标记。 */
      }
    }
  } catch {
    /* 默认历史目录尚未创建。 */
  }
  return uniquePaths(projects)
}

function readRuntimeOutputDir(file: string): string | undefined {
  try {
    if (statSync(file).size > 2 * 1024 * 1024) throw new Error('Qwen settings.json 过大')
    // Qwen 官方设置支持 BOM 和 JSON 注释；保留字符串里的 URL、斜线和转义。
    const text = readFileSync(file, 'utf8')
      .replace(/^\uFEFF/, '')
      .replace(
        /("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
        (_part, quoted) => quoted ?? ' ',
      )
    const settings = JSON.parse(text)
    const value = settings?.advanced?.runtimeOutputDir
    if (typeof value !== 'string' || !value.trim()) return undefined
    const expanded = value.trim().replace(/\$(?:(\w+)|{([^}]+)})/g, (match, bare, braced) => {
      const key = bare || braced
      return /^(?:SESSION_ID|QWEN_CODE_SESSION_ID)$/i.test(key)
        ? match
        : (process.env[key] ?? match)
    })
    if (/\$(?:\w+|{[^}]+})/.test(expanded)) throw new Error('Qwen 运行时目录包含未解析的环境变量')
    return expanded
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Qwen 运行时设置不可读 (${file}): ${(error as Error).message}`)
  }
}

/** OpenClaw Agent 转录目录。 */
export function getOpenClawAgentsDir(): string {
  return getOpenClawAgentsDirCandidates()[0]
}

export function getOpenClawAgentsDirCandidates(): string[] {
  const configuredHome = process.env.OPENCLAW_HOME?.trim()
  const home = configuredHome ? resolveUserPath(configuredHome) : homedir()
  const configured = process.env.OPENCLAW_STATE_DIR?.trim()
  const profile = process.env.OPENCLAW_PROFILE?.trim()
  const suffix =
    profile && profile.toLowerCase() !== 'default' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)
      ? `-${profile}`
      : ''
  const state = configured
    ? configured.startsWith('~')
      ? resolve(home, configured.replace(/^~[/\\]?/, ''))
      : resolveUserPath(configured)
    : join(home, `.openclaw${suffix}`)
  return uniquePaths(
    [state, join(home, '.openclaw'), join(homedir(), '.openclaw'), join(home, '.clawdbot')].map(
      (root) => join(root, 'agents'),
    ),
  )
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

/** DeepSeek Harness CLI 与桌面端共用的会话目录；支持官方 DSH_HOME 覆盖。 */
export function getDeepSeekHarnessSessionsDir(): string {
  const configured = process.env.DSH_HOME?.trim()
  const root = configured ? resolveUserPath(configured) : join(homedir(), '.dsh')
  return join(root, 'sessions')
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

export function resolveUserPath(value: string, home = homedir()): string {
  const trimmed = value.trim()
  const expanded =
    trimmed === '~'
      ? home
      : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
        ? join(home, trimmed.substring(2))
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

function uniquePaths(paths: string[], windows = isWindows()): string[] {
  const seen = new Set<string>()
  return paths.filter((path) => {
    const key = windows ? path.toLowerCase() : path
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
