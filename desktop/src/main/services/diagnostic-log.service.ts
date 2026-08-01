import { createHash } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron'
import type {
  DiagnosticErrorPayload,
  DiagnosticUploadOptions,
  DiagnosticManualUploadResult,
  DiagnosticUploadResult,
  DiagnosticUploadState,
} from '../../shared/diagnostics'
import type { AgentRequestIdentity } from '../../shared/agent-client'
import { agentIdentityHeaders } from '../../shared/agent-client'
import { IPC } from '../ipc/channels'
import { getAccessToken } from './auth.service'
import { ensureAgentClientRegistered } from './client-registration.service'
import {
  redactDiagnosticText as redactText,
  type DiagnosticRedactionOptions,
} from './diagnostic-redaction'
import { getOhmytokenApiBase } from './server-config.service'

const API_BASE = getOhmytokenApiBase()
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024
const MAX_MANUAL_UPLOAD_LOG_BYTES = MAX_LOG_FILE_BYTES
const ROTATED_FILE_COUNT = 3
const AUTO_UPLOAD_DEDUPE_MS = 6 * 60 * 60 * 1_000
const AUTO_UPLOAD_RETRY_MS = 10 * 60 * 1_000
const AUTO_STACK_FRAME_LIMIT = 5
const DIAGNOSTIC_UPLOAD_STATE_VERSION = 1
const MAX_AUTOMATIC_UPLOAD_QUEUE = 20
const MAX_AUTOMATIC_DEDUPE_ENTRIES = 512

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'
type MainWindowGetter = () => BrowserWindow | null

interface ReportOptions {
  autoUpload?: boolean
  persistPending?: boolean
}

interface StoredPendingError extends DiagnosticErrorPayload {
  fingerprint: string
}

interface StoredDiagnosticUploadState extends DiagnosticUploadState {
  version: typeof DIAGNOSTIC_UPLOAD_STATE_VERSION
  revision: number
}

let logDirectory: string | null = null
let logFile: string | null = null
let currentLogBytes = 0
let initialized = false
let consoleInstalled = false
let globalHandlersInstalled = false
let getMainWindow: MainWindowGetter = () => null
let lastError: DiagnosticErrorPayload | null = null
let diagnosticUploadState: StoredDiagnosticUploadState = createDefaultDiagnosticUploadState()
let diagnosticUploadPromise: Promise<DiagnosticUploadResult> | null = null
const preInitEntries: string[] = []

const automaticUploadTimestamps = new Map<string, number>()
let automaticUploadQueue: Promise<void> = Promise.resolve()
let automaticUploadPendingCount = 0
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
}

function getPendingFile(): string | null {
  return logDirectory ? join(logDirectory, 'pending-error.json') : null
}

function getDiagnosticUploadStateFile(): string | null {
  return logDirectory ? join(logDirectory, 'diagnostic-upload-state.json') : null
}

function createDefaultDiagnosticUploadState(): StoredDiagnosticUploadState {
  return {
    version: DIAGNOSTIC_UPLOAD_STATE_VERSION,
    revision: 1,
    canUpload: true,
  }
}

function readDiagnosticUploadState(): StoredDiagnosticUploadState {
  const file = getDiagnosticUploadStateFile()
  if (!file || !existsSync(file)) return createDefaultDiagnosticUploadState()

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as Partial<StoredDiagnosticUploadState>
    if (
      parsed.version !== DIAGNOSTIC_UPLOAD_STATE_VERSION ||
      !Number.isSafeInteger(parsed.revision) ||
      Number(parsed.revision) < 1 ||
      typeof parsed.canUpload !== 'boolean'
    ) {
      return createDefaultDiagnosticUploadState()
    }

    if (parsed.canUpload) {
      return {
        version: DIAGNOSTIC_UPLOAD_STATE_VERSION,
        revision: Number(parsed.revision),
        canUpload: true,
      }
    }

    if (
      !Number.isSafeInteger(parsed.uploadedReportId) ||
      Number(parsed.uploadedReportId) < 1 ||
      !Number.isFinite(parsed.uploadedAt) ||
      Number(parsed.uploadedAt) <= 0
    ) {
      return createDefaultDiagnosticUploadState()
    }

    return {
      version: DIAGNOSTIC_UPLOAD_STATE_VERSION,
      revision: Number(parsed.revision),
      canUpload: false,
      uploadedReportId: Number(parsed.uploadedReportId),
      uploadedAt: Number(parsed.uploadedAt),
    }
  } catch {
    return createDefaultDiagnosticUploadState()
  }
}

