import { createHash } from 'crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import type { Dirent } from 'fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'path'
import { formatDateFromMs } from '../lib/date-utils'
import { getKimiCodeSessionsSources, type KimiCodeSessionsSource } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { normalizeCollectedProjectPath } from './project-path'
import { tokenBuckets } from './token-usage'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'

interface ParsedKimiCodeFile {
  apiCalls: TokenUsageApiCall[]
  title: string
}

export class KimiCodeScanner implements AgentScanner {
  readonly agentName = 'kimi-code'

  isAvailable(): boolean {
    return getKimiCodeSessionsSources().some((source) => existsSync(source.dir))
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const apiCallById = new Map<string, TokenUsageApiCall>()
    const titleBySessionId = new Map<string, string>()

    for (const source of getKimiCodeSessionsSources()) {
      if (!existsSync(source.dir)) continue
      for (const file of listWireFiles(source.dir)) {
        if (!shouldScanFile(file, scanContext)) continue
        const parsed =
          source.kind === 'kimi-code'
            ? this.parseKimiCodeFile(file, source, scanContext)
            : this.parseLegacyKimiFile(file, source, scanContext)
        for (const call of parsed.apiCalls) mergeKimiCall(apiCallById, call)
        if (parsed.title && parsed.apiCalls[0]) {
          titleBySessionId.set(parsed.apiCalls[0].sessionId, parsed.title)
        }
      }
    }

    const apiCalls = [...apiCallById.values()]
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    for (const session of sessions) {
      const title = titleBySessionId.get(session.sessionId)
      if (title) session.title = title
    }
    const records = buildRecordsFromSessions(this.agentName, sessions)
    return { records, sessions, apiCalls }
  }

  private parseKimiCodeFile(
    file: string,
    source: KimiCodeSessionsSource,
    context: ScannerScanContext,
  ): ParsedKimiCodeFile {
    const apiCalls: TokenUsageApiCall[] = []
    const identity = kimiCodeIdentity(file, source.dir)
    const fallbackMtime = fileMtime(file)
    let latestConcreteModel = ''
    let title = ''

    for (const { line, lineIndex } of readUtf8Lines(file)) {
      if (!line) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(value)) continue

      const lineType = stringValue(value.type)
      if (!title) title = kimiTitle(value)
      if (lineType === 'llm.request') {
        latestConcreteModel = concreteKimiModel(stringValue(value.model)) || latestConcreteModel
        continue
      }
      if (lineType !== 'usage.record' || value.usageScope !== 'turn') continue
      const usage = isObject(value.usage) ? value.usage : null
      if (!usage) continue
      const buckets = tokenBuckets({
        inputTokens: usage.inputOther,
        outputTokens: usage.output,
        cacheReadTokens: usage.inputCacheRead,
        cacheWriteTokens: usage.inputCacheCreation,
      })
      if (buckets.totalTokens <= 0) continue

      const model =
        concreteKimiModel(stringValue(value.model)) || latestConcreteModel || 'kimi-for-coding'
      const sourceTime = positiveNumber(value.time)
      // Kimi Code 的 time 固定是 epoch 毫秒，不可套用秒/毫秒猜测。
      const timestampValue = sourceTime > 0 ? sourceTime : fallbackMtime
      const fallbackDate = timestampValue > 0 ? formatDateFromMs(timestampValue) : 'unknown'
      const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, fallbackDate)
      const explicitId = stringValue(value.id)
      const apiCall: TokenUsageApiCall = {
        agent: this.agentName,
        apiCallId:
          explicitId ||
          stableKimiId(
            'code',
            relative(source.dir, file),
            lineIndex,
            timestampValue,
            model,
            buckets,
          ),
        sessionId: identity.sessionId,
        ...(identity.projectPath ? { projectPath: identity.projectPath } : {}),
        date: dateFromTimestamp(timestamp, fallbackDate),
        rawTimestamp,
        timestamp,
        hour: hourFromTimestamp(timestamp),
        model,
        ...buckets,
      }
      if (isApiCallInWindow(apiCall, context)) apiCalls.push(apiCall)
    }
    return { apiCalls, title }
  }

  private parseLegacyKimiFile(
    file: string,
    source: KimiCodeSessionsSource,
    context: ScannerScanContext,
  ): ParsedKimiCodeFile {
    const apiCalls: TokenUsageApiCall[] = []
    const sessionId =
      basename(dirname(file)) || relative(source.dir, dirname(file)).split(sep).join('/')
    const fallbackMtime = fileMtime(file)
    const model = readLegacyKimiModel(source.dir)

    for (const { line, lineIndex } of readUtf8Lines(file)) {
      if (!line) continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(value) || value.type === 'metadata') continue
      const message = isObject(value.message) ? value.message : null
      const payload =
        message && message.type === 'StatusUpdate' && isObject(message.payload)
          ? message.payload
          : null
      const usage = payload && isObject(payload.token_usage) ? payload.token_usage : null
      if (!usage) continue
      const buckets = tokenBuckets({
        inputTokens: usage.input_other ?? usage.inputOther,
        outputTokens: usage.output,
        cacheReadTokens: usage.input_cache_read ?? usage.inputCacheRead,
        cacheWriteTokens: usage.input_cache_creation ?? usage.inputCacheCreation,
      })
      if (buckets.totalTokens <= 0) continue

      const seconds = positiveNumber(value.timestamp)
      const timestampValue = seconds > 0 ? Math.trunc(seconds * 1000) : fallbackMtime
      const fallbackDate = timestampValue > 0 ? formatDateFromMs(timestampValue) : 'unknown'
      const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, fallbackDate)
      const messageId = payload ? stringValue(payload.message_id) : ''
      const apiCall: TokenUsageApiCall = {
        agent: this.agentName,
        apiCallId:
          messageId ||
          stableKimiId(
            'legacy',
            relative(source.dir, file),
            lineIndex,
            timestampValue,
            model,
            buckets,
          ),
        sessionId,
        date: dateFromTimestamp(timestamp, fallbackDate),
        rawTimestamp,
        timestamp,
        hour: hourFromTimestamp(timestamp),
        model,
        ...buckets,
      }
      if (isApiCallInWindow(apiCall, context)) apiCalls.push(apiCall)
    }
    return { apiCalls, title: '' }
  }
}

