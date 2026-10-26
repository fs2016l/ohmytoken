import { existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import Database from 'better-sqlite3'

/**
 * 侧边栏标题保存在 daimon 的逻辑会话索引，不在内核 state.json 中。
 * 旧版使用 sessions.v2.json；新版 SQLite 优先，不能把标题生成辅助会话计入用量。
 */
export function readKimiWorkSessionTitles(sessionsDir: string): Map<string, string> {
  const titles = new Map<string, string>()
  const agentsDir = resolve(sessionsDir, '../../../..', 'agents')
  if (!existsSync(agentsDir)) return titles
  for (const agent of readdirSync(agentsDir, { withFileTypes: true })) {
    if (!agent.isDirectory()) continue
    const logicalDir = join(agentsDir, agent.name, 'sessions', 'hosted-logical')
    const legacy = readOptionalJson(join(logicalDir, 'sessions.v2.json'))
    if (isObject(legacy) && Array.isArray(legacy.conversations))
      for (const conversation of legacy.conversations)
        if (isObject(conversation))
          setTitle(titles, conversation.conversationKey, conversation.title)

    const dbPath = join(logicalDir, 'conversations.sqlite')
    if (!existsSync(dbPath)) continue
    let db: Database.Database | undefined
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true })
      const rows = db.prepare('SELECT conversation_key, title FROM conversations').all() as {
        conversation_key: unknown
        title: unknown
      }[]
      for (const row of rows) setTitle(titles, row.conversation_key, row.title)
    } catch (error) {
      throw new Error(`Kimi Work 会话标题索引不可读 (${dbPath}): ${(error as Error).message}`)
    } finally {
      db?.close()
    }
  }
  return titles
}

/** 用户手动重命名优先于自动生成标题。 */
export function readKimiWorkTitleOverrides(file: string): Map<string, string> {
  const titles = new Map<string, string>()
  const value = readOptionalJson(file)
  if (isObject(value))
    for (const [sessionId, title] of Object.entries(value)) setTitle(titles, sessionId, title)
  return titles
}

function readOptionalJson(file: string): unknown {
  if (!existsSync(file)) return undefined
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`Kimi Work 会话标题文件不可读 (${file}): ${(error as Error).message}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    // JSON 文件可能正被桌面端改写，暂时沿用其他标题来源。
    return undefined
  }
}

function setTitle(titles: Map<string, string>, sessionId: unknown, title: unknown): void {
  if (
    typeof sessionId === 'string' &&
    sessionId.trim() &&
    typeof title === 'string' &&
    title.trim()
  )
    titles.set(sessionId.trim(), title.trim())
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
