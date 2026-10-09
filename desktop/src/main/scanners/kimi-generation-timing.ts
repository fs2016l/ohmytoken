import { existsSync, readdirSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import { readByteSnippet, readUtf8Lines } from '../lib/line-reader'
import type { TokenUsageApiCall } from './types'

type GenerationTiming = NonNullable<TokenUsageApiCall['generationTiming']>

export interface KimiTimingRequest {
  agentId: string
  turnStep: string
  attempt: string
  startedAtMs: number
}

interface KimiTimingSample extends GenerationTiming {
  requestStartedAtMs: number
  generatedTokens: number
}

export type KimiTimingIndex = ReadonlyMap<string, readonly KimiTimingSample[]>

const SETTLEMENT_TIME_TOLERANCE_MS = 1000

/** 计时只从同一会话的响应日志读取，不扫描全局日志或猜测 wire 写入时间。 */
export function kimiGenerationTimingFiles(wireFile: string): string[] {
  const agentDirectory = dirname(wireFile)
  if (basename(dirname(agentDirectory)) !== 'agents') return []
  const logsDirectory = join(dirname(dirname(agentDirectory)), 'logs')
  if (!existsSync(logsDirectory)) return []
  try {
    return readdirSync(logsDirectory)
      .filter((name) => /^kimi-code\.log(?:\.\d+)?$/.test(name))
      .sort((left, right) => rotationIndex(right) - rotationIndex(left))
      .map((name) => join(logsDirectory, name))
  } catch {
    return []
  }
}

export function readKimiGenerationTimings(files: readonly string[]): KimiTimingIndex {
  const samples = new Map<string, KimiTimingSample[]>()
  const requests = new Map<string, number>()
  for (const file of files) {
    try {
      const size = statSync(file).size
      const completeTail = size > 0 && readByteSnippet(file, size - 1, 1) === '\n'
      for (const { line, byteOffset, byteLength, truncated } of readUtf8Lines(
        file,
        64 * 1024,
        0,
        16 * 1024,
      )) {
        if (truncated || (byteOffset + byteLength === size && !completeTail)) continue
        const started = parseRequestLine(line)
        if (started) {
          requests.set(started.key, started.startedAtMs)
          continue
        }
        const parsed = parseTimingLine(line, requests)
        if (!parsed) continue
        const list = samples.get(parsed.key) ?? []
        if (
          !list.some(
            (sample) =>
              sample.completedAtMs === parsed.sample.completedAtMs &&
              sample.requestStartedAtMs === parsed.sample.requestStartedAtMs &&
              sample.timeToFirstTokenMs === parsed.sample.timeToFirstTokenMs &&
              sample.streamDurationMs === parsed.sample.streamDurationMs &&
              sample.generatedTokens === parsed.sample.generatedTokens,
          )
        )
          list.push(parsed.sample)
        samples.set(parsed.key, list)
      }
    } catch {
      // 日志可被关闭、轮转或禁用；用量采集不依赖可选的计时证据。
    }
  }
  return samples
}

export function kimiTimingRequest(
  value: Record<string, unknown>,
  wireFile: string,
): KimiTimingRequest | undefined {
  if (
    value.type !== 'llm.request' ||
    (value.kind !== undefined && value.kind !== 'loop' && value.kind !== 'turn')
  )
    return undefined
  const turnStep = text(value.turnStep)
  const startedAtMs = nonnegativeNumber(value.time)
  if (!/^\d+\.\d+$/.test(turnStep) || startedAtMs === undefined || startedAtMs <= 0)
    return undefined
  return {
    agentId: text(value.agentId) || basename(dirname(wireFile)),
    turnStep,
    attempt: text(value.attempt),
    startedAtMs,
  }
}

export function matchKimiGenerationTiming(
  index: KimiTimingIndex,
  request: KimiTimingRequest | undefined,
  usage: Record<string, unknown>,
  outputTokens: number,
): GenerationTiming | undefined {
  if (!request || (text(usage.agentId) && text(usage.agentId) !== request.agentId)) return undefined
  const settledAtMs = nonnegativeNumber(usage.time)
  if (settledAtMs === undefined || settledAtMs < request.startedAtMs) return undefined
  const matching = (index.get(timingKey(request)) ?? []).filter(
    (sample) =>
      sample.generatedTokens === outputTokens &&
      Math.abs(sample.requestStartedAtMs - request.startedAtMs) <= SETTLEMENT_TIME_TOLERANCE_MS &&
      sample.completedAtMs >= request.startedAtMs &&
      Math.abs(sample.completedAtMs - settledAtMs) <= SETTLEMENT_TIME_TOLERANCE_MS &&
      (sample.timeToFirstTokenMs ?? 0) + (sample.streamDurationMs ?? 0) <=
        sample.completedAtMs - request.startedAtMs + SETTLEMENT_TIME_TOLERANCE_MS,
  )
  // 同一步重试、并行 Agent 或日志恢复发生歧义时，不把计时关联到另一条用量。
  if (matching.length !== 1) return undefined
  const { requestStartedAtMs: _startedAtMs, ...timing } = matching[0]
  return timing
}

function parseTimingLine(
  line: string,
  requests: ReadonlyMap<string, number>,
): { key: string; sample: KimiTimingSample } | undefined {
  const parsed = parseLogLine(line, 'response')
  if (!parsed) return undefined
  const { fields, atMs: completedAtMs, key } = parsed
  const requestStartedAtMs = requests.get(key)
  if (requestStartedAtMs === undefined || requestStartedAtMs > completedAtMs) return undefined
  const timeToFirstTokenMs = nonnegativeNumber(fields.ttftMs)
  const streamDurationMs = nonnegativeNumber(fields.streamDurationMs)
  const generatedTokens = nonnegativeNumber(fields.outputTokens)
  if (
    timeToFirstTokenMs === undefined ||
    streamDurationMs === undefined ||
    generatedTokens === undefined ||
    !Number.isSafeInteger(generatedTokens)
  )
    return undefined
  for (const field of ['requestBuildMs', 'serverFirstTokenMs', 'serverDecodeMs', 'clientConsumeMs'])
    if (fields[field] !== undefined && nonnegativeNumber(fields[field]) === undefined)
      return undefined
  return {
    key,
    sample: {
      requestStartedAtMs,
      completedAtMs,
      timeToFirstTokenMs,
      streamDurationMs,
      generatedTokens,
    },
  }
}

function parseRequestLine(line: string): { key: string; startedAtMs: number } | undefined {
  const parsed = parseLogLine(line, 'request')
  return parsed ? { key: parsed.key, startedAtMs: parsed.atMs } : undefined
}

function parseLogLine(
  line: string,
  kind: 'request' | 'response',
): { key: string; atMs: number; fields: Record<string, string> } | undefined {
  const match = /^(\S+)\s+INFO\s+llm (request|response)\s+(.+)$/.exec(line)
  if (!match || match[2] !== kind) return undefined
  const atMs = Date.parse(match[1])
  if (!Number.isFinite(atMs) || atMs <= 0) return undefined
  const fields: Record<string, string> = {}
  for (const field of match[3].matchAll(/(?:^|\s)(\w+)=("[^"]*"|'[^']*'|[^\s]+)/g))
    fields[field[1]] = field[2].replace(/^["']|["']$/g, '')
  if (!/^\d+\.\d+$/.test(fields.turnStep ?? '')) return undefined
  return {
    atMs,
    fields,
    key: timingKey({
      agentId: fields.agentId || 'main',
      turnStep: fields.turnStep,
      attempt: fields.attempt || '',
    }),
  }
}

function rotationIndex(name: string): number {
  return Number(/\.(\d+)$/.exec(name)?.[1] ?? 0)
}

function timingKey(value: Pick<KimiTimingRequest, 'agentId' | 'turnStep' | 'attempt'>): string {
  return [value.agentId, value.turnStep, value.attempt].join('\u0000')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}

function nonnegativeNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === ''))
    return undefined
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : undefined
}