function persistDiagnosticUploadState(): void {
  const file = getDiagnosticUploadStateFile()
  if (!file) return
  const tempFile = `${file}.tmp`
  const serialized = JSON.stringify(diagnosticUploadState)

  try {
    writeFileSync(tempFile, serialized, 'utf-8')
    try {
      renameSync(tempFile, file)
    } catch {
      writeFileSync(file, serialized, 'utf-8')
      try {
        unlinkSync(tempFile)
      } catch {
        void 0
      }
    }
  } catch {
    void 0
  }
}

export function getDiagnosticUploadState(): DiagnosticUploadState {
  return {
    canUpload: diagnosticUploadState.canUpload,
    ...(diagnosticUploadState.uploadedReportId === undefined
      ? {}
      : { uploadedReportId: diagnosticUploadState.uploadedReportId }),
    ...(diagnosticUploadState.uploadedAt === undefined
      ? {}
      : { uploadedAt: diagnosticUploadState.uploadedAt }),
  }
}

function notifyDiagnosticUploadStateChanged(): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(IPC.DIAGNOSTICS_UPLOAD_STATE_CHANGED, getDiagnosticUploadState())
}

function markDiagnosticUploadAvailable(): void {
  diagnosticUploadState = {
    version: DIAGNOSTIC_UPLOAD_STATE_VERSION,
    revision: diagnosticUploadState.revision + 1,
    canUpload: true,
  }
  persistDiagnosticUploadState()
  notifyDiagnosticUploadStateChanged()
}

function markDiagnosticUploaded(reportId: number, revision: number): boolean {
  if (diagnosticUploadState.revision !== revision) return false
  diagnosticUploadState = {
    version: DIAGNOSTIC_UPLOAD_STATE_VERSION,
    revision,
    canUpload: false,
    uploadedReportId: reportId,
    uploadedAt: Date.now(),
  }
  persistDiagnosticUploadState()
  notifyDiagnosticUploadStateChanged()
  return true
}

function safeJson(value: unknown): string {
  if (value instanceof Error) {
    return JSON.stringify({ name: value.name, message: value.message, stack: value.stack })
  }
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function getDiagnosticRedactionOptions(): DiagnosticRedactionOptions {
  const appDirectories: string[] = []
  try {
    appDirectories.push(app.getAppPath())
  } catch {
    void 0
  }
  try {
    if (!app.isPackaged) appDirectories.push(process.cwd())
  } catch {
    void 0
  }
  return { homeDirectory: homedir(), appDirectories }
}

export function redactDiagnosticText(value: string): string {
  return redactText(value, getDiagnosticRedactionOptions())
}

const SENSITIVE_CONTEXT_KEYS = new Set([
  'authorization',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'token',
  'password',
  'passwd',
  'secret',
  'clientsecret',
  'apikey',
  'codeverifier',
  'codechallenge',
  'sessionid',
  'cookie',
  'setcookie',
  'privatekey',
  'deviceid',
  'userid',
  'username',
  'email',
])

function sanitizeDiagnosticValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactDiagnosticText(value)
  if (typeof value === 'bigint') return String(value)
  if (value === null || typeof value !== 'object') return value
  if (Buffer.isBuffer(value)) return `<BUFFER ${value.length} bytes>`
  if (depth >= 8) return '<TRUNCATED>'
  if (seen.has(value)) return '<CIRCULAR>'

  seen.add(value)
  try {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactDiagnosticText(value.message),
        stack: value.stack ? redactDiagnosticText(value.stack) : undefined,
      }
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeDiagnosticValue(item, depth + 1, seen))
    }

    const sanitized: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      const isStringAuthorizationValue =
        (normalizedKey === 'code' || normalizedKey === 'state') && typeof child === 'string'
      sanitized[key] =
        SENSITIVE_CONTEXT_KEYS.has(normalizedKey) || isStringAuthorizationValue
          ? '<REDACTED>'
          : sanitizeDiagnosticValue(child, depth + 1, seen)
    }
    return sanitized
  } finally {
    seen.delete(value)
  }
}