function kimiCodeIdentity(
  file: string,
  sessionsDir: string,
): { sessionId: string; projectPath?: string } {
  const agentDir = dirname(file)
  const agentsDir = dirname(agentDir)
  if (basename(agentsDir) === 'agents') {
    const sessionDir = dirname(agentsDir)
    const workspaceDir = dirname(sessionDir)
    const rawWorkspace = basename(workspaceDir)
    let decodedWorkspace = rawWorkspace
    try {
      decodedWorkspace = decodeURIComponent(rawWorkspace)
    } catch {
      // 非 URL 编码的目录名直接使用。
    }
    const projectPath = isAbsolute(decodedWorkspace)
      ? normalizeCollectedProjectPath(decodedWorkspace)
      : undefined
    return { sessionId: basename(sessionDir), ...(projectPath ? { projectPath } : {}) }
  }
  return {
    sessionId: basename(dirname(file)) || relative(sessionsDir, dirname(file)).split(sep).join('/'),
  }
}

function concreteKimiModel(value: string): string {
  const normalized = value.replace(/^kimi-code\//, '').trim()
  if (!normalized || /^__.*__$/.test(normalized)) return ''
  return normalized
}

function readLegacyKimiModel(sessionsDir: string): string {
  const config = join(dirname(sessionsDir), 'config.json')
  try {
    const value: unknown = JSON.parse(readFileSync(config, 'utf8'))
    if (isObject(value)) return concreteKimiModel(stringValue(value.model)) || 'kimi-for-coding'
  } catch {
    // config.json 是可选元数据。
  }
  return 'kimi-for-coding'
}

function kimiTitle(value: Record<string, unknown>): string {
  if (value.type === 'turn.prompt') return contentText(value.input)
  if (value.type !== 'context.append_message') return ''
  const message = isObject(value.message) ? value.message : null
  return message?.role === 'user' ? contentText(message.content) : ''
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (isObject(item) && typeof item.text === 'string' && item.text.trim()) return item.text.trim()
  }
  return ''
}

function mergeKimiCall(target: Map<string, TokenUsageApiCall>, incoming: TokenUsageApiCall): void {
  const existing = target.get(incoming.apiCallId)
  if (!existing || incoming.totalTokens > existing.totalTokens) {
    target.set(incoming.apiCallId, incoming)
    return
  }
  if (incoming.totalTokens === existing.totalTokens && incoming.timestamp > existing.timestamp) {
    target.set(incoming.apiCallId, incoming)
  }
}

function stableKimiId(
  kind: string,
  file: string,
  lineIndex: number,
  timestamp: number,
  model: string,
  buckets: ReturnType<typeof tokenBuckets>,
): string {
  const digest = createHash('sha256')
    .update(
      [kind, file.split(sep).join('/'), lineIndex, timestamp, model, buckets.totalTokens].join(
        '\u0000',
      ),
    )
    .digest('hex')
    .slice(0, 32)
  return `kimi-code:${digest}`
}

function listWireFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (isRoot) throw new Error(`Kimi Code sessions 目录不可读: ${(error as Error).message}`)
      return
    }
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name === 'wire.jsonl') files.push(path)
    }
  }
  walk(root, true)
  return files.sort()
}

function fileMtime(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function positiveNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
