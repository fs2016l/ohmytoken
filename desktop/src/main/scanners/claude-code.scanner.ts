/**
 * Claude Code Scanner（对应 Java ClaudeCodeScanner.java）
 *
 * 扫描 ~/.claude/projects 目录下所有 .jsonl，按 type==assistant 的 message.usage 聚合 token。
 * - Anthropic API 的 4 个 token 字段互斥：total = input + output + cacheRead + cacheWrite
 * - 按 message.id 去重（同一消息可能被多个 jsonl 引用）
 * - "<synthetic>" 模型、input/output 均为 0 的记录会被过滤
 */
import { readdirSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import type {
  AgentScanner,
  ScannerUsageDetails,
  TokenUsageApiCall,
  TokenUsageRecord,
  ScannerScanContext,
} from './types'
import { readUtf8Lines } from '../lib/line-reader'
import { getClaudeProjectsDir } from '../lib/paths'
import { extractDate } from '../lib/date-utils'
import {
  applySessionTitles,
  buildRecordsFromSessions,
  buildSessionsFromApiCalls,
  dateFromTimestamp,
  hourFromTimestamp,
  timestampsFromValue,
} from './detail-utils'
import { isApiCallInWindow, normalizeScanContext, shouldScanFile } from './incremental-utils'
import { extractProjectPath } from './project-path'

export class ClaudeCodeScanner implements AgentScanner {
  readonly agentName = 'claude-code'

  isAvailable(): boolean {
    const dir = getClaudeProjectsDir()
    try {
      if (!statSync(dir).isDirectory()) return false
    } catch {
      return false
    }
    // 任意一个 .jsonl 存在即视为可用
    return listJsonlFiles(dir).length > 0
  }

  async scan(context?: ScannerScanContext): Promise<TokenUsageRecord[]> {
    return (await this.scanDetailed(context)).records
  }

  async scanDetailed(context?: ScannerScanContext): Promise<ScannerUsageDetails> {
    const scanContext = normalizeScanContext(context)
    const records: TokenUsageRecord[] = []
    const apiCalls: TokenUsageApiCall[] = []
    const projectsDir = getClaudeProjectsDir()

    let isDir = false
    try {
      isDir = statSync(projectsDir).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) return { records, sessions: [], apiCalls }

    const jsonlFiles = listJsonlFiles(projectsDir).filter((file) =>
      shouldScanFile(file, scanContext),
    )

    const seenIds = new Set<string>()
    const titleBySessionId = new Map<string, string>()

    for (const file of jsonlFiles) {
      let fileScopedTitle = ''
      let fileScopedTitleFromSummary = false
      let explicitSessionId = ''
      let fileScopedProjectPath = ''
      try {
        for (const { line, lineIndex } of readUtf8Lines(file)) {
          const hasTokenUsage = line.includes('input_tokens') || line.includes('output_tokens')
          if (!hasTokenUsage && !mayContainSessionTitle(line)) {
            continue
          }
          let obj: unknown
          try {
            obj = JSON.parse(line)
          } catch {
            continue
          }
          if (!isObject(obj)) continue
          fileScopedProjectPath = fileScopedProjectPath || extractProjectPath(obj) || ''

          const sessionId = sessionIdFromObject(obj, file, projectsDir)
          if (hasExplicitSessionId(obj) && !explicitSessionId) explicitSessionId = sessionId
          const title = extractClaudeTitle(obj)
          if (title) {
            if (hasExplicitSessionId(obj)) {
              setSessionTitle(titleBySessionId, sessionId, title, obj.type === 'summary')
            } else if (obj.type === 'summary' || !fileScopedTitle) {
              fileScopedTitle = title
              fileScopedTitleFromSummary = obj.type === 'summary'
            }
          }

          if (obj.type !== 'assistant') continue

          const msg = obj.message
          if (!isObject(msg)) continue
          const usage = msg.usage
          if (!isObject(usage)) continue

          const model: string = typeof msg.model === 'string' ? msg.model : 'unknown'
          if (model === '<synthetic>') continue

          const input = toLong(usage.input_tokens)
          const output = toLong(usage.output_tokens)
          if (input === 0 && output === 0) continue

          const cacheRead = toLong(usage.cache_read_input_tokens)
          const cacheWrite = toLong(usage.cache_creation_input_tokens)

          const rawTimestamp =
            typeof obj.timestamp === 'string' || typeof obj.timestamp === 'number'
              ? obj.timestamp
              : undefined
          const messageCreatedAt = typeof msg.created_at === 'string' ? msg.created_at : undefined
          const fallbackDate = extractDate(rawTimestamp, messageCreatedAt)
          const { timestamp, rawTimestamp: sourceTimestamp } = timestampsFromValue(
            rawTimestamp ?? messageCreatedAt,
            fallbackDate,
          )
          const msgId: string = typeof msg.id === 'string' ? msg.id : ''
          const apiCallId = msgId || `${sessionId}:${lineIndex}`

          const apiCall: TokenUsageApiCall = {
            agent: this.agentName,
            apiCallId,
            sessionId,
            ...(fileScopedProjectPath ? { projectPath: fileScopedProjectPath } : {}),
            date: dateFromTimestamp(timestamp, fallbackDate),
            rawTimestamp: sourceTimestamp,
            timestamp,
            hour: hourFromTimestamp(timestamp),
            model,
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            // Anthropic API: 4 字段互斥，total = 全部相加
            totalTokens: input + output + cacheRead + cacheWrite,
            reasoningTokens: 0,
          }
          // 大型活跃 JSONL 仍需从头流式读取以提取标题与稳定行号，但窗口外明细
          // 在解析当下就丢弃，避免先构造整段历史 API 数组再二次过滤。
          if (!isApiCallInWindow(apiCall, scanContext)) continue

          // 只让窗口内调用参与去重；否则同 ID 的窗口外历史副本可能先占位，
          // 错误压掉后续窗口内的更新副本。
          if (msgId) {
            if (seenIds.has(msgId)) continue
            seenIds.add(msgId)
          }
          apiCalls.push(apiCall)
        }
      } catch (e) {
        throw new Error(`Claude Code 会话文件不可读 (${file}): ${(e as Error).message}`)
      }
      if (fileScopedTitle) {
        const fallbackSessionId = relative(projectsDir, file).split(sep).join('/')
        setSessionTitle(
          titleBySessionId,
          explicitSessionId || fallbackSessionId,
          fileScopedTitle,
          fileScopedTitleFromSummary,
        )
      }
    }

    const sessions = buildSessionsFromApiCalls(this.agentName, apiCalls)
    applySessionTitles(sessions, titleBySessionId)
    records.push(...buildRecordsFromSessions(this.agentName, sessions))

    return { records, sessions, apiCalls }
  }
}

/** 将可能是 number/string 的值转为整数（对应 Java JsonNode.asLong(0)） */
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

function sessionIdFromObject(
  obj: Record<string, unknown>,
  file: string,
  projectsDir: string,
): string {
  return hasExplicitSessionId(obj)
    ? (obj.sessionId as string)
    : relative(projectsDir, file).split(sep).join('/')
}

function hasExplicitSessionId(obj: Record<string, unknown>): boolean {
  return typeof obj.sessionId === 'string' && obj.sessionId.length > 0
}

function mayContainSessionTitle(line: string): boolean {
  return (
    line.includes('"summary"') ||
    line.includes('"lastPrompt"') ||
    line.includes('"type":"user"') ||
    line.includes('"type": "user"') ||
    line.includes('"type":"last-prompt"') ||
    line.includes('"type": "last-prompt"')
  )
}

function extractClaudeTitle(obj: Record<string, unknown>): string {
  if (obj.type === 'summary') return readString(obj.summary)
  if (obj.type === 'last-prompt') return readString(obj.lastPrompt) || readString(obj.content)

  const msg = isObject(obj.message) ? obj.message : null
  const isUserMessage = obj.type === 'user' || msg?.role === 'user'
  if (!isUserMessage || msg === null) return ''
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

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function setSessionTitle(
  titleBySessionId: Map<string, string>,
  sessionId: string,
  title: string,
  replace = false,
): void {
  if (!title || (!replace && titleBySessionId.has(sessionId))) return
  titleBySessionId.set(sessionId, title)
}

/** 递归收集目录下所有 .jsonl 文件（按路径排序，保证遍历顺序稳定） */
function listJsonlFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, isRoot = false): void => {
    let entries: import('fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (e) {
      const scope = isRoot ? 'projects 目录' : `子目录 (${dir})`
      throw new Error(`Claude Code ${scope}不可读: ${(e as Error).message}`)
    }
    for (const e of entries) {
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        out.push(full)
      }
    }
  }
  walk(root, true)
  // 用平台分隔符排序，与 Java Path 自然顺序对齐
  return out.sort((a, b) => a.split(sep).join('/').localeCompare(b.split(sep).join('/')))
}
