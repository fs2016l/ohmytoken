import { persistAgentScan } from './incremental-scan-storage.service'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { deserialize, serialize } from 'v8'
import type Database from 'better-sqlite3'
import type { ScannerUsageDetails, TokenUsageApiCall } from '../../shared/models'
import type { ScannerScanContext } from '../scanners/types'
import type { ScanSourceStateUpdate } from './scan-source-state.service'
import { getUsageDbFile } from '../lib/paths'
import { openUsageDatabase, withUsageDatabase } from './sqlite-storage.service'
import { prepareScanImport, removeUsageQueryIndexes } from './scan-import-schema'
import { mergeStagedGenerationSamples } from './session-generation-storage'
import { mergeStagedTurnFirstTokens } from './session-turn-timing-storage'

interface StagedAgent {
  agent: string
  context: ScannerScanContext
  records: ScannerUsageDetails['records']
  sessions: ScannerUsageDetails['sessions']
  latestGenerations?: ScannerUsageDetails['latestGenerations']
  latestTurnFirstTokens?: ScannerUsageDetails['latestTurnFirstTokens']
  sourceStates: ScanSourceStateUpdate[]
  chunks: number
}

const COPY_TABLES = [
  'usage_session_projects',
  'usage_session_data',
  'usage_api_calls',
  'usage_cost_cache',
  'usage_sessions',
  'usage_records',
  'scan_agent_state',
  'scan_source_state',
  'usage_evidence_state',
] as const
const MANAGED_TRIGGERS = [
  'usage_cost_api_insert',
  'usage_cost_api_update',
  'usage_cost_api_delete',
  'usage_cost_cache_insert',
  'usage_cost_cache_update',
  'usage_cost_cache_delete',
  'usage_sessions_fts_ai',
  'usage_sessions_fts_ad',
  'usage_sessions_fts_au',
]

/** 原始数据只解析一次，按批暂存后再生成可替换的统计库。 */
export class ScanStaging {
  readonly directory: string
  readonly databasePath: string
  private readonly root: string
  private count = 0
  private database: Database.Database | null = null
  private prepareAggregates: (() => void) | null = null

  constructor() {
    this.root = resolve(dirname(getUsageDbFile()), 'scan-staging')
    mkdirSync(this.root, { recursive: true })
    cleanupAbandonedStaging(this.root)
    this.directory = mkdtempSync(join(this.root, 'run-'))
    writeFileSync(
      join(this.directory, 'owner.json'),
      JSON.stringify({ kind: 'ohmytoken-scan', pid: process.pid }),
      { mode: 0o600 },
    )
    this.databasePath = join(this.directory, 'usage.db')
  }

  store(
    agent: string,
    context: ScannerScanContext,
    details: ScannerUsageDetails,
    sourceStates: ScanSourceStateUpdate[],
  ): number {
    const index = this.count++
    if (context.storage === 'session') {
      const db = openUsageDatabase(this.agentDatabasePath(index))
      try {
        prepareScanImport(db)
        withUsageDatabase(db, () =>
          persistAgentScan(agent, { ...context, preserveHistory: false }, details, sourceStates),
        )
      } finally {
        db.close()
      }
      return index
    }
    const { reportProgress: _progress, ...storedContext } = context
    let chunks = 0
    for (let start = 0; start < details.apiCalls.length; start += 2048) {
      writeFileSync(
        join(this.directory, `${index}-${chunks++}.bin`),
        serialize(details.apiCalls.slice(start, start + 2048)),
        { mode: 0o600 },
      )
    }
    const metadata: StagedAgent = {
      agent,
      context: storedContext,
      records: details.records,
      sessions: details.sessions,
      latestGenerations: details.latestGenerations,
      latestTurnFirstTokens: details.latestTurnFirstTokens,
      sourceStates,
      chunks,
    }
    writeFileSync(join(this.directory, `${index}.bin`), serialize(metadata), { mode: 0o600 })
    return index
  }

