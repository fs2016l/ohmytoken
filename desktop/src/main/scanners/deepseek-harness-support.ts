import { existsSync, readdirSync } from 'fs'
import { basename, dirname, join } from 'path'
import { readUtf8Lines } from '../lib/line-reader'
import { readZstdLines } from '../lib/zstd-line-reader'
import { extractProjectPath } from './project-path'

export type JsonObject = Record<string, unknown>

export interface DeepSeekSessionHeader {
  id: string
  createdAt: unknown
  projectPath?: string
  parentSessionId?: string
  subAgentName?: string
  seeded: boolean
  inheritedEventCount: number
}

/** 每个会话只读最新格式，避免迁移后保留的旧代际再次累计。 */
export function listDeepSeekSessionFiles(root: string): string[] {
  if (!existsSync(root)) return []
  const files: string[] = []
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const match = /^session(?:\.v(\d+))?\.jsonl(?:\.zstd)?$/.exec(entry.name)
        return match ? { name: entry.name, version: Number(match[1] ?? 0) } : null
      })
      .filter((entry) => entry !== null)
      .sort((left, right) => right.version - left.version || right.name.localeCompare(left.name))
    if (candidates.length) files.push(join(directory, candidates[0].name))
    for (const entry of entries) if (entry.isDirectory()) visit(join(directory, entry.name))
  }
  visit(root)
  return files.sort()
}

export function* readDeepSeekSessionLines(file: string): Generator<string> {
  if (file.endsWith('.zstd')) yield* readZstdLines(file)
  else for (const { line } of readUtf8Lines(file)) yield line
}

export function readDeepSeekSessionHeader(file: string): DeepSeekSessionHeader | undefined {
  for (const line of readDeepSeekSessionLines(file)) {
    if (!line.trim()) continue
    const row: unknown = JSON.parse(line)
    if (!isObject(row) || row.type !== 'session') throw new Error('缺少 DeepSeek Harness 会话头')
    if (typeof row.version === 'number' && row.version > 4)
      throw new Error(`暂不支持 DeepSeek Harness 会话格式 v${row.version}`)
    const isSubagent = row.origin === 'subagent' || Number(row.delegationDepth) > 0
    return {
      id: textValue(row.id) || basename(dirname(file)),
      createdAt: row.createdAt,
      projectPath: extractProjectPath(row),
      parentSessionId: isSubagent ? textValue(row.parentSession) || undefined : undefined,
      subAgentName: isSubagent ? textValue(row.agentPreset) || undefined : undefined,
      seeded: row.isSeeded === true,
      inheritedEventCount: countValue(row.inheritedEventCount) ?? 0,
    }
  }
  throw new Error('DeepSeek Harness 会话头尚未写完')
}

export function deepSeekRootSessionId(
  header: DeepSeekSessionHeader,
  headers: Map<string, DeepSeekSessionHeader>,
): string {
  let current = header
  const seen = new Set([header.id])
  while (current.parentSessionId && !seen.has(current.parentSessionId)) {
    const parent = current.parentSessionId
    seen.add(parent)
    const next = headers.get(parent)
    if (!next) return parent
    current = next
  }
  return current.id
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function countValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** 新版把用量折进流记录；只取一次调用的最后一个累计 usage 样本。 */
export function deepSeekStreamUsage(value: unknown): JsonObject | undefined {
  if (!Array.isArray(value)) return undefined
  for (let index = value.length - 1; index >= 0; index--) {
    const item = value[index]
    if (!isObject(item)) continue
    const chunk = isObject(item.chunk) ? item.chunk : item
    if (chunk.type === 'usage' && isObject(chunk.usage)) return chunk.usage
  }
  return undefined
}

/** 首字只认模型内容增量；块边界和用量事件不是输出。 */
export function deepSeekTokenChunk(value: unknown): boolean {
  if (!isObject(value)) return false
  if (value.type === 'text-delta' || value.type === 'reasoning-delta')
    return typeof value.text === 'string' && value.text.length > 0
  return (
    value.type === 'tool-call-delta' &&
    ((typeof value.argumentsDelta === 'string' && value.argumentsDelta.length > 0) ||
      (typeof value.name === 'string' && value.name.length > 0))
  )
}

/** 直接读紧凑流的时间证据，不展开或保存回答正文。 */
export function deepSeekStreamFirstTokenMs(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined
  for (const item of value) {
    if (!isObject(item)) continue
    if (isObject(item.chunk)) {
      if (deepSeekTokenChunk(item.chunk)) return countValue(item.time)
      continue
    }
    if (!['text-chunks', 'reasoning-chunks', 'tool-call-chunks'].includes(String(item.type)))
      continue
    const fragments = item.type === 'tool-call-chunks' ? item.args : item.texts
    const gaps = item.dt
    let time = countValue(item.time0)
    if (
      time === undefined ||
      !Array.isArray(fragments) ||
      !fragments.length ||
      fragments.some((fragment) => typeof fragment !== 'string') ||
      !Array.isArray(gaps) ||
      gaps.length !== fragments.length - 1 ||
      gaps.some((gap) => !Number.isSafeInteger(gap))
    )
      return undefined
    for (let index = 0; index < fragments.length; index++) {
      if (index > 0) time += gaps[index - 1] as number
      if (!Number.isSafeInteger(time) || time < 0) return undefined
      if (
        fragments[index].length > 0 ||
        (item.type === 'tool-call-chunks' && typeof item.name === 'string' && item.name.length > 0)
      )
        return time
    }
  }
  return undefined
}

export function deepSeekStreamInterrupted(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.some((item) => {
    if (!isObject(item)) return false
    const chunk = isObject(item.chunk) ? item.chunk : item
    if (chunk.type !== 'finish') return false
    const reason = isObject(chunk.reason) ? chunk.reason.kind : chunk.reason
    return reason === 'error' || reason === 'aborted'
  })
}
