/**
 * 统一扫描调度：主页与小窗共用同一入口和5小时回看口径；同步文件读取、解析与
 * SQLite 落库全部在隔离的 Utility Process 中执行，避免阻塞 Electron 主进程。
 * 每轮扫描完成即回收进程，确保大规模历史解析扩张的 V8 堆能完整释放。
 */
import { join } from 'path'
import { randomUUID } from 'crypto'
import { BrowserWindow, utilityProcess, type UtilityProcess } from 'electron'
import type { ScanMode, ScanOptions, ScanResult } from '../../shared/models'
import type { ScanProgress } from '../../shared/scan-progress'
import { IPC } from '../ipc/channels'
import { isScanWorkerResponse, type ScanWorkerRequest } from './scan-worker.protocol'

export { performScanWithScanners } from './scan-core.service'

const SCAN_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const SCAN_WORKER_EXIT_TIMEOUT_MS = 5 * 1000

interface ActiveScan {
  mode: ScanMode
  promise: Promise<ScanResult>
}

interface PendingScan {
  scanId: string
  resolve: (result: ScanResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

let activeScan: ActiveScan | null = null
let queuedFullScan: Promise<ScanResult> | null = null
let scanWorker: UtilityProcess | null = null
let scanWorkerReady: Promise<UtilityProcess> | null = null
let nextRequestId = 1
let stopping = false
let scanStopPromise: Promise<void> | null = null
const liveScanWorkers = new Set<UtilityProcess>()
const pendingScans = new Map<number, PendingScan>()
let latestProgress: ScanProgress | null = null
const progressListeners = new Set<(progress: ScanProgress) => void>()

export function onScanProgress(callback: (progress: ScanProgress) => void): () => void {
  progressListeners.add(callback)
  return () => {
    progressListeners.delete(callback)
  }
}

export function getScanProgress(): ScanProgress | null {
  return latestProgress
}

function publishProgress(progress: ScanProgress): void {
  if (progress.status !== 'running')
    progress = { ...progress, finishedAt: progress.finishedAt ?? Date.now() }
  latestProgress =
    latestProgress?.scanId === progress.scanId ? { ...latestProgress, ...progress } : progress
  for (const callback of progressListeners) callback(progress)
  for (const window of BrowserWindow.getAllWindows()) {
    try {
      if (!window.isDestroyed() && !window.webContents.isDestroyed())
        window.webContents.send(IPC.SCAN_PROGRESS, progress)
    } catch {
      /* 窗口在发送期间关闭不影响扫描。 */
    }
  }
  if (progress.status !== 'running') latestProgress = { ...latestProgress, preview: undefined }
}

/**
 * 进程级调度：主页和小窗的增量请求共享当前任务；增量进行中收到 full 时排队一次，
 * 避免小窗自动刷新把主页的“重新全量扫描”静默丢掉。
 */
export function performScan(options: ScanOptions = {}): Promise<ScanResult> {
  const mode = normalizeMode(options.mode)
  if (!activeScan) return startScan(mode)
  if (mode === 'incremental' || activeScan.mode === 'full') return activeScan.promise
  if (queuedFullScan) return queuedFullScan

  const running = activeScan.promise
  queuedFullScan = running
    .catch(() => undefined)
    .then(() => startScan('full'))
    .finally(() => {
      queuedFullScan = null
    })
  return queuedFullScan
}

/**
 * 应用退出/更新前终止全部扫描进程，并等待操作系统确认进程退出。
 * 未提交的 SQLite 事务会自动回滚；超时后仍由 NSIS 的进程门禁阻止文件替换。
 */
export function stopBackgroundScan(): Promise<void> {
  if (scanStopPromise) return scanStopPromise
  stopping = true
  rejectPendingScans(new Error('应用正在退出，后台扫描已停止'))
  scanWorker = null
  scanWorkerReady = null

  const workers = [...liveScanWorkers]
  scanStopPromise = Promise.all(workers.map((worker) => stopScanWorker(worker))).then(
    () => undefined,
  )
  return scanStopPromise
}

/** 安装器未能启动且应用没有退出时，恢复扫描能力。 */
export function resumeBackgroundScan(): void {
  stopping = false
  scanStopPromise = null
}

function startScan(mode: ScanMode): Promise<ScanResult> {
  const scanId = randomUUID()
  publishProgress({
    scanId,
    sequence: 0,
    startedAt: Date.now(),
    mode,
    status: 'running',
    phase: 'discovering',
    rebuilding: mode === 'full',
    completedAgents: 0,
    totalAgents: 0,
  })
  const promise = requestBackgroundScan(mode, scanId).catch((error: Error) => {
    if (latestProgress?.scanId === scanId)
      publishProgress({
        ...latestProgress,
        sequence: latestProgress.sequence + 1,
        status: 'failed',
        error: error.message,
      })
    throw error
  })
  activeScan = { mode, promise }
  const clearActive = (): void => {
    if (activeScan?.promise === promise) activeScan = null
  }
  void promise.then(clearActive, clearActive)
  return promise
}

async function requestBackgroundScan(mode: ScanMode, scanId: string): Promise<ScanResult> {
  const worker = await ensureScanWorker()
  if (stopping) throw new Error('应用正在退出，无法启动后台扫描')

  const requestId = nextRequestId
  nextRequestId += 1
  const request: ScanWorkerRequest = { type: 'scan', requestId, scanId, options: { mode } }

  return new Promise<ScanResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pendingScans.delete(requestId)) return
      reject(new Error('后台扫描超时，扫描进程将自动重启'))
      if (scanWorker === worker) {
        scanWorker = null
        scanWorkerReady = null
        worker.kill()
      }
    }, SCAN_REQUEST_TIMEOUT_MS)
    pendingScans.set(requestId, { scanId, resolve, reject, timeout })
    try {
      worker.postMessage(request)
    } catch (error) {
      pendingScans.delete(requestId)
      clearTimeout(timeout)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function ensureScanWorker(): Promise<UtilityProcess> {
  if (stopping) return Promise.reject(new Error('应用正在退出，无法启动后台扫描'))
  if (scanWorker?.pid !== undefined) return Promise.resolve(scanWorker)
  if (scanWorkerReady) return scanWorkerReady

  let worker: UtilityProcess
  try {
    worker = utilityProcess.fork(join(__dirname, 'scan-worker.js'), [], {
      serviceName: 'Agent Usage Scanner',
      stdio: 'inherit',
    })
  } catch (error) {
    return Promise.reject(error)
  }

  liveScanWorkers.add(worker)
  scanWorker = worker
  scanWorkerReady = new Promise<UtilityProcess>((resolve, reject) => {
    let settled = false

    worker.once('spawn', () => {
      if (settled) return
      settled = true
      if (stopping) {
        worker.kill()
        reject(new Error('应用正在退出，后台扫描进程已终止'))
        return
      }
      if (scanWorker === worker) scanWorkerReady = null
      resolve(worker)
    })

    worker.on('message', (message) => handleWorkerMessage(worker, message))
    worker.on('error', (type, location) => {
      console.error(`[scan-worker] 后台进程异常 (${type}, ${location})`)
    })
    worker.once('exit', (code) => {
      liveScanWorkers.delete(worker)
      const error = new Error(`扫描后台进程已退出（code=${code}）`)
      if (!settled) {
        settled = true
        reject(error)
      }
      handleWorkerExit(worker, error)
    })
  })
  return scanWorkerReady
}

function stopScanWorker(worker: UtilityProcess): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timeout: NodeJS.Timeout | null = null

    const finish = (): void => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      worker.removeListener('exit', finish)
      resolve()
    }

    worker.once('exit', finish)
    timeout = setTimeout(() => {
      console.warn('[scan-worker] 等待后台扫描进程退出超时，将交由安装器进程门禁处理')
      finish()
    }, SCAN_WORKER_EXIT_TIMEOUT_MS)
    timeout.unref()

    try {
      worker.kill()
    } catch (error) {
      console.warn('[scan-worker] 终止后台扫描进程失败，将交由安装器进程门禁处理:', error)
      finish()
    }
  })
}

