/** 读取 Gemini 会话文件并生成统一扫描结果。 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getGeminiTmpDir } from '../lib/paths'
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

export class GeminiScanner implements AgentScanner {
  readonly agentName = 'gemini'

  isAvailable(): boolean {
    const tmpDir = getGeminiTmpDir()
    try {
      if (!statSync(tmpDir).isDirectory()) return false
    } catch {
      return false
    }
    return listGeminiFiles(tmpDir).length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const tmpDir = getGeminiTmpDir()

    let isDir = false
    try {
      isDir = statSync(tmpDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return { records, sessions: [], apiCalls }

    for (const file of listGeminiFiles(tmpDir)) {
      if (!shouldScanFile(file, scanContext)) continue
      try {
        if (file.endsWith('.jsonl')) {
          this.parseJsonlStream(file, tmpDir, scanContext, apiCalls)
        } else {
          this.parseSessionJson(file, tmpDir, scanContext, apiCalls)
        }
      } catch (e) {
        throw new Error(`Gemini 会话文件不可读 (${file}): ${(e as Error).message}`)
      }
    }

    replaceDuplicateGeminiCalls(apiCalls)
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }

  /** 解析单个 JSON 会话文件。 */
  private parseSessionJson(
    file: string,
    tmpDir: string,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      throw new Error((e as Error).message)
    }
    let root: unknown
    try {
      root = JSON.parse(text)
    } catch {
      return
    }
    if (!isObject(root)) return
    const messages = Array.isArray(root.messages) ? root.messages : []
    const sessionId =
      (typeof root.sessionId === 'string' && root.sessionId) || fileSessionId(file, tmpDir)
    const fallbackMtime = fileMtimeMs(file)
    const before = apiCalls.length

    messages.forEach((message, index) => {
      if (!isObject(message)) return
      const tokens = message.tokens
      if (!isObject(tokens)) return
      const model = typeof message.model === 'string' && message.model ? message.model : 'unknown'
      const usage = readGeminiUsage(tokens)
      if (!usage) return
      const timestampValue =
        typeof message.timestamp === 'string' || typeof message.timestamp === 'number'
          ? message.timestamp
          : fallbackMtime
      pushGeminiApiCall(
        this.agentName,
        apiCalls,
        context,
        geminiApiCallId(sessionId, message.id, index),
        sessionId,
        model,
        timestampValue,
        usage,
      )
    })

    if (apiCalls.length === before) {
      const stats = isObject(root.stats)
        ? root.stats
        : isObject(root.result) && isObject(root.result.stats)
          ? root.result.stats
          : null
      if (stats) {
        const statsByModel = new Map<
          string,
          { usage: ExclusiveTokenUsage; timestampValue: string | number }
        >()
        collectGeminiStats(stats, fallbackMtime, statsByModel)
        for (const [model, entry] of statsByModel) {
          pushGeminiApiCall(
            this.agentName,
            apiCalls,
            context,
            `gemini-stats:${sessionId}:${model}`,
            sessionId,
            model,
            entry.timestampValue,
            entry.usage,
          )
        }
      }
    }
  }

  /** 逐行解析 JSONL；没有逐条用量时才采用文件级汇总。 */
  private parseJsonlStream(
    file: string,
    tmpDir: string,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    const sessionId = fileSessionId(file, tmpDir)
    const fallbackMtime = fileMtimeMs(file)
    let streamSessionId = sessionId
    let streamModel = 'unknown'
    let directLines = 0
    const statsByModel = new Map<
      string,
      { usage: ExclusiveTokenUsage; timestampValue: string | number }
    >()

    for (const { line, lineIndex } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue

      if (typeof obj.sessionId === 'string' && obj.sessionId) streamSessionId = obj.sessionId
      else if (typeof obj.session_id === 'string' && obj.session_id)
        streamSessionId = obj.session_id
      if (typeof obj.model === 'string' && obj.model) streamModel = obj.model

      const usage = readGeminiUsageFromLine(obj)
      if (usage) {
        directLines += 1
        const model =
          typeof obj.model === 'string' && obj.model
            ? obj.model
            : readNestedModelString(obj) || streamModel
        const timestampValue = geminiLineTimestamp(obj, fallbackMtime)
        const messageId = typeof obj.id === 'string' && obj.id ? obj.id : ''
        pushGeminiApiCall(
          this.agentName,
          apiCalls,
          context,
          geminiApiCallId(streamSessionId, messageId, lineIndex),
          streamSessionId,
          model,
          timestampValue,
          usage,
        )
        continue
      }

      // 逐条记录不存在时，保留文件级汇总结果
      const stats = isObject(obj.stats)
        ? obj.stats
        : isObject(obj.result) && isObject(obj.result.stats)
          ? obj.result.stats
          : null
      if (stats) {
        const timestampValue = geminiLineTimestamp(obj, fallbackMtime)
        collectGeminiStats(stats, timestampValue, statsByModel)
      }
    }

    if (directLines === 0 && statsByModel.size > 0) {
      for (const [model, entry] of statsByModel) {
        pushGeminiApiCall(
          this.agentName,
          apiCalls,
          context,
          `gemini-stats:${streamSessionId}:${model}`,
          streamSessionId,
          model,
          entry.timestampValue,
          entry.usage,
        )
      }
    }
  }
}

