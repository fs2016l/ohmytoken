import { readdirSync, statSync } from 'fs'
import { join, sep } from 'path'
import { readByteSnippet, readUtf8Lines } from '../lib/line-reader'
import type { TokenUsageApiCall } from './types'

interface RequestTiming {
  startedAtMs: number
  model: string
  requestIdentity: 'trace' | 'message'
  processId?: string
  firstTokenAtMs?: number
  timeToFirstTokenMs?: number
  conflicted?: boolean
}

interface GenerationSample extends RequestTiming {
  completedAtMs: number
  streamDurationMs: number
}

interface CachedLog {
  size: number
  mtimeMs: number
  birthtimeMs: number
  ino: number
  offset: number
  checkpoint?: { offset: number; length: number; text: string }
  prefix?: { length: number; text: string }
  requests: Map<string, RequestTiming>
  samples: Map<string, GenerationSample[]>
}

export interface WorkBuddyTimingIndex {
  files: string[]
  samples: ReadonlyMap<string, readonly GenerationSample[]>
}

const logCache = new Map<string, CachedLog>()

/** 日志只做可选计时证据：追加读取缓存，失效和半写不影响原来的 Token 采集。 */
export function readWorkBuddyGenerationTimings(
  directory: string,
  sinceMs?: number,
): WorkBuddyTimingIndex {
  const files = logFiles(directory)
  const presentFiles = new Set(files)
  for (const file of logCache.keys())
    if (file.startsWith(directory + sep) && !presentFiles.has(file)) logCache.delete(file)
  const samples = new Map<string, GenerationSample[]>()
  for (const file of files) {
    try {
      const stat = statSync(file)
      // 扫描线程可能每轮重建；冷缓存也只读窗口内改动的日志，不能全盘重解析历史。
      if (sinceMs !== undefined && stat.mtimeMs < sinceMs) continue
      let cached = logCache.get(file)
      if (
        !cached ||
        cached.ino !== stat.ino ||
        cached.birthtimeMs !== stat.birthtimeMs ||
        stat.size < cached.size ||
        (stat.size === cached.size && stat.mtimeMs !== cached.mtimeMs) ||
        (cached.prefix && readByteSnippet(file, 0, cached.prefix.length) !== cached.prefix.text) ||
        (cached.checkpoint &&
          readByteSnippet(file, cached.checkpoint.offset, cached.checkpoint.length) !==
            cached.checkpoint.text)
      )
        cached = {
          size: 0,
          mtimeMs: 0,
          birthtimeMs: stat.birthtimeMs,
          ino: stat.ino,
          offset: 0,
          requests: new Map(),
          samples: new Map(),
        }
      if (cached.size !== stat.size || cached.mtimeMs !== stat.mtimeMs) {
        const completeTail = stat.size > 0 && readByteSnippet(file, stat.size - 1, 1) === '\n'
        for (const line of readUtf8Lines(file, 64 * 1024, cached.offset, 16 * 1024)) {
          if (line.byteOffset + line.byteLength === stat.size && !completeTail) break
          cached.offset = line.byteOffset + line.byteLength
          if (!line.truncated) consumeTimingLine(line.line, cached)
        }
        cached.size = stat.size
        cached.mtimeMs = stat.mtimeMs
        cached.prefix = {
          length: Math.min(256, cached.offset),
          text: readByteSnippet(file, 0, Math.min(256, cached.offset)),
        }
        const checkpointOffset = Math.max(0, cached.offset - 256)
        cached.checkpoint = {
          offset: checkpointOffset,
          length: Math.min(256, cached.offset),
          text: readByteSnippet(file, checkpointOffset, Math.min(256, cached.offset)),
        }
        logCache.set(file, cached)
      }
      for (const [id, entries] of cached.samples) {
        const merged = samples.get(id) ?? []
        for (const sample of entries)
          if (!merged.some((previous) => JSON.stringify(previous) === JSON.stringify(sample)))
            merged.push(sample)
        samples.set(id, merged)
      }
    } catch {
      // 日志可能被关闭、轮转或删除，不能因此中断本地用量扫描。
    }
  }
  return { files, samples }
}

