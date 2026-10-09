/** DeepSeek Harness 官方规范化日志；不读取连接配置或凭据。 */
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getDeepSeekHarnessSessionsDir } from '../lib/paths'
import { usageEvidence } from '../cost/usage-evidence'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { conversationTurn, isUserPrompt, type ConversationTurn } from './conversation-turn'
import { tokenBuckets } from './token-usage'
import {
  countValue,
  deepSeekRootSessionId,
  deepSeekStreamFirstTokenMs,
  deepSeekStreamInterrupted,
  deepSeekStreamUsage,
  deepSeekTokenChunk,
  isObject,
  listDeepSeekSessionFiles,
  readDeepSeekSessionHeader,
  readDeepSeekSessionLines,
  textValue,
  type DeepSeekSessionHeader,
  type JsonObject,
} from './deepseek-harness-support'

export class DeepSeekHarnessScanner implements AgentScanner {
  readonly agentName = 'deepseek-harness'
  private readonly sessionsDirectory: () => string

  constructor(sessionsDirectory: () => string = getDeepSeekHarnessSessionsDir) {
    this.sessionsDirectory = sessionsDirectory
  }

  isAvailable(): boolean {
    return listDeepSeekSessionFiles(this.sessionsDirectory()).length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const files = listDeepSeekSessionFiles(this.sessionsDirectory())
    const headers = new Map<string, DeepSeekSessionHeader>()
    const headerByFile = new Map<string, DeepSeekSessionHeader>()
    const calls = new Map<string, TokenUsageApiCall>()
    const titles = new Map<string, string>()
    // 增量扫描也读很小的会话头，保留未更新的父会话与多层子任务关系。
    for (const file of files) {
      try {
        const header = readDeepSeekSessionHeader(file)
        if (header) {
          headers.set(header.id, header)
          headerByFile.set(file, header)
        }
      } catch (error) {
        throw new Error(`DeepSeek Harness 会话头不可读 (${file}): ${(error as Error).message}`)
      }
    }
    const selected = files.filter(
      (file) => headerByFile.has(file) && shouldScanFile(file, scanContext),
    )
    scanContext.reportProgress?.({ unit: 'files', completed: 0, total: selected.length })
    for (const [index, file] of selected.entries()) {
      try {
        this.readSession(file, headerByFile.get(file)!, headers, calls, titles)
      } catch (error) {
        throw new Error(`DeepSeek Harness 会话不可读 (${file}): ${(error as Error).message}`)
      }
      scanContext.reportProgress?.({ unit: 'files', completed: index + 1, total: selected.length })
    }
    const apiCalls = [...calls.values()].filter((call) => isApiCallInWindow(call, scanContext))
    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(sessions, titles)
    return { apiCalls, sessions, records: buildRecordsFromSessions(this.agentName, sessions) }
  }

