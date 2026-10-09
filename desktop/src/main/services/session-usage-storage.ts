import type Database from 'better-sqlite3'
import type { TokenUsageSession } from '../../shared/models'
import type { UsageCostRollup } from '../../shared/usage-cost'
import { combineCostRollups } from '../../shared/cost-rollup'
import { PRICE_CATALOG_VERSION } from '../cost/price-catalog'
import { insertSessionRows } from './usage-detail-storage.service'
import { withUsageDatabase } from './sqlite-storage.service'
import {
  aggregateSessionUsage,
  decodeMeterData,
  type SessionDataRow,
  type SessionUsageAggregate,
} from './session-usage-codec'

export function storeSessionUsage(db: Database.Database, value: SessionUsageAggregate): void {
  withUsageDatabase(db, () => insertSessionRows([value.session]))
  const { agent, session_id, date, model } = value.data
  writeSessionProjectUsage(db, value)
  db.prepare(
    `INSERT OR REPLACE INTO usage_session_data
    (agent, session_id, date, model, first_ms, last_ms, meter_data, second_data, turn_data)
    VALUES (@agent, @session_id, @date, @model, @first_ms, @last_ms, @meter_data, @second_data, @turn_data)`,
  ).run(value.data)
  db.prepare(
    `UPDATE usage_sessions SET cost_revision = ?, cost_summary = ?, api_count_complete = ?
    WHERE agent = ? AND session_id = ? AND date = ? AND model = ?`,
  ).run(
    PRICE_CATALOG_VERSION,
    JSON.stringify(value.costs),
    value.session.apiCallCountComplete === false ? 0 : 1,
    agent,
    session_id,
    date,
    model,
  )
}

/** Project metadata is derived from requests, including sessions that cross directories. */
export function writeSessionProjectUsage(
  db: Database.Database,
  value: SessionUsageAggregate,
): void {
  const { agent, session_id, date, model } = value.data
  db.prepare(
    'DELETE FROM usage_session_projects WHERE agent = ? AND session_id = ? AND date = ? AND model = ?',
  ).run(agent, session_id, date, model)
  const writeProject = db.prepare(`INSERT INTO usage_session_projects
    (agent,session_id,date,model,project_path,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,total_tokens,
      api_call_count,api_count_complete,cost_revision,cost_summary,first_ms,last_ms,turn_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (const project of value.projects)
    writeProject.run(
      agent,
      session_id,
      date,
      model,
      project.projectPath,
      ...project.tokens,
      project.apiCallCount,
      project.apiCallCountComplete ? 1 : 0,
      PRICE_CATALOG_VERSION,
      JSON.stringify(project.costs),
      project.firstMs,
      project.lastMs,
      project.turnData,
    )
}

export function removeSessionUsage(db: Database.Database, agent: string, parts: string[]): void {
  for (const table of ['usage_sessions', 'usage_session_data', 'usage_session_projects'])
    db.prepare(
      `DELETE FROM ${table} WHERE agent = ? AND session_id = ? AND date = ? AND model = ?`,
    ).run(agent, ...parts)
}

export function readSessionMetadata(
  db: Database.Database,
  agent: string,
): Map<string, TokenUsageSession> {
  const rows = db.prepare('SELECT * FROM usage_sessions WHERE agent = ?').all(agent) as Array<
    Record<string, string>
  >
  return new Map(
    rows.map((row) => [
      JSON.stringify([row.session_id, row.date, row.model]),
      {
        agent,
        sessionId: row.session_id,
        date: row.date,
        model: row.model,
        title: row.title || undefined,
        parentSessionId: row.parent_session_id || undefined,
        rootSessionId: row.root_session_id || undefined,
        subAgentName: row.sub_agent_name || undefined,
        projectPath: row.project_path || undefined,
      } as TokenUsageSession,
    ]),
  )
}

/** 日汇总直接相加已完成的会话与费用，不再重复读取计量记录。 */
export function rebuildSessionDays(db: Database.Database, agent: string): void {
  const rows = db
    .prepare(
      `SELECT date, model, SUM(input_tokens) input_tokens,
    SUM(output_tokens) output_tokens, SUM(cache_read_tokens) cache_read_tokens,
    SUM(cache_write_tokens) cache_write_tokens, SUM(reasoning_tokens) reasoning_tokens,
    SUM(total_tokens) total_tokens FROM usage_sessions WHERE agent = ? GROUP BY date, model`,
    )
    .all(agent)
  const costs = db
    .prepare('SELECT date, model, cost_summary FROM usage_sessions WHERE agent = ?')
    .all(agent) as Array<{ date: string; model: string; cost_summary: string }>
  const groups = new Map<string, UsageCostRollup[]>()
  for (const row of costs) {
    const key = JSON.stringify([row.date, row.model])
    const group = groups.get(key) ?? []
    if (!row.cost_summary) throw new Error('会话费用尚未就绪')
    group.push(JSON.parse(row.cost_summary) as UsageCostRollup)
    groups.set(key, group)
  }
  db.prepare('DELETE FROM usage_records WHERE agent = ?').run(agent)
  const write = db.prepare(`INSERT INTO usage_records
    (agent, date, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
      reasoning_tokens, total_tokens, cost, cost_revision, cost_summary)
    VALUES (@agent, @date, @model, @input_tokens, @output_tokens, @cache_read_tokens,
      @cache_write_tokens, @reasoning_tokens, @total_tokens, 0, @revision, @summary)`)
  for (const row of rows as Array<Record<string, string | number>>) {
    const summary = combineCostRollups(
      groups.get(JSON.stringify([row.date, row.model])) ?? [],
      PRICE_CATALOG_VERSION,
    )
    if (summary.totalTokens !== row.total_tokens) throw new Error('会话费用与 Token 汇总不一致')
    write.run({ ...row, agent, revision: PRICE_CATALOG_VERSION, summary: JSON.stringify(summary) })
  }
}

export async function refreshSessionCosts(db: Database.Database): Promise<void> {
  const agents = db
    .prepare(
      `SELECT DISTINCT d.agent FROM usage_session_data d WHERE d.agent IN (
    SELECT agent FROM usage_sessions WHERE cost_revision IS NULL OR cost_revision != ? OR cost_summary IS NULL
    UNION SELECT agent FROM usage_records WHERE cost_revision IS NULL OR cost_revision != ? OR cost_summary IS NULL
  )`,
    )
    .all(PRICE_CATALOG_VERSION, PRICE_CATALOG_VERSION) as Array<{ agent: string }>
  for (const { agent } of agents) {
    db.transaction(() => {
      const rows = db
        .prepare(
          `SELECT d.* FROM usage_session_data d JOIN usage_sessions s USING (agent, session_id, date, model)
        WHERE d.agent = ? AND (s.cost_revision IS NULL OR s.cost_revision != ? OR s.cost_summary IS NULL)`,
        )
        .all(agent, PRICE_CATALOG_VERSION) as SessionDataRow[]
      const write = db.prepare(`UPDATE usage_sessions SET cost_revision = ?, cost_summary = ?
        WHERE agent = ? AND session_id = ? AND date = ? AND model = ?`)
      for (const row of rows) {
        const costs = aggregateSessionUsage(decodeMeterData(row)).costs
        write.run(
          PRICE_CATALOG_VERSION,
          JSON.stringify(costs),
          row.agent,
          row.session_id,
          row.date,
          row.model,
        )
      }
      rebuildSessionDays(db, agent)
    })()
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}