  load(index: number): StagedAgent & { details: ScannerUsageDetails } {
    const stored = deserialize(readFileSync(join(this.directory, `${index}.bin`))) as StagedAgent
    const apiCalls: TokenUsageApiCall[] = []
    for (let part = 0; part < stored.chunks; part++) {
      const chunk = deserialize(
        readFileSync(join(this.directory, `${index}-${part}.bin`)),
      ) as TokenUsageApiCall[]
      apiCalls.push(...chunk)
    }
    return {
      ...stored,
      details: {
        records: stored.records,
        sessions: stored.sessions,
        apiCalls,
        ...(stored.latestGenerations ? { latestGenerations: stored.latestGenerations } : {}),
        ...(stored.latestTurnFirstTokens
          ? { latestTurnFirstTokens: stored.latestTurnFirstTokens }
          : {}),
      },
    }
  }

  open(): Database.Database {
    if (!this.database) {
      this.database = openUsageDatabase(this.databasePath)
      this.prepareAggregates = prepareScanImport(this.database)
    }
    return this.database
  }

  prepareCosts(): void {
    this.prepareAggregates?.()
  }

  agentDatabasePath(index: number): string {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('扫描来源序号无效')
    return join(this.directory, `agent-${index}.db`)
  }

  mergeAgent(index: number, agent: string): void {
    const db = this.open()
    db.prepare('ATTACH DATABASE ? AS scan_staging').run(this.agentDatabasePath(index))
    try {
      db.transaction(() => copyStagedTables(db, [agent]))()
    } finally {
      db.exec('DETACH DATABASE scan_staging')
    }
  }

  commit(target: Database.Database, agents: string[]): void {
    this.database?.close()
    this.database = null
    replaceStagedUsage(target, this.databasePath, agents)
  }

  canCommitAgents(target: Database.Database, count: number): boolean {
    // 为连接上其他可能使用的附加库留出位置；更多来源仍走分批归并。
    const attached = (
      target.prepare('PRAGMA database_list').all() as Array<{ name: string }>
    ).filter(({ name }) => name !== 'main' && name !== 'temp').length
    return count <= Math.max(0, 8 - attached)
  }

  commitAgents(target: Database.Database, agents: string[]): void {
    replaceStagedSources(
      target,
      agents.map((agent, index) => ({
        file: this.agentDatabasePath(index),
        agents: [agent],
      })),
    )
  }

  dispose(): void {
    this.database?.close()
    this.database = null
    if (
      dirname(resolve(this.directory)) !== this.root ||
      !basename(this.directory).startsWith('run-')
    ) {
      throw new Error('扫描暂存目录超出允许范围')
    }
    rmSync(this.directory, { recursive: true, force: true })
  }
}

function cleanupAbandonedStaging(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('run-')) continue
    const directory = resolve(root, entry.name)
    if (dirname(directory) !== root) continue
    try {
      const owner = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8')) as {
        kind?: string
        pid?: number
      }
      if (owner.kind !== 'ohmytoken-scan' || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0)
        continue
      try {
        process.kill(owner.pid!, 0)
        continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue
      }
      rmSync(directory, { recursive: true, force: true })
    } catch {
      /* 无法确认归属或仍被占用的目录留待后续清理。 */
    }
  }
}

/** 在同一事务中替换本轮来源，索引与费用一起就绪后才向读取方可见。 */
export function replaceStagedUsage(
  target: Database.Database,
  file: string,
  agents: string[],
): void {
  replaceStagedSources(target, [{ file, agents }])
}