/** 读取一次用量；全零返回 null。 */
function readGeminiUsage(
  tokens: Record<string, unknown>,
  inputIncludesCache = false,
): ExclusiveTokenUsage | null {
  return normalizeGeminiStyleUsage({
    input: firstTokenValue(tokens, [
      'input',
      'prompt',
      'input_tokens',
      'prompt_tokens',
      'promptTokenCount',
    ]),
    output: firstTokenValue(tokens, [
      'output',
      'candidates',
      'output_tokens',
      'completion_tokens',
      'candidatesTokenCount',
    ]),
    cached: firstTokenValue(tokens, ['cached', 'cached_tokens', 'cachedContentTokenCount']),
    thoughts: firstTokenValue(tokens, ['thoughts', 'thoughts_tokens', 'thoughtsTokenCount']),
    tool: firstTokenValue(tokens, ['tool', 'tool_tokens', 'toolUsePromptTokenCount']),
    reportedTotal: firstTokenValue(tokens, ['total', 'total_tokens', 'totalTokenCount']),
    inputIncludesCache,
  })
}

/** 从 JSONL 行的可识别字段中读取用量。 */
function readGeminiUsageFromLine(obj: Record<string, unknown>): ExclusiveTokenUsage | null {
  if (isObject(obj.usageMetadata)) return readGeminiUsage(obj.usageMetadata, true)
  if (isObject(obj.tokens)) return readGeminiUsage(obj.tokens)
  return null
}

/** 将汇总对象转换为一组模型用量。 */
function collectGeminiStats(
  stats: Record<string, unknown>,
  timestampValue: string | number,
  sink: Map<string, { usage: ExclusiveTokenUsage; timestampValue: string | number }>,
): void {
  const models = isObject(stats.models) ? stats.models : null
  if (models) {
    for (const [model, value] of Object.entries(models)) {
      if (!isObject(value)) continue
      const usage = readGeminiHeadlessUsage(value)
      if (usage) sink.set(model, { usage, timestampValue })
    }
    return
  }
  const usage = readGeminiHeadlessUsage(stats)
  if (!usage) return
  const model = typeof stats.model === 'string' && stats.model ? stats.model : 'unknown'
  sink.set(model, { usage, timestampValue })
}