/** 新版逐调用 messageId、旧版 traceId + 首输出时间必须唯一指向完整原生流。 */
export function matchWorkBuddyGenerationTiming(
  index: WorkBuddyTimingIndex,
  root: Record<string, unknown>,
  providerData: Record<string, unknown>,
  recordedAtMs: number,
): TokenUsageApiCall['generationTiming'] {
  const model = text(providerData.model) || text(providerData.requestModelId)
  const messageId = text(providerData.messageId)
  const usage = providerData.usage as { requests?: unknown } | undefined
  if (
    !text(root.id) ||
    !model ||
    !messageId ||
    !Number.isSafeInteger(recordedAtMs) ||
    (usage?.requests !== undefined && usage.requests !== 1)
  )
    return undefined
  // 响应 ID 是不透明身份；gen-* 中的秒值不能当作本机 Sending request 的起点。
  // 新版 MODEL_REQUEST 的 requestId 是逐调用 messageId；转录在完成后落盘，
  // 不能再把转录 timestamp 当作首输出边界。同一 ID 有重试等多个流时拒绝关联。
  const messageSamples = (index.samples.get(messageId) ?? []).filter(
    (sample) => sample.requestIdentity === 'message',
  )
  let matches: readonly GenerationSample[]
  if (messageSamples.length) {
    if (messageSamples.length !== 1 || (root.status !== undefined && root.status !== 'completed'))
      return undefined
    matches = messageSamples.filter(
      (sample) => sample.model === model && recordedAtMs >= sample.firstTokenAtMs!,
    )
  } else {
    const requestId = text(providerData.traceId) || text(providerData.conversationRequestId)
    if (!requestId) return undefined
    matches = (index.samples.get(requestId) ?? []).filter(
      (sample) =>
        sample.requestIdentity === 'trace' &&
        sample.firstTokenAtMs === recordedAtMs &&
        sample.model === model,
    )
  }
  if (matches.length !== 1) return undefined
  const sample = matches[0]
  return {
    completedAtMs: sample.completedAtMs,
    timeToFirstTokenMs: sample.timeToFirstTokenMs,
    streamDurationMs: sample.streamDurationMs,
  }
}

function consumeTimingLine(line: string, state: CachedLog): void {
  if (!line.includes('[ModelProvider]')) return
  const parsed =
    /^\[(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})\.(\d{3})\]\s+\[Info\]\s+(?:\[pid=(\d+)\]\s+)?\[ModelProvider\]\s+(\[cbc-kw=MODEL_REQUEST\]\s+)?\[ModelProvider\]\s+(Sending request|First meaningful token received|Stream completed):\s+(.+)$/.exec(
      line,
    )
  if (!parsed) return
  const [, year, month, day, hour, minute, second, millisecond, pid, marker, kind, fields] = parsed
  // 原生日志采用本机日历时间，三个流边界来自同一客户端时钟。
  const atMs = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond),
  ).getTime()
  const id = /(?:^|,\s*)requestId=([\w-]+)(?:,|$)/.exec(fields)?.[1]
  if (!id || !Number.isSafeInteger(atMs)) return
  const requestKey = `${pid ?? ''}:${id}`
  const requestIdentity = marker ? 'message' : 'trace'
  if (kind === 'Sending request') {
    const model = /(?:^|,\s*)model=([^,]+)(?:,|$)/.exec(fields)?.[1]?.trim()
    if (!model) return
    const overlapping = state.requests.has(requestKey)
    state.requests.set(requestKey, {
      startedAtMs: atMs,
      model,
      requestIdentity,
      ...(pid ? { processId: pid } : {}),
      ...(overlapping ? { conflicted: true } : {}),
    })
    return
  }
  const request = state.requests.get(requestKey)
  if (!request) return
  if (request.requestIdentity !== requestIdentity) request.conflicted = true
  if (kind === 'First meaningful token received') {
    const ttft = /(?:^|,\s*)ttft=(\d+)ms(?:,|$)/.exec(fields)?.[1]
    if (
      request.firstTokenAtMs !== undefined ||
      ttft === undefined ||
      Math.abs(atMs - Number(ttft) - request.startedAtMs) > 5
    ) {
      request.conflicted = true
      return
    }
    request.firstTokenAtMs = atMs
    request.timeToFirstTokenMs = Number(ttft)
    return
  }
  state.requests.delete(requestKey)
  const elapsed = /(?:^|,\s*)elapsed=(\d+)ms(?:,|$)/.exec(fields)?.[1]
  if (
    request.conflicted ||
    request.firstTokenAtMs === undefined ||
    request.timeToFirstTokenMs === undefined ||
    elapsed === undefined ||
    Math.abs(atMs - Number(elapsed) - request.startedAtMs) > 5 ||
    atMs <= request.firstTokenAtMs ||
    Number(elapsed) <= request.timeToFirstTokenMs
  )
    return
  const entries = state.samples.get(id) ?? []
  entries.push({
    ...request,
    completedAtMs: atMs,
    streamDurationMs: Number(elapsed) - request.timeToFirstTokenMs,
  })
  state.samples.set(id, entries)
}

function logFiles(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory()
        ? logFiles(path)
        : entry.isFile() && entry.name.endsWith('.log')
          ? [path]
          : []
    })
  } catch {
    return []
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
