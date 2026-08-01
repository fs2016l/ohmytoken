/**
 * KimiWork Scanner（对应 Java KimiWorkScanner.java）
 *
 * 扫描 KimiWork sessions 目录下的 wire.jsonl，解析 type==usage.record 的用量。
 *
 * KimiWork 的 inputOther 与 inputCacheRead 独立，total 需要包含 cacheRead/cacheWrite：
 *   total = inputOther + output + cacheRead + cacheWrite
 *
 * 数据字段：
 *  - usage.inputOther          → inputTokens
 *  - usage.output              → outputTokens
 *  - usage.inputCacheRead      → cacheReadTokens
 *  - usage.inputCacheCreation  → cacheWriteTokens
 */
import { readdirSync, readFileSync, existsSync } from 'fs'
import { basename, dirname, join, relative, sep } from 'path'
import type { Dirent } from 'fs'
import type {
  AgentScanner,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  ScannerScanContext,
} from './types'
import { readUtf8Lines } from '../lib/line-reader'
import { getKimiWorkSessionsSources, type KimiWorkSessionsSource } from '../lib/paths'
import { formatDateFromMs } from '../lib/date-utils'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'

interface ParsedKimiSession {
  sessionId: string
  title: string
  apiCalls: TokenUsageApiCall[]
}

/** 由 state.json 解析出的会话身份（sessionId 与首选标题） */
interface ResolvedKimiSession {
  sessionId: string
  stateTitle: string
}

export class KimiWorkScanner implements AgentScanner {
  readonly agentName = 'kimiwork'

  isAvailable(): boolean {
    return getKimiWorkSessionsSources().some((source) => existsSync(source.dir))
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    if (!this.isAvailable()) return { records, sessions: [], apiCalls }

    const titleBySessionId = new Map<string, string>()
    for (const source of getKimiWorkSessionsSources().filter((candidate) =>
      existsSync(candidate.dir),
    )) {
      const wireFiles = listWireJsonlFiles(source.dir).filter((file) =>
        shouldScanFile(file, scanContext),
      )
      for (const file of wireFiles) {
        const resolved = resolveKimiSessionMeta(file, source)
        if (resolved === null) continue
        const parsed = this.parseWireFile(file, source.dir, resolved, scanContext)
        if (parsed.title) titleBySessionId.set(parsed.sessionId, parsed.title)
        apiCalls.push(...parsed.apiCalls)
      }
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(sessions, titleBySessionId)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))

    return { records, sessions, apiCalls }
  }

  private parseWireFile(
    file: string,
    sessionsDir: string,
    resolved: ResolvedKimiSession,
    context: ScannerScanContext,
  ): ParsedKimiSession {
    const apiCalls: TokenUsageApiCall[] = []
    const sessionId = resolved.sessionId
    let sessionTitle = ''
    try {
      for (const { line, lineIndex } of readUtf8Lines(file)) {
        if (line.length === 0) continue
        if (!line.includes('usage.record') && !mayContainSessionTitle(line)) continue
        let obj: unknown
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }
        if (!isObject(obj)) continue
        sessionTitle = keepFirstSessionTitle(sessionTitle, extractKimiTitle(obj))
        if (obj.type !== 'usage.record') continue

        const model: string = typeof obj.model === 'string' ? obj.model : 'unknown'
        const time = toLong(obj.time)
        if (time <= 0) continue

        const date = formatDateFromMs(time)
        const { timestamp, rawTimestamp } = timestampsFromValue(time, date)

        const usage = obj.usage
        if (!isObject(usage)) continue
        const inputOther = toLong(usage.inputOther)
        const output = toLong(usage.output)
        const cacheRead = toLong(usage.inputCacheRead)
        const cacheWrite = toLong(usage.inputCacheCreation)

        const sourceId =
          typeof obj.id === 'string' && obj.id.length > 0
            ? obj.id
            : `${relative(sessionsDir, file).split(sep).join('/')}:${lineIndex}:${time}`

        const apiCall: TokenUsageApiCall = {
          agent: this.agentName,
          apiCallId: sourceId,
          sessionId,
          date,
          rawTimestamp,
          timestamp,
          hour: hourFromTimestamp(timestamp),
          model,
          inputTokens: inputOther,
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          // inputOther 与 inputCacheRead 独立，total 包含 cacheRead/cacheWrite
          totalTokens: inputOther + output + cacheRead + cacheWrite,
          reasoningTokens: 0,
        }
        // wire.jsonl 可能长期追加；边读边丢弃窗口外调用，内存只随本次窗口增长。
        if (isApiCallInWindow(apiCall, context)) apiCalls.push(apiCall)
      }
    } catch (e) {
      throw new Error(`Kimi Work 会话文件不可读 (${file}): ${(e as Error).message}`)
    }
    const title = hasText(resolved.stateTitle) ? resolved.stateTitle : sessionTitle
    return { sessionId, title, apiCalls }
  }
}