  private readSession(
    file: string,
    header: DeepSeekSessionHeader,
    headers: Map<string, DeepSeekSessionHeader>,
    calls: Map<string, TokenUsageApiCall>,
    titles: Map<string, string>,
  ): void {
    let model = ''
    let currentTurn: number | undefined
    let seeded = header.seeded
    let lineIndex = -1
    const turns = new Map<number, ConversationTurn>()
    const retries = new Map<string, string>()
    const timingByStep = new Map<
      string,
      { startedAtMs?: number; firstTokenAtMs?: number; interrupted?: boolean }
    >()
    const compactionTurns = new Map<string, number>()
    const rootSessionId = deepSeekRootSessionId(header, headers)
    for (const line of readDeepSeekSessionLines(file)) {
      lineIndex++
      if (!line.trim()) continue
      const row: unknown = JSON.parse(line)
      if (!isObject(row) || row.type === 'session') continue
      const data = isObject(row.data) ? row.data : {}
      const sequence = countValue(row.seq) ?? lineIndex
      if (row.type === 'session/end-seed') {
        seeded = false
        turns.clear()
        timingByStep.clear()
        currentTurn = undefined
        continue
      }
      if (header.inheritedEventCount > 0) seeded = sequence < header.inheritedEventCount
      if (row.type === 'model/selection') model = textValue(data.model) || model
      if (row.type === 'request/header' && isObject(data.header) && isObject(data.header.config))
        model = textValue(data.header.config.model) || model
      if (row.type === 'session/title') {
        const title = textValue(data.title)
        if (title) titles.set(header.id, title)
      }
      if (row.type === 'turn/start') currentTurn = countValue(data.turn)
      if (row.type === 'user/message' && !seeded && currentTurn !== undefined) {
        const message = isObject(data.message) ? data.message : data
        if (
          isObject(message.source) &&
          message.source.kind === 'user' &&
          isUserPrompt(message.content)
        ) {
          const turn = conversationTurn(`turn:${currentTurn}`, !header.parentSessionId)
          if (turn) turns.set(currentTurn, turn)
        }
      }
      if (seeded) continue
      const compactionId = textValue(data.compactionId)
      if (row.type === 'compaction/start') {
        const owner = countValue(data.turn)
        if (compactionId && owner !== undefined) compactionTurns.set(compactionId, owner)
        continue
      }
      const isCompaction = row.type === 'compaction/summary'
      const turnNumber = isCompaction
        ? compactionTurns.get(compactionId)
        : (countValue(data.turn) ?? currentTurn)
      const stepNumber = countValue(data.step)
      const step = isCompaction
        ? `compaction:${compactionId || `seq:${sequence}`}`
        : turnNumber !== undefined && stepNumber !== undefined
          ? `turn:${turnNumber}:step:${stepNumber}`
          : `seq:${sequence}`
      if (row.type === 'step/start') {
        timingByStep.set(step, { startedAtMs: countValue(row.time) })
        continue
      }
      if (row.type === 'llm/retry-started') {
        retries.set(step, String(sequence))
        timingByStep.set(step, { startedAtMs: countValue(row.time) })
        continue
      }
      const stepTiming = timingByStep.get(step)
      if (row.type === 'assistant/chunk' && stepTiming && deepSeekTokenChunk(data.chunk))
        stepTiming.firstTokenAtMs ??= countValue(row.time)
      if (
        row.type === 'assistant/chunk' &&
        stepTiming &&
        deepSeekStreamInterrupted([{ chunk: data.chunk }])
      )
        stepTiming.interrupted = true
      let usage: JsonObject | undefined
      if (
        row.type === 'assistant/message' ||
        row.type === 'assistant/attempt' ||
        row.type === 'llm/retry' ||
        isCompaction
      )
        usage = isObject(data.usage) ? data.usage : deepSeekStreamUsage(data.stream)
      if (row.type === 'assistant/chunk' && isObject(data.chunk) && data.chunk.type === 'usage')
        usage = isObject(data.chunk.usage) ? data.chunk.usage : undefined
      if (!usage) continue
      const message = isObject(data.message) ? data.message : {}
      const source = isObject(message.source)
        ? message.source
        : isObject(data.source)
          ? data.source
          : {}
      const responseModel = textValue(source.model)
      const apiCallId = `${this.agentName}:${header.id}:${step}:attempt:${retries.get(step) ?? '0'}`
      const { timestamp, rawTimestamp } = timestampsFromValue(
        row.time ?? header.createdAt,
        'unknown',
      )
      const call: TokenUsageApiCall = {
        agent: this.agentName,
        apiCallId,
        sessionId: header.id,
        parentSessionId: header.parentSessionId,
        rootSessionId,
        subAgentName: header.subAgentName,
        projectPath: header.projectPath,
        role: 'assistant',
        model: responseModel || (isCompaction && textValue(data.model)) || model || 'unknown',
        date: dateFromTimestamp(timestamp),
        timestamp,
        rawTimestamp,
        hour: hourFromTimestamp(timestamp),
        ...deepSeekTokenBuckets(usage),
        evidence: usageEvidence({ modelSource: responseModel ? 'response' : 'session' }),
      }
      if (turnNumber !== undefined) {
        const turn = turns.get(turnNumber)
        if (turn) call.turn = turn
      }
      if (
        row.type === 'assistant/message' &&
        data.interrupted !== true &&
        stepTiming?.interrupted !== true &&
        !deepSeekStreamInterrupted(data.stream)
      ) {
        // 新格式的流只属于当前 attempt；不能沿用重试前的首字时间。
        const firstTokenAtMs = Array.isArray(data.stream)
          ? deepSeekStreamFirstTokenMs(data.stream)
          : stepTiming?.firstTokenAtMs
        const completedAtMs = countValue(row.time)
        const startedAtMs = stepTiming?.startedAtMs
        if (
          firstTokenAtMs !== undefined &&
          completedAtMs !== undefined &&
          completedAtMs >= firstTokenAtMs &&
          (startedAtMs === undefined || firstTokenAtMs >= startedAtMs)
        ) {
          call.generationTiming = {
            completedAtMs,
            ...(startedAtMs === undefined
              ? {}
              : { timeToFirstTokenMs: firstTokenAtMs - startedAtMs }),
            ...(completedAtMs > firstTokenAtMs
              ? { streamDurationMs: completedAtMs - firstTokenAtMs }
              : {}),
            ...(countValue(usage.outputTokens) === undefined
              ? {}
              : { generatedTokens: usage.outputTokens as number }),
          }
        }
      }
      // chunk 是累计样本，settlement 替换该请求；重试边界之后才开始另一次调用。
      if (call.totalTokens > 0) calls.set(apiCallId, call)
      else calls.delete(apiCallId)
    }
  }
}

function deepSeekTokenBuckets(usage: JsonObject): ReturnType<typeof tokenBuckets> {
  for (const key of [
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'reasoningTokens',
    'totalTokens',
  ]) {
    if (usage[key] !== undefined && countValue(usage[key]) === undefined)
      throw new Error(`DeepSeek Harness 用量字段无效: ${key}`)
  }
  const output = countValue(usage.outputTokens) ?? 0
  const reasoning = countValue(usage.reasoningTokens) ?? 0
  if (reasoning > output) throw new Error('DeepSeek Harness 推理用量超出输出总量')
  const buckets = tokenBuckets({
    inputTokens: usage.inputTokens,
    outputTokens: output - reasoning,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    reasoningTokens: reasoning,
  })
  if (usage.totalTokens !== undefined && usage.totalTokens !== buckets.totalTokens)
    throw new Error('DeepSeek Harness 总用量与分桶不一致')
  return buckets
}
