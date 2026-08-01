/**
 * 统一扫描调度：主页与小窗共用同一入口和5小时回看口径；同步文件读取、解析与
 * SQLite 落库全部在隔离的 Utility Process 中执行，避免阻塞 Electron 主进程。
 * 每轮扫描完成即回收进程，确保大规模历史解析扩张的 V8 堆能完整释放。
 */
import { join } from 'path'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { ScanMode, ScanOptions, ScanResult } from '../../shared/models'
import { isScanWorkerResponse, type ScanWorkerRequest } from './scan-worker.protocol'

export { performScanWithScanners } from './scan-core.service'

const SCAN_REQUEST_TIMEOUT_MS = 10 * 60 * 1000

interface ActiveScan {
  mode: ScanMode
  promise: Promise<ScanResult>
}

interface PendingScan {
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
const pendingScans = new Map<number, PendingScan>()

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

/** 应用退出时终止当前扫描进程；未提交的 SQLite 事务会自动回滚。 */
export function stopBackgroundScan(): void {
  if (stopping) return
  stopping = true
  rejectPendingScans(new Error('应用正在退出，后台扫描已停止'))
  const worker = scanWorker
  scanWorker = null
  scanWorkerReady = null
  worker?.kill()
}

function startScan(mode: ScanMode): Promise<ScanResult> {
  const promise = requestBackgroundScan(mode)
  activeScan = { mode, promise }
  const clearActive = (): void => {
    if (activeScan?.promise === promise) activeScan = null
  }
  void promise.then(clearActive, clearActive)
  return promise
}

async function requestBackgroundScan(mode: ScanMode): Promise<ScanResult> {
  const worker = await ensureScanWorker()
  if (stopping) throw new Error('应用正在退出，无法启动后台扫描')

  const requestId = nextRequestId
  nextRequestId += 1
  const request: ScanWorkerRequest = { type: 'scan', requestId, options: { mode } }

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
    pendingScans.set(requestId, { resolve, reject, timeout })
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

function handleWorkerMessage(worker: UtilityProcess, message: unknown): void {
  if (scanWorker !== worker || !isScanWorkerResponse(message)) return
  const pending = pendingScans.get(message.requestId)
  if (!pending) return
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
