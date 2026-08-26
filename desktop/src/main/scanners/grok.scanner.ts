/** 读取 Grok 本地会话与推理日志。 */
import { existsSync, statSync } from 'fs'
import type {
  AgentScanner,
  ScannerScanContext,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
} from './types'
import { getGrokSessionsDir, getGrokUnifiedLogFile } from '../lib/paths'
import { readUtf8Lines } from '../lib/line-reader'
import { buildRecordsFromSessions, buildSessionsFromApiCalls } from './detail-utils'
import {
  GROK_UNKNOWN_MODEL,
  appendGrokSignalsCall,
  createGrokCall,
  extractGrokEventId,
  extractGrokModel,
  extractGrokTimestamp,
  extractGrokTotal,
  extractUnifiedGrokEventId,
  firstNumber,
  grokCallTimestampMs,
  grokSessionIdFromUpdatesFile,
  isObject,
  listGrokUpdatesFiles,
  numberOrNegative,
  readGrokSessionMetadata,
  reconcileGrokSources,
  splitGrokUsage,
  stableJsonHash,
  type GrokSessionMeta,
} from './grok-support'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { splitInclusiveTokenBuckets, tokenBuckets } from './token-usage'

interface GrokActiveTurn {
  baselineTotal: number
  maxTotal: number
  timestamp: string | number
  model: string
  index: number
}

export class GrokScanner implements AgentScanner {
  readonly agentName = 'grok'

