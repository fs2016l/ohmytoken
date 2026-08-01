/**
 * 数据持久化服务（SQLite 实现，替代原 JSON 文件存储）
 *
 * 负责 ~/.ohmytoken/usage.db 中 usage_records 表的 CRUD：
 * - loadRecords: 全量加载
 * - saveRecords: 批量 INSERT OR REPLACE（PRIMARY KEY = agent+date+model 天然去重，
 *   不再做 loadRecords 全量读取再合并，相比原 JSON 实现是一次性能改进）
 * - getAllRecords / getRecordsByDateRange / getRecordsByAgent: 维度查询
 * - initDataStorage: 初始化 DB
 *
 * 所有方法同步阻塞（better-sqlite3 本身即同步 API），用模块级 `saving` 标志防止并发写入。
 *
 * 数据库连接由 sqlite-storage.service.ts 单例管理，本文件只做业务 CRUD。
 */
import { mkdirSync } from 'fs'
import type { TokenUsageRecord } from '../../shared/models'
import { getAppDataDir } from '../lib/paths'
import {
  isDatabaseReady,
  openDatabase,
  rowToRecord,
  type UsageRecordRow,
} from './sqlite-storage.service'

/** 并发写入保护（保留原 JSON 实现的语义：避免 saveRecords 重入） */
let saving = false

/**
 * 全量加载记录（对应原 loadRecords）。
 * DB 未就绪时返回空数组（理论上 initDataStorage 后一定就绪，此处防御）。
 */
export function loadRecords(): TokenUsageRecord[] {
  if (!isDatabaseReady()) return []
  const db = openDatabase()
  const rows = db.prepare('SELECT * FROM usage_records').all() as UsageRecordRow[]
  return rows.map(rowToRecord)
}

/**
 * 保存记录（对应原 saveRecords）。
 * 去重 key = (agent, date, model)：由 PRIMARY KEY + INSERT OR REPLACE 天然保证，
 * 无需像旧 JSON 实现那样先 loadRecords 全量读取再合并。
 *
 * 并发保护：saving 标志位避免重入（与原逻辑一致）。
 * 空数组直接 return。
 */
export function saveRecords(newRecords: TokenUsageRecord[]): void {
  if (newRecords.length === 0) return
  if (saving) {
    console.warn('[data-storage] 已有写入在进行中，跳过本次保存')
    return
  }
  saving = true
  try {
    const db = openDatabase()
    const insertMany = db.transaction((records: TokenUsageRecord[]) => insertRecords(records))
    insertMany(newRecords)
  } finally {
    saving = false
  }
}

export function replaceRecordsForAgents(agents: string[], newRecords: TokenUsageRecord[]): void {
  const uniqueAgents = [...new Set(agents)].filter(Boolean)
  if (uniqueAgents.length === 0) return
  if (saving) {
    console.warn('[data-storage] 已有写入在进行中，跳过本次替换')
    return
  }
  saving = true
  try {
    const db = openDatabase()
    const replaceMany = db.transaction((agentNames: string[], records: TokenUsageRecord[]) => {
      const placeholders = agentNames.map(() => '?').join(', ')
      db.prepare(`DELETE FROM usage_records WHERE agent IN (${placeholders})`).run(...agentNames)
      insertRecords(records.filter((record) => agentNames.includes(record.agent)))
    })
    replaceMany(uniqueAgents, newRecords)
  } finally {
    saving = false
  }
}

export function insertRecords(records: TokenUsageRecord[]): void {
  if (records.length === 0) return
  const db = openDatabase()
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO usage_records
      (agent, date, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, total_tokens, reasoning_tokens, cost)
    VALUES
      (@agent, @date, @model, @input_tokens, @output_tokens, @cache_read_tokens,
       @cache_write_tokens, @total_tokens, @reasoning_tokens, @cost)
  `)
  for (const r of records) {
    stmt.run({
      agent: r.agent,
      date: r.date,
      model: r.model,
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cache_read_tokens: r.cacheReadTokens,
      cache_write_tokens: r.cacheWriteTokens,
      total_tokens: r.totalTokens,
      reasoning_tokens: r.reasoningTokens,
      cost: r.cost,
    })
  }
}

/** 全量记录（对应原 getAllRecords） */
export function getAllRecords(): TokenUsageRecord[] {
  return loadRecords()
}

/**
 * 日期范围过滤（对应原 getRecordsByDateRange）。
 * SQL BETWEEN 含两端，等价于原 `r.date >= from && r.date <= to`（字符串字典序）。
 */
export function getRecordsByDateRange(from: string, to: string): TokenUsageRecord[] {
  if (!isDatabaseReady()) return []
  const db = openDatabase()
  const rows = db
    .prepare('SELECT * FROM usage_records WHERE date BETWEEN ? AND ?')
    .all(from, to) as UsageRecordRow[]
  return rows.map(rowToRecord)
}

/** 按 agent 过滤（对应原 getRecordsByAgent） */
export function getRecordsByAgent(agent: string): TokenUsageRecord[] {
  if (!isDatabaseReady()) return []
  const db = openDatabase()
  const rows = db
    .prepare('SELECT * FROM usage_records WHERE agent = ?')
    .all(agent) as UsageRecordRow[]
  return rows.map(rowToRecord)
}

/**
 * 初始化（对应原 initDataStorage，由 index.ts 在 app ready 后调用）。
 *
 * 确保数据目录 ~/.ohmytoken/ 存在后，打开/创建并初始化 SQLite 数据库。
 */
export function initDataStorage(): void {
  try {
    mkdirSync(getAppDataDir(), { recursive: true })
  } catch (e) {
    console.error(`[data-storage] 初始化数据目录失败: ${(e as Error).message}`)
    return
  }

  try {
    openDatabase()
    console.log('[data-storage] SQLite 初始化成功')
  } catch (e) {
    console.error('[data-storage] SQLite 初始化失败:', (e as Error).message)
  }
}
