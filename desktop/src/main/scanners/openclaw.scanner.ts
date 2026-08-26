/** 读取 OpenClaw 转录并生成统一用量记录。 */
import { createHash } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { basename, join } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getOpenClawAgentsDir } from '../lib/paths'
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

export class OpenClawScanner implements AgentScanner {
  readonly agentName = 'openclaw'

  isAvailable(): boolean {
    const agentsDir = getOpenClawAgentsDir()
    try {
      if (!statSync(agentsDir).isDirectory()) return false
    } catch {
      return false
    }
    return listOpenClawTranscripts(agentsDir).length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const agentsDir = getOpenClawAgentsDir()

    let isDir = false
    try {
      isDir = statSync(agentsDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return { records, sessions: [], apiCalls }

    for (const file of listOpenClawTranscripts(agentsDir)) {
      if (!shouldScanFile(file, scanContext)) continue
      try {
        this.parseTranscript(file, scanContext, apiCalls)
      } catch (e) {
        throw new Error(`OpenClaw 会话文件不可读 (${file}): ${(e as Error).message}`)
      }
    }

    mergeDuplicateOpenClawCalls(apiCalls)
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
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

    let currentModel = ''
    for (const { line } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue
      const type = typeof obj.type === 'string' ? obj.type : ''

      if (type === 'model_change') {
        const next = typeof obj.modelId === 'string' ? obj.modelId.trim() : ''
        if (next) currentModel = next
        continue
      }
      if (type === 'custom' && obj.customType === 'model-snapshot') {
        const data = isObject(obj.data) ? obj.data : null
        const next = data && typeof data.modelId === 'string' ? data.modelId.trim() : ''
        if (next) currentModel = next
        continue
      }
      if (type !== 'message') continue

      const message = isObject(obj.message) ? obj.message : null
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
      if (messageModel) currentModel = messageModel
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
            : openClawContentId(sessionId, model, timestampValue, buckets)

      const apiCall: TokenUsageApiCall = {
        agent: this.agentName,
        apiCallId: `openclaw:${sessionId}:${messageId}`,
        sessionId,
        date: dateFromTimestamp(timestamp, 'unknown'),
        rawTimestamp,
        timestamp,
        hour: hourFromTimestamp(timestamp),
        model,
        ...buckets,
      }
      if (!isApiCallInWindow(apiCall, context)) continue
      apiCalls.push(apiCall)
    }
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
  apiCalls.splice(0, apiCalls.length, ...byId.values())
}

/** 判断文件名是否属于可读取的转录格式。 */
function isOpenClawTranscriptName(name: string): boolean {
  return name.endsWith('.jsonl') || /\.jsonl\.(deleted|reset)\.[^/\\]+$/.test(name)
}

function listOpenClawTranscripts(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      if (isRoot) throw new Error(`OpenClaw agents 目录不可读: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && isOpenClawTranscriptName(entry.name)) out.push(full)
    }
  }
  walk(root, true)
  return out.sort()
}