function rotateLogsIfNeeded(incomingBytes: number): void {
  if (!logFile || currentLogBytes + incomingBytes <= MAX_LOG_FILE_BYTES) return

  try {
    for (let index = ROTATED_FILE_COUNT; index >= 1; index--) {
      const source = index === 1 ? logFile : `${logFile}.${index - 1}`
      const target = `${logFile}.${index}`
      if (!existsSync(source)) continue
      if (existsSync(target)) unlinkSync(target)
      renameSync(source, target)
    }
    currentLogBytes = 0
  } catch {
    void 0
  }
}

function writeLine(line: string): void {
  const sanitized = redactDiagnosticText(line)
  const withNewline = `${sanitized}\n`

  if (!initialized || !logFile) {
    if (preInitEntries.length < 200) preInitEntries.push(withNewline)
    return
  }

  try {
    const bytes = Buffer.byteLength(withNewline)
    rotateLogsIfNeeded(bytes)
    appendFileSync(logFile, withNewline, 'utf-8')
    currentLogBytes += bytes
  } catch {
    void 0
  }
}

function formatLocalTimestamp(date = new Date()): string {
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absoluteOffset / 60)
  const offsetRemainder = absoluteOffset % 60

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${offsetSign}${pad(offsetHours)}:${pad(offsetRemainder)}`
  )
}

function writeEntry(
  level: LogLevel,
  source: string,
  event: string,
  message: string,
  details?: unknown,
): void {
  const entry = {
    timestamp: formatLocalTimestamp(),
    level,
    process: 'main',
    source,
    event,
    message: redactDiagnosticText(message),
    ...(details === undefined ? {} : { details: sanitizeDiagnosticValue(details) }),
  }
  writeLine(safeJson(entry))
}

function sanitizeConsoleArguments(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeDiagnosticValue(arg))
}

function consoleMessage(args: unknown[]): string {
  return args.map((arg) => safeJson(arg)).join(' ')
}

function installConsoleCapture(): void {
  if (consoleInstalled) return
  consoleInstalled = true

  console.log = (...args: unknown[]) => {
    const sanitized = sanitizeConsoleArguments(args)
    originalConsole.log(...sanitized)
    writeEntry('info', 'console', 'log', consoleMessage(sanitized))
  }
  console.info = (...args: unknown[]) => {
    const sanitized = sanitizeConsoleArguments(args)
    originalConsole.info(...sanitized)
    writeEntry('info', 'console', 'info', consoleMessage(sanitized))
  }
  console.warn = (...args: unknown[]) => {
    const sanitized = sanitizeConsoleArguments(args)
    originalConsole.warn(...sanitized)
    writeEntry('warn', 'console', 'warn', consoleMessage(sanitized))
  }
  console.error = (...args: unknown[]) => {
    const sanitized = sanitizeConsoleArguments(args)
    originalConsole.error(...sanitized)
    writeEntry('error', 'console', 'error', consoleMessage(sanitized))
  }
}

function normalizeError(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack }
  if (typeof reason === 'string') return { message: reason }
  return { message: safeJson(sanitizeDiagnosticValue(reason)) }
}

function fingerprint(error: DiagnosticErrorPayload): string {
  return createHash('sha256')
    .update(`${error.source}|${error.stage ?? ''}|${error.message}|${error.stack ?? ''}`)
    .digest('hex')
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeDiagnosticValue(context)
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>
  }
  return { value: sanitized }
}

function persistPendingError(error: DiagnosticErrorPayload): void {
  const pendingFile = getPendingFile()
  if (!pendingFile) return
  const stored: StoredPendingError = {
    ...error,
    message: redactDiagnosticText(error.message).slice(0, 4_000),
    stack: error.stack ? redactDiagnosticText(error.stack).slice(0, 128_000) : undefined,
    context: error.context ? sanitizeContext(error.context) : undefined,
    fingerprint: fingerprint(error),
  }
  try {
    writeFileSync(pendingFile, JSON.stringify(stored), 'utf-8')
  } catch {
    void 0
  }
}

function clearPendingError(expected?: DiagnosticErrorPayload): void {
  const pendingFile = getPendingFile()
  if (!pendingFile || !existsSync(pendingFile)) return
  try {
    if (expected) {
      const stored = JSON.parse(readFileSync(pendingFile, 'utf-8')) as StoredPendingError
      if (stored.fingerprint !== fingerprint(expected)) return
    }
    unlinkSync(pendingFile)
  } catch {
    void 0
  }
}

function readPendingError(): DiagnosticErrorPayload | null {
  const pendingFile = getPendingFile()
  if (!pendingFile || !existsSync(pendingFile)) return null
  try {
    const stored = JSON.parse(readFileSync(pendingFile, 'utf-8')) as StoredPendingError
    if (!stored || typeof stored.message !== 'string' || typeof stored.source !== 'string')
      return null
    const { fingerprint: _ignored, ...error } = stored
    return error
  } catch {
    return null
  }
}

function isChinese(): boolean {
  return app.getLocale().toLowerCase().startsWith('zh')
}

async function showMessage(options: MessageBoxOptions): Promise<number> {
  const win = getMainWindow()
  const result =
    win && !win.isDestroyed()
      ? await dialog.showMessageBox(win, options)
      : await dialog.showMessageBox(options)
  return result.response
}

export function registerGlobalDiagnosticHandlers(): void {
  if (globalHandlersInstalled) return
  globalHandlersInstalled = true

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    reportDiagnosticError(
      {
        reportType: 'crash',
        source: 'main',
        stage: `uncaught-exception:${origin}`,
        severity: 'fatal',
        summary: '主进程发生未捕获异常',
        message: error.message,
        stack: error.stack,
      },
      { autoUpload: true, persistPending: true },
    )
  })

  process.on('unhandledRejection', (reason) => {
    const normalized = normalizeError(reason)
    reportDiagnosticError(
      {
        reportType: 'crash',
        source: 'main',
        stage: 'unhandled-rejection',
        severity: 'error',
        summary: '主进程发生未处理的异步异常',
        message: normalized.message,
        stack: normalized.stack,
      },
      { autoUpload: true, persistPending: true },
    )
  })
}

export function initializeDiagnosticLogging(windowGetter: MainWindowGetter): void {
  if (initialized) return
  getMainWindow = windowGetter
  logDirectory = join(app.getPath('userData'), 'logs')
  logFile = join(logDirectory, 'agent.log')

  try {
    mkdirSync(logDirectory, { recursive: true })
    currentLogBytes = existsSync(logFile) ? statSync(logFile).size : 0
  } catch {
    logDirectory = null
    logFile = null
  }

  diagnosticUploadState = readDiagnosticUploadState()
  initialized = true
  installConsoleCapture()
  for (const entry of preInitEntries.splice(0)) writeLine(entry.trimEnd())

  recordDiagnosticEvent('app', 'started', '应用启动')

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    reportDiagnosticError(
      {
        reportType: 'crash',
        source: 'electron-child',
        stage: details.type,
        severity: details.reason === 'crashed' ? 'fatal' : 'error',
        summary: 'Electron 子进程异常退出',
        message: `${details.type} process ${details.reason} (exitCode=${details.exitCode})`,
        context: {
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
          serviceName: details.serviceName,
          name: details.name,
        },
      },
      { autoUpload: true, persistPending: true },
    )
  })

  const pending = readPendingError()
  if (pending) {
    lastError = pending
  }
  if (lastError) {
    markDiagnosticUploadAvailable()
  }
  if (pending) {
    setTimeout(() => scheduleAutomaticUpload(pending), 1_500)
  }
}

export function recordDiagnosticEvent(
  source: string,
  event: string,
  message: string,
  details?: unknown,
): void {
  writeEntry('info', source, event, message, details)
}

export function reportDiagnosticError(
  error: DiagnosticErrorPayload,
  options: ReportOptions = {},
): void {
  const normalized: DiagnosticErrorPayload = {
    ...error,
    reportType: error.reportType ?? 'crash',
    source: redactDiagnosticText(error.source).slice(0, 64),
    stage: error.stage ? redactDiagnosticText(error.stage).slice(0, 64) : undefined,
    severity: error.severity ?? 'error',
    occurredAt: error.occurredAt ?? Date.now(),
    summary: error.summary ? redactDiagnosticText(error.summary).slice(0, 500) : undefined,
    message: redactDiagnosticText(error.message).slice(0, 4_000),
    stack: error.stack ? redactDiagnosticText(error.stack).slice(0, 128_000) : undefined,
    context: error.context ? sanitizeContext(error.context) : undefined,
  }
  lastError = normalized
  markDiagnosticUploadAvailable()
  writeEntry(
    normalized.severity === 'fatal' ? 'fatal' : 'error',
    normalized.source,
    normalized.stage ?? 'runtime',
    normalized.message,
    { stack: normalized.stack, context: normalized.context },
  )

  if (options.persistPending) persistPendingError(normalized)
  if (shouldAutomaticallyUpload(normalized, options)) scheduleAutomaticUpload(normalized)
}

type DiagnosticUploadMode = 'automatic' | 'manual'

function readFullCurrentLog(): string {
  if (!logFile || !existsSync(logFile)) return ''
  try {
    const data = readFileSync(logFile)
    const start = Math.max(0, data.length - MAX_MANUAL_UPLOAD_LOG_BYTES)
    return redactDiagnosticText(data.subarray(start).toString('utf-8'))
  } catch {
    return ''
  }
}

function automaticSummary(error: DiagnosticErrorPayload): string {
  switch (error.reportType) {
    case 'renderer':
      return '自动诊断：界面运行异常'
    case 'update':
      return '自动诊断：应用更新异常'
    default:
      return '自动诊断：应用进程异常'
  }
}

function minimizeAutomaticStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined
  const frames = stack
    .split(/\r?\n/)
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, AUTO_STACK_FRAME_LIMIT)
    .map((line) =>
      redactDiagnosticText(line)
        .replace(/[A-Za-z]:[\\/][^():\r\n]+/g, '<PATH>')
        .replace(/\/(?:Users|home|tmp|var|opt|mnt|workspace)(?:\/[^():\s]+)+/g, '<PATH>')
        .replace(/[?#][^\s)]+/g, ''),
    )
  return frames.length > 0 ? frames.join('\n').slice(0, 8_192) : undefined
}

function automaticContext(error: DiagnosticErrorPayload): Record<string, unknown> {
  const context = error.context ? sanitizeContext(error.context) : {}
  const safeContext: Record<string, unknown> = {
    uploadMode: 'automatic',
    fingerprint: fingerprint(error),
  }
  for (const key of ['type', 'reason', 'exitCode', 'errorCode', 'statusCode']) {
    const value = context[key]
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      (typeof value === 'string' && value.length <= 128)
    ) {
      safeContext[key] = value
    }
  }
  return safeContext
}

function shouldAutomaticallyUpload(error: DiagnosticErrorPayload, options: ReportOptions): boolean {
  const eligibleType =
    error.reportType === 'crash' || error.reportType === 'renderer' || error.reportType === 'update'
  const enabled = options.autoUpload ?? eligibleType
  return enabled && eligibleType && error.severity !== 'warning'
}

function scheduleAutomaticUpload(error: DiagnosticErrorPayload): void {
  if (!initialized || !shouldAutomaticallyUpload(error, { autoUpload: true })) return

  const key = fingerprint(error)
  const now = Date.now()
  const lastUploadedAt = automaticUploadTimestamps.get(key) ?? 0
  if (now - lastUploadedAt < AUTO_UPLOAD_DEDUPE_MS) return

  for (const [storedKey, storedAt] of automaticUploadTimestamps) {
    if (now - storedAt >= AUTO_UPLOAD_DEDUPE_MS) automaticUploadTimestamps.delete(storedKey)
  }
  while (automaticUploadTimestamps.size >= MAX_AUTOMATIC_DEDUPE_ENTRIES) {
    const oldest = automaticUploadTimestamps.keys().next().value
    if (typeof oldest !== 'string') break
    automaticUploadTimestamps.delete(oldest)
  }
  if (automaticUploadPendingCount >= MAX_AUTOMATIC_UPLOAD_QUEUE) {
    writeEntry(
      'warn',
      'diagnostics',
      'automatic-upload-dropped',
      '自动诊断队列已满，本次异常仅保留在本地日志',
    )
    return
  }

  automaticUploadTimestamps.set(key, now)
  automaticUploadPendingCount += 1
  automaticUploadQueue = automaticUploadQueue
    .then(async () => {
      try {
        await sendDiagnosticReport('automatic', {}, error)
        clearPendingError(error)
      } catch (uploadError) {
        automaticUploadTimestamps.set(
          key,
          Date.now() - AUTO_UPLOAD_DEDUPE_MS + AUTO_UPLOAD_RETRY_MS,
        )
        const normalized = normalizeError(uploadError)
        writeEntry(
          'warn',
          'diagnostics',
          'automatic-upload-failed',
          '自动诊断上报失败，将在后续同类异常或下次启动时重试',
          { reason: normalized.message },
        )
      }
    })
    .finally(() => {
      automaticUploadPendingCount = Math.max(0, automaticUploadPendingCount - 1)
    })
}

function buildDiagnosticReportBody(
  mode: DiagnosticUploadMode,
  options: DiagnosticUploadOptions,
  error: DiagnosticErrorPayload,
): Record<string, unknown> {
  if (mode === 'automatic') {
    const context = automaticContext(error)
    return {
      reportType: error.reportType ?? 'crash',
      source: error.source.slice(0, 64),
      stage: (error.stage ?? 'runtime').slice(0, 64),
      severity: error.severity ?? 'error',
      summary: automaticSummary(error),
      errorMessage: `Automatic diagnostic fingerprint: ${String(context.fingerprint)}`,
      stackTrace: minimizeAutomaticStack(error.stack),
      contextJson: safeJson(context),
      occurredAt: error.occurredAt ?? Date.now(),
    }
  }

  const manualContext = sanitizeDiagnosticValue({
    ...(error.context ?? {}),
    originalReportType: error.reportType,
    originalSource: error.source,
    originalStage: error.stage,
    ...(options.note ? { userNote: options.note.slice(0, 2_000) } : {}),
    uploadMode: 'manual',
  })

  return {
    reportType: options.reportType ?? 'manual',
    source: (options.source ?? 'settings').slice(0, 64),
    stage: (options.stage ?? 'manual').slice(0, 64),
    severity: error.severity ?? 'error',
    summary: redactDiagnosticText(options.summary ?? '用户手动上传诊断日志').slice(0, 500),
    errorMessage: redactDiagnosticText(error.message).slice(0, 4_000),
    stackTrace: error.stack ? redactDiagnosticText(error.stack).slice(0, 128_000) : undefined,
    logContent: readFullCurrentLog(),
    contextJson: redactDiagnosticText(safeJson(manualContext)).slice(0, 65_535),
    occurredAt: error.occurredAt ?? Date.now(),
  }
}

async function sendDiagnosticReport(
  mode: DiagnosticUploadMode,
  options: DiagnosticUploadOptions,
  error: DiagnosticErrorPayload,
  uploadRevision?: number,
): Promise<DiagnosticUploadResult> {
  const body = buildDiagnosticReportBody(mode, options, error)
  const token = await getAccessToken().catch(() => null)
  const identity = await ensureAgentClientRegistered(token)

  recordDiagnosticEvent(
    'diagnostics',
    `${mode}-upload-started`,
    mode === 'manual' ? '用户确认上传诊断日志' : '静默上传最小诊断事件',
    {
      reportType: body.reportType,
      stage: body.stage,
    },
  )

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), mode === 'manual' ? 60_000 : 15_000)
  try {
    const send = (authorization: string | undefined, requestIdentity: AgentRequestIdentity) =>
      fetch(`${API_BASE}/desktop/diagnostic-report/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...agentIdentityHeaders(requestIdentity),
          ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

    let response = await send(token ?? undefined, identity)
    if (response.status === 401 && token) {
      recordDiagnosticEvent(
        'diagnostics',
        'anonymous-retry',
        `${mode === 'manual' ? '手动' : '自动'}诊断上报登录态失效，匿名重试`,
      )
      response = await send(undefined, await ensureAgentClientRegistered(null))
    }

    const responseText = await response.text()
    if (!response.ok) {
      throw new Error(
        `${mode === 'manual' ? '诊断日志' : '自动诊断'}上传失败 (HTTP ${response.status})`,
      )
    }

    const result = JSON.parse(responseText) as {
      code?: number
      message?: string
      data?: number | { id?: number }
    }
    const id = typeof result.data === 'number' ? result.data : result.data?.id
    if (result.code !== 200 || typeof id !== 'number') {
      throw new Error(
        mode === 'manual' ? '诊断日志上传失败：响应格式无效' : '自动诊断上传失败：响应格式无效',
      )
    }

    recordDiagnosticEvent(
      'diagnostics',
      `${mode}-upload-completed`,
      mode === 'manual' ? '诊断日志上传成功' : '最小诊断事件上传成功',
      { id },
    )
    if (mode === 'manual' && uploadRevision !== undefined) {
      if (markDiagnosticUploaded(id, uploadRevision)) clearPendingError()
    }
    return { id }
  } finally {
    clearTimeout(timeout)
  }
}

