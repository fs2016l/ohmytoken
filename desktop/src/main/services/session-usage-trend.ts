import type Database from 'better-sqlite3'
import type { UsageTrendStats } from '../../shared/models'
import { decodeSecondData, type SecondUsage } from './session-usage-codec'
import { canonicalModelName } from '../cost/price-catalog'

export function readUsageSeconds(
  db: Database.Database,
  from: number,
  to: number,
  groupBy: 'agent' | 'model',
): UsageTrendStats {
  const rangeFrom = Math.floor(Math.min(from, to) / 1000) * 1000
  const rangeTo = Math.floor(Math.max(from, to) / 1000) * 1000
  const result: UsageTrendStats = {
    from: rangeFrom,
    to: rangeTo,
    groupBy,
    bucketMinutes: 1 / 60,
    bucketSeconds: 1,
    points: [],
    dimensionTotals: {},
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  }
  const points = new Map<number, UsageTrendStats['points'][number]>()
  const add = (dimension: string, row: SecondUsage): void => {
    if (groupBy === 'model') dimension = canonicalModelName(dimension)
    const at = row[0]
    if (at <= 0 || at < rangeFrom || at > rangeTo) return
    const point = points.get(at) ?? { timestamp: at, dimensionTokens: {}, totalTokens: 0 }
    point.dimensionTokens[dimension] = (point.dimensionTokens[dimension] ?? 0) + row[7]
    point.totalTokens += row[7]
    points.set(at, point)
    result.dimensionTotals[dimension] = (result.dimensionTotals[dimension] ?? 0) + row[7]
    result.inputTokens += row[2]
    result.outputTokens += row[3]
    result.cacheReadTokens += row[4]
    result.cacheWriteTokens += row[5]
    result.reasoningTokens += row[6]
    result.totalTokens += row[7]
  }
  const rows = db
    .prepare(
      `SELECT agent, model, second_data FROM usage_session_data
    WHERE last_ms >= ? AND first_ms < ?`,
    )
    .iterate(rangeFrom, rangeTo + 1000) as Iterable<{
    agent: string
    model: string
    second_data: Buffer
  }>
  for (const row of rows)
    for (const second of decodeSecondData(row.second_data)) add(row[groupBy], second)
  // 未完成升级的来源仍可与新会话存储一起查询。
  const legacy = db
    .prepare(
      `SELECT ${groupBy} dimension,
    event_timestamp_ms - event_timestamp_ms % 1000 AS at, hour,
    SUM(input_tokens) i, SUM(output_tokens) o, SUM(cache_read_tokens) r,
    SUM(cache_write_tokens) w, SUM(reasoning_tokens) t, SUM(total_tokens) total, COUNT(*) n
    FROM usage_api_calls WHERE event_timestamp_ms >= ? AND event_timestamp_ms < ?
    GROUP BY dimension, at, hour`,
    )
    .all(rangeFrom, rangeTo + 1000) as Array<Record<string, number> & { dimension: string }>
  for (const row of legacy)
    add(row.dimension, [row.at, row.hour, row.i, row.o, row.r, row.w, row.t, row.total, row.n])
  result.points = [...points.values()].sort((a, b) => a.timestamp - b.timestamp)
  return result
}

export function readUsageHours(
  db: Database.Database,
  date?: string,
): Array<{
  agent: string
  model: string
  date: string
  project_path: string
  hour: number
  totalTokens: number
  calls: number
}> {
  type HourRow = {
    agent: string
    model: string
    date: string
    project_path: string
    hour: number
    totalTokens: number
    calls: number
  }
  const groups = new Map<string, HourRow>()
  const where = date ? 'WHERE date = ?' : ''
  const params = date ? [date] : []
  const rows = db
    .prepare(`SELECT agent, model, date, second_data FROM usage_session_data ${where}`)
    .iterate(...params) as Iterable<{
    agent: string
    model: string
    date: string
    second_data: Buffer
  }>
  for (const row of rows)
    for (const second of decodeSecondData(row.second_data)) {
      const key = JSON.stringify([row.agent, row.model, row.date, second[1], second[9]])
      const group = groups.get(key) ?? {
        agent: row.agent,
        model: row.model,
        date: row.date,
        project_path: second[9] ?? '',
        hour: second[1],
        totalTokens: 0,
        calls: 0,
      }
      group.totalTokens += second[7]
      group.calls += second[8]
      groups.set(key, group)
    }
  const legacy = db
    .prepare(
      `SELECT agent, model, date, COALESCE(project_path, '') project_path, hour, SUM(total_tokens) totalTokens, COUNT(*) calls
    FROM usage_api_calls ${where} GROUP BY agent, model, date, project_path, hour`,
    )
    .all(...params) as HourRow[]
  return [...groups.values(), ...legacy]
}
