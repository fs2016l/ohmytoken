/** 读取 Qwen Code 转录并生成统一用量记录。 */
import { readdirSync, statSync } from 'fs'
import { basename, join, relative, sep } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getQwenProjectsDir } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import {
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { normalizeGeminiStyleUsage, type ExclusiveTokenUsage } from './gemini-style-usage'

export class QwenScanner implements AgentScanner {
  readonly agentName = 'qwen'

  isAvailable(): boolean {
    const projectsDir = getQwenProjectsDir()
    try {
      if (!statSync(projectsDir).isDirectory()) return false
    } catch {
      return false
    }
    return listQwenJsonlFiles(projectsDir).length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const projectsDir = getQwenProjectsDir()

    let isDir = false
    try {
      isDir = statSync(projectsDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return { records, sessions: [], apiCalls }

    for (const file of listQwenJsonlFiles(projectsDir)) {
      if (!shouldScanFile(file, scanContext)) continue
      try {
        this.parseFile(file, projectsDir, scanContext, apiCalls)
      } catch (e) {
        throw new Error(`Qwen 会话文件不可读 (${file}): ${(e as Error).message}`)
      }
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }

  private parseFile(
    file: string,
    projectsDir: string,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    const fallbackSessionId = qwenPathSessionId(file, projectsDir)
    let fallbackMtime = 0
    try {
      fallbackMtime = statSync(file).mtimeMs
    } catch {
      fallbackMtime = 0
    }
    let messageIndex = 0

    for (const { line } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue
      if (obj.type !== 'assistant') continue
      const usageMetadata = obj.usageMetadata
      if (!isObject(usageMetadata)) continue

      // Qwen 的 cache 是 prompt 子集；不同后端对 candidates 是否包含 thoughts 的
      // 口径不一致，因此必须使用 totalTokenCount 锚定后再拆成互斥分桶。
      const usage = normalizeGeminiStyleUsage({
        input: tokenValue(usageMetadata, ['promptTokenCount', 'prompt_tokens', 'input']),
        output: tokenValue(usageMetadata, ['candidatesTokenCount', 'completion_tokens', 'output']),
        cached: tokenValue(usageMetadata, ['cachedContentTokenCount', 'cached_tokens', 'cached']),
        thoughts: tokenValue(usageMetadata, ['thoughtsTokenCount', 'thoughts_tokens', 'thoughts']),
        // toolUsePromptTokenCount 是 prompt 的组成明细；官方 total 也只按
        // prompt + thoughts + candidates 计算，不能再把它作为额外输入累加。
        tool: 0,
        reportedTotal: tokenValue(usageMetadata, ['totalTokenCount', 'total_tokens', 'total']),
        inputIncludesCache: true,
        outputIncludesThoughts: true,
      })
      if (!usage) continue

      const sessionId =
        (typeof obj.sessionId === 'string' && obj.sessionId.trim()) || fallbackSessionId
      const model = typeof obj.model === 'string' && obj.model.trim() ? obj.model.trim() : 'unknown'
      const timestampValue =
        typeof obj.timestamp === 'string' && obj.timestamp
          ? obj.timestamp
          : typeof obj.timestamp === 'number' && Number.isFinite(obj.timestamp) && obj.timestamp > 0
            ? obj.timestamp
            : fallbackMtime

      pushQwenApiCall(
        this.agentName,
        apiCalls,
        context,
        `qwen:${sessionId}:${messageIndex}`,
        sessionId,
        model,
        timestampValue,
        usage,
      )
      messageIndex += 1
    }
  }
}

function pushQwenApiCall(
  agentName: string,
  apiCalls: TokenUsageApiCall[],
  context: ScannerScanContext,
  apiCallId: string,
  sessionId: string,
  model: string,
  timestampValue: string | number,
  usage: ExclusiveTokenUsage,
): void {
  const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, 'unknown')
  const apiCall: TokenUsageApiCall = {
    agent: agentName,
    apiCallId,
    sessionId,
    date: dateFromTimestamp(timestamp, 'unknown'),
    rawTimestamp,
    timestamp,
    hour: hourFromTimestamp(timestamp),
    model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
  }
  if (!isApiCallInWindow(apiCall, context)) return
  apiCalls.push(apiCall)
}

/** 生成会话标识；优先采用记录内提供的 ID。 */
function qwenPathSessionId(file: string, projectsDir: string): string {
  const parts = relative(projectsDir, file).split(sep)
  const stem = basename(file).replace(/\.jsonl$/i, '')
  const project = parts.length >= 3 ? parts[parts.length - 3] : ''
  return project ? `${project}-${stem}` : stem
}

function tokenValue(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function listQwenJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      if (isRoot) throw new Error(`Qwen projects 目录不可读: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
    }
  }
  walk(root, true)
  return out.sort()
}
