/**
 * SQLite 存储服务（better-sqlite3 封装）
 *
 * 负责 ~/.ohmytoken/usage.db 的打开、初始化、schema 版本管理。
 * 整个应用生命周期复用同一个 DB 连接（单例），不重复 open/close。
 *
 * 该文件只关心"数据库连接与 schema"，具体业务 CRUD 由 data-storage.service.ts 完成。
 */
import Database from 'better-sqlite3'
import type { TokenUsageRecord } from '../../shared/models'
import { hasExplicitTimezone, localTimestampFromValue, timestampEpochMs } from '../lib/date-utils'
import { getUsageDbFile } from '../lib/paths'
import { SCANNER_REVISION } from './incremental-scan.constants'
import {
  searchableSessionTitleSql,
  USAGE_SESSION_SEARCH_CONTENT_VIEW,
} from './session-title-search'

/** DB 单例（整个应用生命周期复用同一个连接） */
let db: Database.Database | null = null

/** usage_records 表行类型（snake_case 列名，对应 DB schema） */
export interface UsageRecordRow {
  agent: string
  date: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  total_tokens: number
  reasoning_tokens: number
  cost: number
}

/** 行 → TokenUsageRecord（snake_case 列名 → camelCase 字段名） */
export function rowToRecord(row: UsageRecordRow): TokenUsageRecord {
  return {
    agent: row.agent,
    date: row.date,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    totalTokens: row.total_tokens,
    reasoningTokens: row.reasoning_tokens,
    cost: row.cost,
  }
}

/**
 * 打开/初始化 DB 单例。
 *
 * - 若已打开则直接返回单例连接；
 * - 否则 `new Database(path)`，设置 WAL / foreign_keys，建表建索引，置 user_version。
 *
 * 注意：路径在函数内通过 getUsageDbFile() 求值，不在模块顶层缓存，
 * 以保证与 paths.ts 的懒求值模式一致。
 */