function replaceStagedSources(
  target: Database.Database,
  sources: Array<{ file: string; agents: string[] }>,
): void {
  const agents = sources.flatMap((source) => source.agents)
  if (!agents.length) return
  if (new Set(agents).size !== agents.length) throw new Error('暂存数据包含重复 Agent')
  const placeholders = agents.map(() => '?').join(',')
  const attached: string[] = []
  try {
    for (let index = 0; index < sources.length; index++) {
      const schema = `scan_staging_${index}`
      target.prepare(`ATTACH DATABASE ? AS ${schema}`).run(sources[index].file)
      attached.push(schema)
    }
    target.transaction(() => {
      const triggers = target
        .prepare(
          `SELECT name, sql FROM sqlite_master WHERE type = 'trigger'
        AND name IN (${MANAGED_TRIGGERS.map(() => '?').join(',')})`,
        )
        .all(...MANAGED_TRIGGERS) as Array<{ name: string; sql: string }>
      if (triggers.length !== MANAGED_TRIGGERS.length)
        throw new Error('统计索引不完整，无法替换重建结果')
      for (const trigger of triggers) target.exec(`DROP TRIGGER "${trigger.name}"`)
      const indexes = removeUsageQueryIndexes(target)
      // 子表先清理；未参与本轮重建的来源和应用设置保留。
      for (const table of [
        'usage_cost_cache',
        ...COPY_TABLES.filter((name) => name !== 'usage_cost_cache'),
      ]) {
        target.prepare(`DELETE FROM main.${table} WHERE agent IN (${placeholders})`).run(...agents)
      }
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]
        const schema = attached[index]
        copyStagedTables(target, source.agents, schema)
        const counts = (schema: string) =>
          target
            .prepare(
              `SELECT agent, SUM(api_call_count) AS calls,
        SUM(input_tokens) AS input, SUM(output_tokens) AS output,
        SUM(cache_read_tokens) AS cacheRead, SUM(cache_write_tokens) AS cacheWrite,
        SUM(reasoning_tokens) AS reasoning, SUM(total_tokens) AS total
        FROM ${schema}.usage_sessions WHERE agent IN (${source.agents.map(() => '?').join(',')}) GROUP BY agent ORDER BY agent`,
            )
            .all(...source.agents)
        if (JSON.stringify(counts('main')) !== JSON.stringify(counts(schema))) {
          throw new Error('重建结果校验失败，已保留此前统计')
        }
      }
      for (const sql of indexes) target.exec(sql)
      target.exec("INSERT INTO usage_sessions_fts(usage_sessions_fts) VALUES ('rebuild')")
      for (const trigger of triggers) target.exec(trigger.sql)
    })()
  } finally {
    for (const schema of attached.reverse()) target.exec(`DETACH DATABASE ${schema}`)
  }
}

/** 旧库可能保留已停用的可空列；复制以本轮实际生成的列为准。 */
export function copyStagedTables(
  target: Database.Database,
  agents: string[],
  schema = 'scan_staging',
): void {
  if (!target.inTransaction) throw new Error('暂存数据复制必须在事务中执行')
  if (!/^scan_staging(?:_\d+)?$/.test(schema)) throw new Error('扫描暂存库名称无效')
  const placeholders = agents.map(() => '?').join(',')
  for (const table of COPY_TABLES) {
    const columns = target.prepare(`PRAGMA ${schema}.table_info(${table})`).all() as Array<{
      name: string
    }>
    const destination = target.prepare(`PRAGMA main.table_info(${table})`).all() as Array<{
      name: string
      notnull: number
      dflt_value: string | null
    }>
    const sourceNames = new Set(columns.map(({ name }) => name))
    const targetNames = new Set(destination.map(({ name }) => name))
    if (
      !columns.length ||
      columns.some(({ name }) => !targetNames.has(name)) ||
      destination.some(
        (column) => !sourceNames.has(column.name) && column.notnull && column.dflt_value === null,
      )
    ) {
      throw new Error(`统计表 ${table} 的结构不兼容，已保留此前统计`)
    }
    const names = columns.map(({ name }) => `"${name.replaceAll('"', '""')}"`).join(',')
    target
      .prepare(
        `INSERT INTO main.${table} (${names}) SELECT ${names} FROM ${schema}.${table}
       WHERE agent IN (${placeholders})`,
      )
      .run(...agents)
  }
  mergeStagedGenerationSamples(target, agents, schema)
  mergeStagedTurnFirstTokens(target, agents, schema)
}
