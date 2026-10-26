/** 读取 OpenClaw 转录并生成统一用量记录。 */
import { createHash } from 'crypto'
import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getOpenClawAgentsDirCandidates } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { tokenBuckets } from './token-usage'
import { conversationTurn, isUserPrompt, type ConversationTurn } from './conversation-turn'
import { LatestTurnTracker } from './latest-turn-tracker'
import { usageEvidence } from '../cost/usage-evidence'
import { readOpenClawDatabase, type OpenClawStoredEvent } from './openclaw-storage'
import { decodeUtf8, decompressZstd } from '../lib/zstd-json'
import { claimSourcePath } from './source-path'

export class OpenClawScanner implements AgentScanner {
  private readonly latestTurns = new LatestTurnTracker()
  readonly agentName = 'openclaw'
  private readonly agentsRoots: () => readonly string[]

  constructor(agentsRoot: () => string | readonly string[] = getOpenClawAgentsDirCandidates) {
    this.agentsRoots = () => {
      const roots = agentsRoot()
      return typeof roots === 'string' ? [roots] : roots
    }
  }

  isAvailable(): boolean {
    return this.agentsRoots().some(
      (root) => isDirectory(root) && listOpenClawTranscripts(root).length > 0,
    )
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    this.latestTurns.clear()
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const visitedFiles = new Set<string>()
    for (const agentsDir of this.agentsRoots()) {
      if (!isDirectory(agentsDir)) continue
      for (const file of listOpenClawTranscripts(agentsDir)) {
        if (!claimSourcePath(visitedFiles, file)) continue
        // SQLite 的新写入可能只发生在 WAL，不能用主文件的 mtime 漏掉新记录。
        if (!file.endsWith('.sqlite') && !shouldScanFile(file, scanContext)) continue
        try {
          if (file.endsWith('.sqlite'))
            this.parseEvents(readOpenClawDatabase(file), scanContext, apiCalls, true)
          else this.parseTranscript(file, scanContext, apiCalls)
        } catch (e) {
          throw new Error(`OpenClaw 会话文件不可读 (${file}): ${(e as Error).message}`)
        }
      }
    }

    mergeDuplicateOpenClawCalls(apiCalls)
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls, latestTurns: this.latestTurns.values() }
  }

  private parseTranscript(
    file: string,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    const sessionId = openClawSessionId(file)
    if (!sessionId) return
    let fallbackMtime = 0
    try {
      fallbackMtime = statSync(file).mtimeMs
    } catch {
      fallbackMtime = 0
    }

    this.parseEvents(
      readOpenClawJsonl(file, sessionId, fallbackMtime),
      context,
      apiCalls,
      file.endsWith('.zst'),
    )
  }

  private parseEvents(
    events: Iterable<OpenClawStoredEvent>,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
    requireNativeIdentity = false,
  ): void {
    const models = new Map<string, string>()
    const turns = new Map<string, ConversationTurn>()
    for (const { sessionId, sourceId, event: obj, fallbackTimestamp: fallbackMtime } of events) {
      if (!isObject(obj)) throw new Error('OpenClaw 转录事件不是有效对象')
      const currentModel = models.get(sourceId) ?? ''
      const type = typeof obj.type === 'string' ? obj.type : ''

      if (type === 'model_change') {
        const next = typeof obj.modelId === 'string' ? obj.modelId.trim() : ''
        if (next) models.set(sourceId, next)
        continue
      }
      if (type === 'custom' && obj.customType === 'model-snapshot') {
        const data = isObject(obj.data) ? obj.data : null
        const next = data && typeof data.modelId === 'string' ? data.modelId.trim() : ''
        if (next) models.set(sourceId, next)
        continue
      }
      if (type !== 'message') continue

      const message = isObject(obj.message) ? obj.message : null
      if (message?.role === 'user' && isUserPrompt(message.content) && obj.isMeta !== true) {
        const turn = conversationTurn(
          obj.id ?? message.id ?? `user:${String(message.timestamp ?? obj.timestamp)}`,
        )
        if (turn) {
          turns.set(sourceId, turn)
          this.latestTurns.start(sessionId, turn.id, message.timestamp ?? obj.timestamp, false)
        }
      }
      if (!message || message.role !== 'assistant') continue
      const usage = isObject(message.usage) ? message.usage : null
      if (!usage) continue

      const buckets = tokenBuckets({
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
      })
      if (buckets.totalTokens <= 0) continue

      const messageModel = typeof message.model === 'string' ? message.model.trim() : ''
      const model = messageModel || currentModel
      if (messageModel) models.set(sourceId, messageModel)
      // 缺少模型标识的记录无法归类
      if (!model) continue

      const timestampValue =
        typeof message.timestamp === 'string' && message.timestamp
          ? message.timestamp
          : typeof message.timestamp === 'number' &&
              Number.isFinite(message.timestamp) &&
              message.timestamp > 0
            ? message.timestamp
            : fallbackMtime
      const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, 'unknown')
      const messageId =
        typeof obj.id === 'string' && obj.id
          ? obj.id
          : typeof message.id === 'string' && message.id
            ? message.id
            : ''
      // 新存储必须保留原生身份；不能用不同存储的 mtime 构造两次调用。
      if (!messageId && requireNativeIdentity)
        throw new Error('OpenClaw 新存储缺少原生消息身份，已中止扫描')
      const stableId = messageId || openClawContentId(sessionId, model, timestampValue, buckets)

      const apiCall: TokenUsageApiCall = {
        turn: turns.get(sourceId),
        agent: this.agentName,
        apiCallId: `openclaw:${sessionId}:${stableId}`,
        sessionId,
        date: dateFromTimestamp(timestamp, 'unknown'),
        rawTimestamp,
        timestamp,
        hour: hourFromTimestamp(timestamp),
        model,
        evidence: usageEvidence({
          reportedUsd: isObject(usage.cost) ? usage.cost.total : undefined,
        }),
        ...buckets,
      }
      if (!isApiCallInWindow(apiCall, context)) continue
      apiCalls.push(apiCall)
    }
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** 从转录文件名提取会话标识。 */
function openClawSessionId(file: string): string {
  const name = basename(file)
  const marker = name.indexOf('.jsonl')
  if (marker <= 0) return ''
  return name.substring(0, marker)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function openClawContentId(
  sessionId: string,
  model: string,
  timestamp: string | number,
  buckets: ReturnType<typeof tokenBuckets>,
): string {
  return createHash('sha256')
    .update(
      [
        sessionId,
        model,
        String(timestamp),
        buckets.inputTokens,
        buckets.outputTokens,
        buckets.cacheReadTokens,
        buckets.cacheWriteTokens,
      ].join('|'),
    )
    .digest('hex')
    .substring(0, 24)
}

/** live/reset/deleted 文件可能保留同一条消息，只保留信息更完整的快照。 */
function mergeDuplicateOpenClawCalls(apiCalls: TokenUsageApiCall[]): void {
  const byId = new Map<string, TokenUsageApiCall>()
  for (const apiCall of apiCalls) {
    const current = byId.get(apiCall.apiCallId)
    if (
      !current ||
      apiCall.totalTokens > current.totalTokens ||
      (apiCall.totalTokens === current.totalTokens && apiCall.timestamp >= current.timestamp)
    ) {
      byId.set(apiCall.apiCallId, apiCall)
    }
  }
  apiCalls.length = 0
  for (const call of byId.values()) apiCalls.push(call)
}

/** 判断文件名是否属于可读取的转录格式。 */
function isOpenClawTranscriptName(name: string): boolean {
  const normalized = name.replace(/\.zst$/, '').split('.jsonl')[0]
  // checkpoint 与 trajectory 是派生快照，不能作为另一次会话累计。
  if (/\.trajectory$|\.checkpoint\.[0-9a-f-]{36}$/i.test(normalized)) return false
  return (
    name.endsWith('.jsonl') ||
    name.endsWith('.jsonl.zst') ||
    /\.jsonl\.(deleted|reset)\.[^/\\]+$/.test(name)
  )
}

function listOpenClawTranscripts(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      throw new Error(`OpenClaw agents 目录不可读 (${dir}): ${(e as Error).message}`)
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (
        entry.isFile() &&
        (isOpenClawTranscriptName(entry.name) || entry.name === 'openclaw-agent.sqlite')
      )
        out.push(full)
    }
  }
  walk(root)
  return out.sort()
}

function* readOpenClawJsonl(
  file: string,
  sessionId: string,
  fallbackTimestamp: number,
): Generator<OpenClawStoredEvent> {
  const limit = 64 * 1024 * 1024
  const compressed = file.endsWith('.zst')
  if (compressed && statSync(file).size > limit) throw new Error('OpenClaw 压缩归档过大')
  const lines = compressed
    ? decodeUtf8(decompressZstd(readFileSync(file), limit))
        .split('\n')
        .map((line) => ({ line }))
    : readUtf8Lines(file)
  for (const { line } of lines) {
    if (!line.trim()) continue
    let event: unknown
    try {
      event = JSON.parse(line)
    } catch (error) {
      if (compressed) throw error
      continue
    }
    if (!isObject(event)) continue
    yield { sessionId, sourceId: file, event, fallbackTimestamp }
  }
}