export function openDatabase(): Database.Database {
  if (db) return db

  const dbPath = getUsageDbFile()
  const conn = new Database(dbPath)

  // PRAGMA 设置：WAL 顺序追加写入；NORMAL 保证断电不损坏库（只在 checkpoint 时 fsync）
  conn.pragma('journal_mode = WAL')
  conn.pragma('synchronous = NORMAL')
  conn.pragma('foreign_keys = ON')
  // usage_sessions 当前使用 INSERT OR REPLACE。开启递归触发器后，REPLACE 隐式执行的
  // DELETE 也会触发 FTS5 删除同步，避免旧 rowid 留下失效索引。
  conn.pragma('recursive_triggers = ON')

  // Schema 版本管理：读取当前版本（simple 模式直接返回 number）
  let currentVersion = conn.pragma('user_version', { simple: true }) as number

  // schema v1：初始建表 + 索引
  if (currentVersion < 1) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (
        agent TEXT NOT NULL,
        date TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        PRIMARY KEY (agent, date, model)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(date);
      CREATE INDEX IF NOT EXISTS idx_usage_records_agent ON usage_records(agent);
      CREATE INDEX IF NOT EXISTS idx_usage_records_model ON usage_records(model);
    `)
    conn.pragma('user_version = 1')
    currentVersion = 1
  }

  // schema v2：通知持久化表
  if (currentVersion < 2) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        raw_data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_unread_created
        ON notifications(read, created_at DESC);
    `)
    conn.pragma('user_version = 2')
    currentVersion = 2
  }

  // 预留：未来 schema 3 迁移在此追加 if 分支
  // schema v3：会话级与 API 轮次级 token 明细
  if (
    currentVersion < 3 ||
    !tableExists(conn, 'usage_sessions') ||
    !tableExists(conn, 'usage_api_calls')
  ) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS usage_sessions (
        agent TEXT NOT NULL,
        session_id TEXT NOT NULL,
        title TEXT,
        date TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT '',
        ended_at TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        api_call_count INTEGER DEFAULT 0,
        PRIMARY KEY (agent, session_id, date, model)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_sessions_date ON usage_sessions(date);
      CREATE INDEX IF NOT EXISTS idx_usage_sessions_agent_model ON usage_sessions(agent, model);

      CREATE TABLE IF NOT EXISTS usage_api_calls (
        agent TEXT NOT NULL,
        api_call_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        role TEXT,
        date TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT '',
        hour INTEGER NOT NULL DEFAULT 0,
        model TEXT NOT NULL,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        reasoning_tokens INTEGER DEFAULT 0,
        PRIMARY KEY (agent, api_call_id)
      );
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_agent_session ON usage_api_calls(agent, session_id);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_date_hour ON usage_api_calls(date, hour);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_model ON usage_api_calls(model);
    `)
    conn.pragma('user_version = 3')
    currentVersion = 3
  }

  // schema v4：会话标题与 API 消息角色。旧 v3 库只补列，不重建表。
  if (
    currentVersion < 4 ||
    !columnExists(conn, 'usage_sessions', 'title') ||
    !columnExists(conn, 'usage_api_calls', 'role')
  ) {
    if (tableExists(conn, 'usage_sessions') && !columnExists(conn, 'usage_sessions', 'title')) {
      conn.exec('ALTER TABLE usage_sessions ADD COLUMN title TEXT')
    }
    if (tableExists(conn, 'usage_api_calls') && !columnExists(conn, 'usage_api_calls', 'role')) {
      conn.exec('ALTER TABLE usage_api_calls ADD COLUMN role TEXT')
    }
    conn.pragma('user_version = 4')
    currentVersion = 4
  }

  // schema v5：用户级 root 会话与子 agent 会话归并字段。
  if (
    currentVersion < 5 ||
    !columnExists(conn, 'usage_sessions', 'parent_session_id') ||
    !columnExists(conn, 'usage_sessions', 'root_session_id') ||
    !columnExists(conn, 'usage_sessions', 'sub_agent_name') ||
    !usageSessionsPrimaryKeyIncludesDate(conn) ||
    !columnExists(conn, 'usage_api_calls', 'parent_session_id') ||
    !columnExists(conn, 'usage_api_calls', 'root_session_id') ||
    !columnExists(conn, 'usage_api_calls', 'sub_agent_name')
  ) {
    if (tableExists(conn, 'usage_sessions')) {
      if (!columnExists(conn, 'usage_sessions', 'parent_session_id')) {
        conn.exec('ALTER TABLE usage_sessions ADD COLUMN parent_session_id TEXT')
      }
      if (!columnExists(conn, 'usage_sessions', 'root_session_id')) {
        conn.exec('ALTER TABLE usage_sessions ADD COLUMN root_session_id TEXT')
      }
      if (!columnExists(conn, 'usage_sessions', 'sub_agent_name')) {
        conn.exec('ALTER TABLE usage_sessions ADD COLUMN sub_agent_name TEXT')
      }
      if (!usageSessionsPrimaryKeyIncludesDate(conn)) {
        rebuildUsageSessionsWithDatePrimaryKey(conn)
      }
      conn.exec(`
        UPDATE usage_sessions
        SET root_session_id = session_id
        WHERE root_session_id IS NULL OR root_session_id = ''
      `)
      conn.exec(`
        CREATE INDEX IF NOT EXISTS idx_usage_sessions_agent_root
          ON usage_sessions(agent, root_session_id);
        CREATE INDEX IF NOT EXISTS idx_usage_sessions_agent_parent
          ON usage_sessions(agent, parent_session_id);
        CREATE INDEX IF NOT EXISTS idx_usage_sessions_date_model
          ON usage_sessions(date, model);
      `)
    }
    if (tableExists(conn, 'usage_api_calls')) {
      if (!columnExists(conn, 'usage_api_calls', 'parent_session_id')) {
        conn.exec('ALTER TABLE usage_api_calls ADD COLUMN parent_session_id TEXT')
      }
      if (!columnExists(conn, 'usage_api_calls', 'root_session_id')) {
        conn.exec('ALTER TABLE usage_api_calls ADD COLUMN root_session_id TEXT')
      }
      if (!columnExists(conn, 'usage_api_calls', 'sub_agent_name')) {
        conn.exec('ALTER TABLE usage_api_calls ADD COLUMN sub_agent_name TEXT')
      }
      conn.exec(`
        UPDATE usage_api_calls
        SET root_session_id = session_id
        WHERE root_session_id IS NULL OR root_session_id = ''
      `)
      conn.exec(`
        CREATE INDEX IF NOT EXISTS idx_usage_api_calls_agent_root_time
          ON usage_api_calls(agent, root_session_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_usage_api_calls_date_model
          ON usage_api_calls(date, model);
      `)
    }
    conn.pragma('user_version = 5')
    currentVersion = 5
  }

  // schema v6：分页查询索引，避免大数据量明细列表全表排序。
  if (
    currentVersion < 6 ||
    !indexExists(conn, 'idx_usage_api_calls_time') ||
    !indexExists(conn, 'idx_usage_api_calls_agent_time') ||
    !indexExists(conn, 'idx_usage_api_calls_model_time') ||
    !indexExists(conn, 'idx_usage_sessions_root_recent')
  ) {
    conn.exec(`
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_time
        ON usage_api_calls(timestamp DESC, api_call_id DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_agent_time
        ON usage_api_calls(agent, timestamp DESC, api_call_id DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_model_time
        ON usage_api_calls(model, timestamp DESC, api_call_id DESC);
      CREATE INDEX IF NOT EXISTS idx_usage_sessions_root_recent
        ON usage_sessions(agent, root_session_id, ended_at DESC, started_at DESC);
    `)
    conn.pragma('user_version = 6')
    currentVersion = 6
  }

  // schema v7：API 原始时间单独保留，现有时间列统一为采集时的系统本地时间。
  if (currentVersion < 7 || !columnExists(conn, 'usage_api_calls', 'raw_timestamp')) {
    if (
      tableExists(conn, 'usage_api_calls') &&
      !columnExists(conn, 'usage_api_calls', 'raw_timestamp')
    ) {
      conn.exec("ALTER TABLE usage_api_calls ADD COLUMN raw_timestamp TEXT NOT NULL DEFAULT ''")
    }
    backfillLocalUsageTimestamps(conn)
    conn.pragma('user_version = 7')
    currentVersion = 7
  }

  // schema v8：增量扫描水位、来源状态，以及用于精确窗口对账的 epoch 时间列。
  if (
    currentVersion < 8 ||
    !columnExists(conn, 'usage_api_calls', 'event_timestamp_ms') ||
    !columnExists(conn, 'usage_api_calls', 'source_scope') ||
    !columnExists(conn, 'usage_sessions', 'started_at_ms') ||
    !columnExists(conn, 'usage_sessions', 'ended_at_ms') ||
    !tableExists(conn, 'scan_agent_state') ||
    !tableExists(conn, 'scan_source_state')
  ) {
    if (!columnExists(conn, 'usage_api_calls', 'event_timestamp_ms')) {
      conn.exec(
        'ALTER TABLE usage_api_calls ' + 'ADD COLUMN event_timestamp_ms INTEGER NOT NULL DEFAULT 0',
      )
    }
    if (!columnExists(conn, 'usage_api_calls', 'source_scope')) {
      conn.exec("ALTER TABLE usage_api_calls ADD COLUMN source_scope TEXT NOT NULL DEFAULT ''")
    }
    if (!columnExists(conn, 'usage_sessions', 'started_at_ms')) {
      conn.exec('ALTER TABLE usage_sessions ADD COLUMN started_at_ms INTEGER NOT NULL DEFAULT 0')
    }
    if (!columnExists(conn, 'usage_sessions', 'ended_at_ms')) {
      conn.exec('ALTER TABLE usage_sessions ADD COLUMN ended_at_ms INTEGER NOT NULL DEFAULT 0')
    }
    conn.exec(`
      CREATE TABLE IF NOT EXISTS scan_agent_state (
        agent TEXT PRIMARY KEY,
        initialized INTEGER NOT NULL DEFAULT 0,
        scanner_revision INTEGER NOT NULL DEFAULT 1,
        event_watermark_ms INTEGER NOT NULL DEFAULT 0,
        last_success_ms INTEGER NOT NULL DEFAULT 0,
        last_full_success_ms INTEGER NOT NULL DEFAULT 0,
        last_mode TEXT NOT NULL DEFAULT 'incremental'
      );

      CREATE TABLE IF NOT EXISTS scan_source_state (
        agent TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT '',
        source_scope TEXT NOT NULL DEFAULT '',
        current_path TEXT NOT NULL DEFAULT '',
        source_size INTEGER NOT NULL DEFAULT 0,
        source_mtime_ms INTEGER NOT NULL DEFAULT 0,
        cursor_offset INTEGER NOT NULL DEFAULT 0,
        cursor_json TEXT NOT NULL DEFAULT '{}',
        fingerprint TEXT NOT NULL DEFAULT '',
        event_watermark_ms INTEGER NOT NULL DEFAULT 0,
        last_success_ms INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (agent, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_agent_event
        ON usage_api_calls(agent, event_timestamp_ms, api_call_id);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_agent_scope_event
        ON usage_api_calls(agent, source_scope, event_timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_usage_sessions_agent_end_ms
        ON usage_sessions(agent, ended_at_ms, session_id);
    `)
    backfillIncrementalTimestamps(conn)
    conn.pragma('user_version = 8')
    currentVersion = 8
  }

  if (
    currentVersion < 9 ||
    !tableExists(conn, 'custom_messages') ||
    !tableExists(conn, 'custom_message_receipts')
  ) {
    conn.exec(`
      CREATE TABLE IF NOT EXISTS custom_messages (
        message_uid TEXT PRIMARY KEY,
        message_id INTEGER NOT NULL,
        display_scope TEXT NOT NULL DEFAULT 'both',
        active INTEGER NOT NULL DEFAULT 1,
        received_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        raw_data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_custom_messages_active_scope
        ON custom_messages(active, display_scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_custom_messages_message_id
        ON custom_messages(message_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS custom_message_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        message_uid TEXT NOT NULL,
        event TEXT NOT NULL,
        placement TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(message_uid, event, placement)
      );
      CREATE INDEX IF NOT EXISTS idx_custom_receipts_due
        ON custom_message_receipts(next_attempt_at, id);
    `)
    conn.pragma('user_version = 9')
    currentVersion = 9
  }

  // schema v10：会话搜索 FTS5 索引。
  // usage_sessions 仍是唯一数据源；虚拟表只保存可删除、可重建的搜索索引，
  // 不修改现有字段、主键，也不会接触任何 Agent 的原始数据库。
  if (currentVersion < 10) {
    ensureUsageSessionSearchSchema(conn)
    conn.pragma('user_version = 10')
    currentVersion = 10
  }

  // schema v11：项目目录管理，以及会话/API 调用的真实工作目录。
  if (
    currentVersion < 11 ||
    !columnExists(conn, 'usage_sessions', 'project_path') ||
    !columnExists(conn, 'usage_api_calls', 'project_path') ||
    !tableExists(conn, 'tracked_projects')
  ) {
    if (!columnExists(conn, 'usage_sessions', 'project_path')) {
      conn.exec('ALTER TABLE usage_sessions ADD COLUMN project_path TEXT')
    }
    if (!columnExists(conn, 'usage_api_calls', 'project_path')) {
      conn.exec('ALTER TABLE usage_api_calls ADD COLUMN project_path TEXT')
    }
    conn.exec(`
      CREATE TABLE IF NOT EXISTS tracked_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        normalized_path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_sessions_project_date
        ON usage_sessions(project_path, date);
      CREATE INDEX IF NOT EXISTS idx_usage_api_calls_project_date
        ON usage_api_calls(project_path, date);
      CREATE INDEX IF NOT EXISTS idx_tracked_projects_created
        ON tracked_projects(created_at, id);
    `)
    conn.pragma('user_version = 11')
    currentVersion = 11
  }

  // schema v12：搜索索引只接收可靠标题，避免完整对话误作标题后污染召回和排序。
  // 原始 title 保持不变；过滤仅发生在可重建的 FTS5 索引视图中。
  if (currentVersion < 12 || !usageSessionSearchSchemaReady(conn)) {
    ensureUsageSessionSearchSchema(conn)
    conn.pragma('user_version = 12')
    currentVersion = 12
  }

  // 早期 v8 构建可能已经建好表但尚未写 Agent 状态；幂等补种避免首刷全量。
  seedAgentScanStatesFromUsage(conn)

  db = conn
  return conn
}

function tableExists(conn: Database.Database, tableName: string): boolean {
  const row = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(tableName) as { name?: string } | undefined
  return row?.name === tableName
}

function indexExists(conn: Database.Database, indexName: string): boolean {
  const row = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(indexName) as { name?: string } | undefined
  return row?.name === indexName
}

function triggerExists(conn: Database.Database, triggerName: string): boolean {
  const row = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name = ?")
    .get(triggerName) as { name?: string } | undefined
  return row?.name === triggerName
}

const USAGE_SESSION_SEARCH_COLUMNS = [
  'title',
  'model',
  'agent',
  'sub_agent_name',
  'session_id',
  'root_session_id',
] as const

const USAGE_SESSION_SEARCH_TRIGGERS = [
  'usage_sessions_fts_ai',
  'usage_sessions_fts_ad',
  'usage_sessions_fts_au',
] as const

function usageSessionSearchSchemaReady(conn: Database.Database): boolean {
  if (!tableExists(conn, 'usage_sessions_fts')) return false
  const tableDefinition = conn
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .get('usage_sessions_fts') as { sql?: string } | undefined
  const contentView = conn
    .prepare("SELECT name FROM sqlite_master WHERE type='view' AND name = ?")
    .get(USAGE_SESSION_SEARCH_CONTENT_VIEW) as { name?: string } | undefined
  const columns = conn.prepare('PRAGMA table_info(usage_sessions_fts)').all() as {
    name?: string
  }[]
  const expectedColumns = USAGE_SESSION_SEARCH_COLUMNS.join('\u0000')
  const actualColumns = columns.map((row) => row.name).join('\u0000')
  return (
    actualColumns === expectedColumns &&
    tableDefinition?.sql?.includes(`content='${USAGE_SESSION_SEARCH_CONTENT_VIEW}'`) === true &&
    contentView?.name === USAGE_SESSION_SEARCH_CONTENT_VIEW &&
    USAGE_SESSION_SEARCH_TRIGGERS.every((triggerName) => triggerExists(conn, triggerName))
  )
}

/**
 * 创建并回填会话 FTS5 搜索索引。
 *
 * 外部内容模式通过 usage_sessions.rowid 关联原表，搜索字段使用 trigram 分词，
 * 适合模型名和中英文标题的任意位置匹配。短于 3 个字符的查询由上层回退 LIKE。
 */
function ensureUsageSessionSearchSchema(conn: Database.Database): void {
  if (usageSessionSearchSchemaReady(conn)) return

  const searchableTitle = searchableSessionTitleSql('title')
  const searchableNewTitle = searchableSessionTitleSql('new.title')
  const searchableOldTitle = searchableSessionTitleSql('old.title')
  const migrate = conn.transaction(() => {
    for (const triggerName of USAGE_SESSION_SEARCH_TRIGGERS) {
      conn.exec(`DROP TRIGGER IF EXISTS ${triggerName}`)
    }
    conn.exec('DROP TABLE IF EXISTS usage_sessions_fts')
    conn.exec(`DROP VIEW IF EXISTS ${USAGE_SESSION_SEARCH_CONTENT_VIEW}`)

    conn.exec(`
      CREATE VIEW ${USAGE_SESSION_SEARCH_CONTENT_VIEW} AS
      SELECT
        rowid,
        ${searchableTitle} AS title,
        model,
        agent,
        COALESCE(sub_agent_name, '') AS sub_agent_name,
        session_id,
        COALESCE(NULLIF(root_session_id, ''), session_id) AS root_session_id
      FROM usage_sessions;

      CREATE VIRTUAL TABLE usage_sessions_fts USING fts5(
        title,
        model,
        agent,
        sub_agent_name,
        session_id,
        root_session_id,
        content='${USAGE_SESSION_SEARCH_CONTENT_VIEW}',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS usage_sessions_fts_ai
      AFTER INSERT ON usage_sessions BEGIN
        INSERT INTO usage_sessions_fts(
          rowid, title, model, agent, sub_agent_name, session_id, root_session_id
        ) VALUES (
          new.rowid,
          ${searchableNewTitle},
          new.model,
          new.agent,
          COALESCE(new.sub_agent_name, ''),
          new.session_id,
          COALESCE(NULLIF(new.root_session_id, ''), new.session_id)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS usage_sessions_fts_ad
      AFTER DELETE ON usage_sessions BEGIN
        INSERT INTO usage_sessions_fts(
          usage_sessions_fts,
          rowid,
          title,
          model,
          agent,
          sub_agent_name,
          session_id,
          root_session_id
        ) VALUES (
          'delete',
          old.rowid,
          ${searchableOldTitle},
          old.model,
          old.agent,
          COALESCE(old.sub_agent_name, ''),
          old.session_id,
          COALESCE(NULLIF(old.root_session_id, ''), old.session_id)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS usage_sessions_fts_au
      AFTER UPDATE ON usage_sessions BEGIN
        INSERT INTO usage_sessions_fts(
          usage_sessions_fts,
          rowid,
          title,
          model,
          agent,
          sub_agent_name,
          session_id,
          root_session_id
        ) VALUES (
          'delete',
          old.rowid,
          ${searchableOldTitle},
          old.model,
          old.agent,
          COALESCE(old.sub_agent_name, ''),
          old.session_id,
          COALESCE(NULLIF(old.root_session_id, ''), old.session_id)
        );
        INSERT INTO usage_sessions_fts(
          rowid, title, model, agent, sub_agent_name, session_id, root_session_id
        ) VALUES (
          new.rowid,
          ${searchableNewTitle},
          new.model,
          new.agent,
          COALESCE(new.sub_agent_name, ''),
          new.session_id,
          COALESCE(NULLIF(new.root_session_id, ''), new.session_id)
        );
      END;

      INSERT INTO usage_sessions_fts(usage_sessions_fts) VALUES ('rebuild');
    `)
  })
  migrate()
}

function columnExists(conn: Database.Database, tableName: string, columnName: string): boolean {
  if (!tableExists(conn, tableName)) return false
  const rows = conn.prepare(`PRAGMA table_info(${tableName})`).all() as { name?: string }[]
  return rows.some((row) => row.name === columnName)
}

function usageSessionsPrimaryKeyIncludesDate(conn: Database.Database): boolean {
  if (!tableExists(conn, 'usage_sessions')) return false
  const rows = conn.prepare('PRAGMA table_info(usage_sessions)').all() as {
    name?: string
    pk?: number
  }[]
  const pkColumns = rows
    .filter((row) => typeof row.pk === 'number' && row.pk > 0)
    .sort((a, b) => (a.pk ?? 0) - (b.pk ?? 0))
    .map((row) => row.name)
  return pkColumns.join('\u0000') === ['agent', 'session_id', 'date', 'model'].join('\u0000')
}

function rebuildUsageSessionsWithDatePrimaryKey(conn: Database.Database): void {
  conn.exec(`
    CREATE TABLE usage_sessions_v5_rebuild (
      agent TEXT NOT NULL,
      session_id TEXT NOT NULL,
      parent_session_id TEXT,
      root_session_id TEXT,
      sub_agent_name TEXT,
      title TEXT,
      date TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT '',
      ended_at TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      api_call_count INTEGER DEFAULT 0,
      PRIMARY KEY (agent, session_id, date, model)
    );
    INSERT OR REPLACE INTO usage_sessions_v5_rebuild
      (agent, session_id, parent_session_id, root_session_id, sub_agent_name, title, date,
       started_at, ended_at, model, input_tokens, output_tokens, cache_read_tokens,
       cache_write_tokens, total_tokens, reasoning_tokens, api_call_count)
    SELECT
      agent, session_id, parent_session_id, root_session_id, sub_agent_name, title, date,
      started_at, ended_at, model, input_tokens, output_tokens, cache_read_tokens,
      cache_write_tokens, total_tokens, reasoning_tokens, api_call_count
    FROM usage_sessions;
    DROP TABLE usage_sessions;
    ALTER TABLE usage_sessions_v5_rebuild RENAME TO usage_sessions;
  `)
}

function backfillLocalUsageTimestamps(conn: Database.Database): void {
  const migrate = conn.transaction(() => {
    if (tableExists(conn, 'usage_api_calls')) {
      const apiRows = conn
        .prepare('SELECT rowid, raw_timestamp, timestamp, date, hour FROM usage_api_calls')
        .all() as Array<{
        rowid: number
        raw_timestamp: string
        timestamp: string
        date: string
        hour: number
      }>
      const updateApi = conn.prepare(
        'UPDATE usage_api_calls ' +
          'SET raw_timestamp = ?, timestamp = ?, date = ?, hour = ? ' +
          'WHERE rowid = ?',
      )
      for (const row of apiRows) {
        const timestamp = localTimestampFromValue(row.timestamp, row.date)
        const rawTimestamp =
          row.raw_timestamp || (hasExplicitTimezone(row.timestamp) ? row.timestamp : '')
        const parts = localTimestampParts(timestamp, row.date, row.hour)
        updateApi.run(rawTimestamp, timestamp, parts.date, parts.hour, row.rowid)
      }
    }

    if (tableExists(conn, 'usage_sessions')) {
      const sessionRows = conn
        .prepare('SELECT rowid, started_at, ended_at, date FROM usage_sessions')
        .all() as Array<{
        rowid: number
        started_at: string
        ended_at: string
        date: string
      }>
      const updateSession = conn.prepare(
        'UPDATE usage_sessions SET started_at = ?, ended_at = ? WHERE rowid = ?',
      )
      for (const row of sessionRows) {
        updateSession.run(
          row.started_at ? localTimestampFromValue(row.started_at, row.date) : '',
          row.ended_at ? localTimestampFromValue(row.ended_at, row.date) : '',
          row.rowid,
        )
      }
    }
  })
  migrate()
}

function backfillIncrementalTimestamps(conn: Database.Database): void {
  const batchSize = 1000
  const migrate = conn.transaction(() => {
    const readApiBatch = conn.prepare(
      `SELECT rowid, raw_timestamp, timestamp, session_id, root_session_id
       FROM usage_api_calls
       WHERE rowid > ?
       ORDER BY rowid
       LIMIT ?`,
    )
    const updateApi = conn.prepare(
      'UPDATE usage_api_calls SET event_timestamp_ms = ?, source_scope = ? WHERE rowid = ?',
    )
    let apiCursor = 0
    while (true) {
      const apiRows = readApiBatch.all(apiCursor, batchSize) as Array<{
        rowid: number
        raw_timestamp: string
        timestamp: string
        session_id: string
        root_session_id: string | null
      }>
      if (apiRows.length === 0) break
      for (const row of apiRows) {
        const eventMs = timestampEpochMs(row.raw_timestamp) || timestampEpochMs(row.timestamp)
        updateApi.run(eventMs, row.root_session_id || row.session_id, row.rowid)
      }
      apiCursor = apiRows[apiRows.length - 1].rowid
    }

    const readSessionBatch = conn.prepare(
      `SELECT rowid, started_at, ended_at
       FROM usage_sessions
       WHERE rowid > ?
       ORDER BY rowid
       LIMIT ?`,
    )
    const updateSession = conn.prepare(
      'UPDATE usage_sessions SET started_at_ms = ?, ended_at_ms = ? WHERE rowid = ?',
    )
    let sessionCursor = 0
    while (true) {
      const sessionRows = readSessionBatch.all(sessionCursor, batchSize) as Array<{
        rowid: number
        started_at: string
        ended_at: string
      }>
      if (sessionRows.length === 0) break
      for (const row of sessionRows) {
        updateSession.run(
          timestampEpochMs(row.started_at),
          timestampEpochMs(row.ended_at),
          row.rowid,
        )
      }
      sessionCursor = sessionRows[sessionRows.length - 1].rowid
    }
  })
  migrate()
}

/**
 * v7 以前的完整历史 API 表本身就是有效全量基线。迁移时按 Agent 的最大事件时间
 * 建立游标，避免升级后第一次实时刷新重新扫描全部历史。没有可解析事件时间的 Agent
 * 不会生成状态，仍会由运行时执行一次全量基线。
 */
function seedAgentScanStatesFromUsage(conn: Database.Database): void {
  const migratedAtMs = Date.now()
  conn
    .prepare(
      `INSERT INTO scan_agent_state
      (agent, initialized, scanner_revision, event_watermark_ms, last_success_ms,
       last_full_success_ms, last_mode)
     SELECT agent, 1, ?, MAX(event_timestamp_ms), ?, ?, 'full'
     FROM usage_api_calls
     WHERE event_timestamp_ms > 0
     GROUP BY agent
     ON CONFLICT(agent) DO NOTHING`,
    )
    .run(SCANNER_REVISION, migratedAtMs, migratedAtMs)
}

function localTimestampParts(
  timestamp: string,
  fallbackDate: string,
  fallbackHour: number,
): { date: string; hour: number } {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(timestamp)
  if (!match) return { date: fallbackDate, hour: fallbackHour }
  const hour = Number.parseInt(match[2], 10)
  return {
    date: match[1],
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : fallbackHour,
  }
}

/** 关闭 DB（可选，预留应用退出时的清理；未打开则 no-op） */
export function closeDatabase(): void {
  if (db) {
    try {
      db.close()
    } catch (e) {
      console.warn(`[sqlite-storage] 关闭数据库失败: ${(e as Error).message}`)
    }
    db = null
  }
}

/** DB 是否已就绪（单例已打开） */
export function isDatabaseReady(): boolean {
  return db !== null
}