/** 将可能是 number/string 的值转为整数（对应 Java asLong(0)） */
function toLong(v: unknown): number {
  if (typeof v === 'number') return Math.trunc(v) || 0
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractKimiTitle(obj: Record<string, unknown>): string {
  if (obj.type === 'turn.prompt') return textFromContent(obj.input)

  if (obj.type !== 'context.append_message') return ''
  const msg = isObject(obj.message) ? obj.message : null
  if (msg === null || msg.role !== 'user') return ''
  return textFromContent(msg.content)
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) return item.trim()
    if (isObject(item) && typeof item.text === 'string' && item.text.trim()) return item.text.trim()
  }
  return ''
}

function keepFirstSessionTitle(current: string, next: string): string {
  return current || next
}

function mayContainSessionTitle(line: string): boolean {
  return line.includes('turn.prompt') || line.includes('context.append_message')
}

/** 递归收集目录下所有名为 wire.jsonl 的文件 */
function listWireJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      const scope = isRoot ? 'sessions 目录' : `子目录 (${dir})`
      throw new Error(`Kimi Work ${scope}不可读: ${(e as Error).message}`)
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name === 'wire.jsonl') {
        out.push(full)
      }
    }
  }
  walk(root, true)
  return out.sort()
}

/** KimiWork state.json 中影响扫描决策的字段 */
interface KimiStateMeta {
  title: string
  conversationKey: string
  sessionKind: string
}

/** 仅放行用户可见的 conversation 会话；conversation-title 等辅助会话需剔除 */
const KIMI_ALLOWED_SESSION_KIND = 'conversation'

/**
 * 从 wire.jsonl 逐级向上定位所属会话目录及其 state.json。
 * 真实形态下 state.json 位于会话根目录，即在 wire.jsonl 上方约 2 层处。
 * 找不到（旧扁平 fixture 无 state.json）时退回 wire.jsonl 直接父目录。
 */
function findKimiSessionDir(
  file: string,
  sessionsDir: string,
): { sessionDir: string; statePath: string | null } {
  let dir = dirname(file)
  while (dir !== sessionsDir && dirname(dir) !== dir) {
    const candidate = join(dir, 'state.json')
    if (existsSync(candidate)) {
      return { sessionDir: dir, statePath: candidate }
    }
    dir = dirname(dir)
  }
  return { sessionDir: dirname(file), statePath: null }
}

/** 读取并解析 state.json；半写 JSON 可回退，实际 I/O 失败必须中止本 Agent 提交。 */
function readKimiState(statePath: string): KimiStateMeta | null {
  let text: string
  try {
    text = readFileSync(statePath, 'utf8')
  } catch (e) {
    throw new Error(`Kimi Work state 文件不可读 (${statePath}): ${(e as Error).message}`)
  }
  let obj: unknown
  try {
    obj = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(obj)) return null
  const custom = isObject(obj.custom) ? obj.custom : null
  const sessionKind =
    custom !== null && typeof custom.sessionKind === 'string' ? custom.sessionKind.trim() : ''
  const conversationKey =
    custom !== null && typeof custom.conversationKey === 'string'
      ? custom.conversationKey.trim()
      : ''
  const title = typeof obj.title === 'string' ? obj.title.trim() : ''
  return { title, conversationKey, sessionKind }
}

function conversationDirSessionId(sessionDir: string): string {
  const dirName = basename(sessionDir)
  return dirName.startsWith('conv-') ? dirName : ''
}

/**
 * 解析单个 wire.jsonl 对应的会话身份：
 *  - state.json 存在且 sessionKind !== conversation → 返回 null（剔除标题辅助会话等）
 *  - state.json 存在且 sessionKind === conversation → sessionId 取 custom.conversationKey，缺失时回退 conv-* 目录名
 *  - 无 state.json（旧扁平 fixture）→ 沿用 basename(dirname(file)) 作为 sessionId
 */
function resolveKimiSessionMeta(
  file: string,
  source: KimiWorkSessionsSource,
): ResolvedKimiSession | null {
  const sessionsDir = source.dir
  const { sessionDir, statePath } = findKimiSessionDir(file, sessionsDir)
  if (statePath === null) {
    const fallbackId =
      basename(dirname(file)) || relative(sessionsDir, dirname(file)).split(sep).join('/')
    return { sessionId: fallbackId, stateTitle: '' }
  }

  const state = readKimiState(statePath)
  if (state === null) {
    const fallbackId =
      source.kind === 'kimi-cli' ? basename(sessionDir) : conversationDirSessionId(sessionDir)
    if (!fallbackId) return null
    return { sessionId: fallbackId, stateTitle: '' }
  }

  if (source.kind === 'kimi-cli') {
    const sessionId = basename(sessionDir)
    if (!sessionId) return null
    return { sessionId, stateTitle: state.title }
  }

  if (state.sessionKind !== KIMI_ALLOWED_SESSION_KIND) return null

  const fallbackId = conversationDirSessionId(sessionDir)
  const sessionId = state.conversationKey.length > 0 ? state.conversationKey : fallbackId
  if (!sessionId) return null
  return { sessionId, stateTitle: state.title }
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}