/** Headless stats 与会话 message.tokens 的 input 口径不同，需按字段形态判断缓存重叠。 */
function readGeminiHeadlessUsage(value: Record<string, unknown>): ExclusiveTokenUsage | null {
  const hasTokensWrapper = isObject(value.tokens)
  const tokens = hasTokensWrapper ? (value.tokens as Record<string, unknown>) : value
  const promptInput = optionalTokenValue(tokens, ['prompt', 'input_tokens', 'prompt_tokens'])
  const netInput = optionalTokenValue(tokens, ['input'])
  const wrapperInput = hasTokensWrapper ? netInput : null
  return normalizeGeminiStyleUsage({
    input: promptInput ?? wrapperInput ?? netInput ?? 0,
    output: firstTokenValue(tokens, ['candidates', 'output', 'output_tokens', 'candidates_tokens']),
    cached: firstTokenValue(tokens, ['cached', 'cached_tokens']),
    thoughts: firstTokenValue(tokens, [
      'thoughts',
      'thoughts_tokens',
      'reasoning',
      'reasoning_tokens',
    ]),
    tool: 0,
    reportedTotal: firstTokenValue(tokens, ['total', 'total_tokens', 'totalTokenCount']),
    inputIncludesCache: promptInput !== null || wrapperInput !== null || netInput === null,
  })
}

function pushGeminiApiCall(
  agentName: string,
  apiCalls: TokenUsageApiCall[],
  context: ScannerScanContext,
  apiCallId: string,
  sessionId: string,
  model: string,
  timestampValue: string | number,
  usage: ExclusiveTokenUsage,
): void {
  const fallbackDate = 'unknown'
  const { timestamp, rawTimestamp } = timestampsFromValue(timestampValue, fallbackDate)
  const apiCall: TokenUsageApiCall = {
    agent: agentName,
    apiCallId,
    sessionId,
    date: dateFromTimestamp(timestamp, fallbackDate),
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

function geminiApiCallId(sessionId: string, messageId: unknown, index: number): string {
  const stable = typeof messageId === 'string' && messageId.length > 0 ? messageId : `idx-${index}`
  return `gemini:${sessionId}:${stable}`
}

function geminiLineTimestamp(obj: Record<string, unknown>, fallbackMtime: number): string | number {
  for (const key of ['timestamp', 'time', 'created_at', 'createdAt']) {
    const value = obj[key]
    if (typeof value === 'string' && value) return value
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  }
  return fallbackMtime
}

function readNestedModelString(obj: Record<string, unknown>): string {
  const message = isObject(obj.message) ? obj.message : null
  if (message && typeof message.model === 'string' && message.model) return message.model
  return ''
}

function firstTokenValue(source: Record<string, unknown>, keys: string[]): number {
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

function optionalTokenValue(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in source)) continue
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number.parseInt(value, 10)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return null
}

function replaceDuplicateGeminiCalls(apiCalls: TokenUsageApiCall[]): void {
  const byId = new Map<string, TokenUsageApiCall>()
  for (const apiCall of apiCalls) byId.set(apiCall.apiCallId, apiCall)
  apiCalls.splice(0, apiCalls.length, ...byId.values())
}

function fileSessionId(file: string, tmpDir: string): string {
  const stem = basename(file).replace(/\.(json|jsonl)$/i, '')
  const relativeDir = relative(tmpDir, dirname(file)).split(sep).join('/')
  return relativeDir && relativeDir !== '.' ? `${relativeDir}/${stem}` : stem
}

function fileMtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 返回扫描目录中可识别的记录文件。 */
function listGeminiFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      if (isRoot) throw new Error(`Gemini tmp 目录不可读: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (entry.name.endsWith('.jsonl')) {
        out.push(full)
        continue
      }
      if (entry.name.endsWith('.json')) {
        if (entry.name.startsWith('session-')) {
          out.push(full)
          continue
        }
        // chats 目录只接受直属 JSON 文件
        if (basename(dir) === 'chats' && dirname(dirname(dir)) === root) {
          out.push(full)
        }
      }
    }
  }
  walk(root, true)
  return out.sort()
}