function manualUploadError(): DiagnosticErrorPayload {
  return (
    lastError ?? {
      reportType: 'manual',
      source: 'settings',
      stage: 'manual',
      severity: 'error',
      summary: '用户手动上传诊断日志',
      message: '用户主动从设置页上传本机诊断日志',
      occurredAt: Date.now(),
    }
  )
}

export function uploadDiagnosticReport(
  options: DiagnosticUploadOptions = {},
): Promise<DiagnosticUploadResult> {
  if (diagnosticUploadPromise) return diagnosticUploadPromise

  const uploadRevision = diagnosticUploadState.revision
  diagnosticUploadPromise = sendDiagnosticReport(
    'manual',
    options,
    manualUploadError(),
    uploadRevision,
  ).finally(() => {
    diagnosticUploadPromise = null
  })
  return diagnosticUploadPromise
}

export async function confirmAndUploadDiagnosticReport(
  options: DiagnosticUploadOptions = {},
): Promise<DiagnosticManualUploadResult> {
  const zh = isChinese()
  const response = await showMessage({
    type: 'none',
    title: zh ? '上传日志' : 'Upload logs',
    message: zh ? '是否上传日志？' : 'Do you want to upload the logs?',
    detail: zh
      ? '发送最近错误信息帮助开发者完善软件。'
      : 'Send recent error information to help developers improve the software.',
    buttons: zh ? ['上传', '查看日志', '取消'] : ['Upload', 'View logs', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  })

  if (response === 1) {
    await openDiagnosticLogs()
    return { cancelled: true }
  }

  if (response !== 0) return { cancelled: true }
  const result = await uploadDiagnosticReport(options)
  return { cancelled: false, id: result.id }
}

export async function openDiagnosticLogs(): Promise<void> {
  if (!logDirectory) return
  if (logFile && existsSync(logFile)) {
    shell.showItemInFolder(logFile)
    return
  }
  await shell.openPath(logDirectory)
}