  isAvailable(): boolean {
    return existsSync(getGrokSessionsDir()) || existsSync(getGrokUnifiedLogFile())
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    if (!this.isAvailable()) return { records, sessions: [], apiCalls }

    const sessionMetaById = readGrokSessionMetadata()

    const unifiedCalls: TokenUsageApiCall[] = []
    const updateCalls: TokenUsageApiCall[] = []
    const unifiedFile = getGrokUnifiedLogFile()
    if (existsSync(unifiedFile) && shouldScanFile(unifiedFile, scanContext)) {
      try {
        this.parseUnifiedLog(unifiedFile, sessionMetaById, scanContext, unifiedCalls)
      } catch (e) {
        throw new Error(`Grok unified 日志不可读 (${unifiedFile}): ${(e as Error).message}`)
      }
    }

    for (const updatesFile of listGrokUpdatesFiles(getGrokSessionsDir())) {
      if (!shouldScanFile(updatesFile, scanContext)) continue
      try {
        this.parseUpdatesFile(updatesFile, sessionMetaById, scanContext, updateCalls)
      } catch (e) {
        throw new Error(`Grok 会话文件不可读 (${updatesFile}): ${(e as Error).message}`)
      }
    }

    apiCalls.push(...reconcileGrokSources(unifiedCalls, updateCalls))

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))
    return { records, sessions, apiCalls }
  }

  /** 从会话更新记录中读取可用计数。 */
  private parseUpdatesFile(
    file: string,
    sessionMetaById: Map<string, GrokSessionMeta>,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    const sessionId = grokSessionIdFromUpdatesFile(file)
    if (!sessionId) return
    const sessionMeta = sessionMetaById.get(sessionId)
    const fallbackModel = sessionMeta?.model || GROK_UNKNOWN_MODEL
    let fallbackMtime = 0
    try {
      fallbackMtime = statSync(file).mtimeMs
    } catch {
      fallbackMtime = 0
    }

    const projectPath = sessionMeta?.projectPath
    const usageCalls: TokenUsageApiCall[] = []
    const fallbackCalls: TokenUsageApiCall[] = []
    let currentModel = fallbackModel
    let lastTotal: number | null = null
    let lastTotalTimestamp: string | number = fallbackMtime
    let activeTurn: GrokActiveTurn | null = null
    let turnIndex = 0

    const finishTurn = (): void => {
      if (!activeTurn) return
      const delta = activeTurn.maxTotal - activeTurn.baselineTotal
      if (delta > 0) {
        const call = createGrokCall(
          this.agentName,
          `grok:${sessionId}:turn:${activeTurn.index}`,
          sessionId,
          activeTurn.model,
          activeTurn.timestamp,
          tokenBuckets({ inputTokens: delta }),
          projectPath,
        )
        if (isApiCallInWindow(call, context)) fallbackCalls.push(call)
      }
      activeTurn = null
    }

    for (const { line } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue
      const params = isObject(obj.params) ? obj.params : null
      if (!params) continue
      const update = isObject(params.update) ? params.update : null
      if (!update) continue

      const rowModel = extractGrokModel(obj)
      if (rowModel) {
        currentModel = rowModel
        if (activeTurn && activeTurn.model === GROK_UNKNOWN_MODEL) activeTurn.model = rowModel
      }
      const timestampValue = extractGrokTimestamp(obj) || fallbackMtime

      if (update.sessionUpdate === 'user_message_chunk') {
        finishTurn()
        activeTurn = {
          baselineTotal: lastTotal ?? 0,
          maxTotal: lastTotal ?? 0,
          timestamp: timestampValue,
          model: currentModel,
          index: turnIndex++,
        }
      }

      const usage = isObject(update.usage) ? update.usage : null
      if (usage) {
        const split = splitGrokUsage(
          firstNumber(usage, ['inputTokens', 'input_tokens', 'promptTokens']),
          firstNumber(usage, ['outputTokens', 'output_tokens', 'completionTokens']),
          firstNumber(usage, ['cachedReadTokens', 'cacheReadTokens', 'cache_read_input_tokens']),
          firstNumber(usage, [
            'cachedWriteTokens',
            'cacheWriteTokens',
            'cacheCreationTokens',
            'cache_creation_input_tokens',
          ]),
          firstNumber(usage, ['reasoningTokens', 'thoughtTokens', 'thinkingTokens']),
          firstNumber(usage, ['totalTokens', 'total_tokens']),
        )
        if (split) {
          const modelUsage = isObject(usage.modelUsage) ? Object.keys(usage.modelUsage) : []
          const model = modelUsage.length === 1 ? modelUsage[0] : currentModel
          const eventId = extractGrokEventId(obj)
          const rowHash = stableJsonHash(obj)
          const call = createGrokCall(
            this.agentName,
            `grok:${sessionId}:usage:${eventId || 'row'}:${rowHash}`,
            sessionId,
            model || GROK_UNKNOWN_MODEL,
            timestampValue,
            split,
            projectPath,
          )
          if (isApiCallInWindow(call, context)) usageCalls.push(call)
        }
      }

      const total = extractGrokTotal(obj)
      if (total === null || total < 0) continue
      if (lastTotal !== null && total < lastTotal) continue
      if (lastTotal !== null && total === lastTotal) {
        lastTotalTimestamp = timestampValue
        continue
      }
      if (lastTotal !== null && activeTurn === null) {
        activeTurn = {
          baselineTotal: lastTotal,
          maxTotal: lastTotal,
          timestamp: timestampValue,
          model: currentModel,
          index: turnIndex++,
        }
      }
      if (activeTurn && total > activeTurn.maxTotal) {
        activeTurn.maxTotal = total
        activeTurn.timestamp = timestampValue
      }
      lastTotal = total
      lastTotalTimestamp = timestampValue
    }

    finishTurn()
    if (fallbackCalls.length === 0 && usageCalls.length === 0 && lastTotal && lastTotal > 0) {
      const call = createGrokCall(
        this.agentName,
        `grok:${sessionId}:turn:0`,
        sessionId,
        currentModel,
        lastTotalTimestamp,
        tokenBuckets({ inputTokens: lastTotal }),
        projectPath,
      )
      if (isApiCallInWindow(call, context)) fallbackCalls.push(call)
    }

    if (usageCalls.length === 0) {
      appendGrokSignalsCall(
        this.agentName,
        file,
        sessionId,
        currentModel,
        fallbackMtime,
        projectPath,
        context,
        fallbackCalls,
      )
      apiCalls.push(...fallbackCalls)
      return
    }

    const latestUsageMs = Math.max(...usageCalls.map(grokCallTimestampMs))
    apiCalls.push(
      ...usageCalls,
      ...fallbackCalls.filter((call) => grokCallTimestampMs(call) > latestUsageMs),
    )
  }

  /** 从统一日志中读取完成记录。 */
  private parseUnifiedLog(
    file: string,
    sessionMetaById: Map<string, GrokSessionMeta>,
    context: ScannerScanContext,
    apiCalls: TokenUsageApiCall[],
  ): void {
    const seen = new Set<string>()
    const liveModelBySession = new Map<string, string>()
    for (const { line } of readUtf8Lines(file)) {
      if (!line) continue
      let obj: unknown
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      if (!isObject(obj)) continue
      const rowSessionId = typeof obj.sid === 'string' && obj.sid.trim() ? obj.sid.trim() : ''
      const rowModel = extractGrokModel(obj)
      if (rowSessionId && rowModel) liveModelBySession.set(rowSessionId, rowModel)
      if (obj.msg !== 'shell.turn.inference_done') continue
      const ctx = isObject(obj.ctx) ? obj.ctx : null
      if (!ctx) continue

      const prompt = numberOrNegative(ctx, 'prompt_tokens')
      const completion = numberOrNegative(ctx, 'completion_tokens')
      if (prompt < 0 || completion < 0) continue
      const cachedRaw = numberOrNegative(ctx, 'cached_prompt_tokens')
      const reasoningRaw = numberOrNegative(ctx, 'reasoning_tokens')
      const buckets = splitInclusiveTokenBuckets({
        inputTokens: prompt,
        outputTokens: completion,
        cacheReadTokens: Math.max(0, cachedRaw),
        reasoningTokens: Math.max(0, reasoningRaw),
      })
      if (buckets.totalTokens <= 0) continue

      const sessionId = rowSessionId || 'unknown-session'
      const sessionMeta = sessionMetaById.get(sessionId)
      const model = liveModelBySession.get(sessionId) || sessionMeta?.model || GROK_UNKNOWN_MODEL
      const timestampValue = typeof obj.ts === 'string' && obj.ts ? obj.ts : 0

      const eventId = extractUnifiedGrokEventId(obj)
      const identity = eventId ? `id:${eventId}` : `row:${stableJsonHash(obj)}`
      const apiCall = createGrokCall(
        this.agentName,
        `grok-unified:${sessionId}:${identity}`,
        sessionId,
        model,
        timestampValue,
        buckets,
        sessionMeta?.projectPath,
      )
      if (seen.has(apiCall.apiCallId)) continue
      seen.add(apiCall.apiCallId)
      if (!isApiCallInWindow(apiCall, context)) continue
      apiCalls.push(apiCall)
    }
  }
}