function handleWorkerMessage(worker: UtilityProcess, message: unknown): void {
  if (scanWorker !== worker || !isScanWorkerResponse(message)) return
  const pending = pendingScans.get(message.requestId)
  if (!pending) return
  if (message.type === 'scan-progress') {
    if (
      message.progress.scanId === pending.scanId &&
      (!latestProgress || message.progress.sequence > latestProgress.sequence)
    ) {
      publishProgress(message.progress)
    }
    return
  }
  pendingScans.delete(message.requestId)
  clearTimeout(pending.timeout)

  // 扫描结果已完成结构化克隆；先摘除并终止 worker，下一轮会创建全新进程。
  scanWorker = null
  scanWorkerReady = null
  worker.kill()
  if (message.type === 'scan-result') {
    pending.resolve(message.result)
  } else {
    pending.reject(new Error(message.error))
  }
}

function handleWorkerExit(worker: UtilityProcess, error: Error): void {
  if (scanWorker !== worker) return
  scanWorker = null
  scanWorkerReady = null
  rejectPendingScans(error)
}

function rejectPendingScans(error: Error): void {
  for (const pending of pendingScans.values()) {
    clearTimeout(pending.timeout)
    pending.reject(error)
  }
  pendingScans.clear()
}

function normalizeMode(mode: ScanOptions['mode']): ScanMode {
  return mode === 'full' ? 'full' : 'incremental'
}
