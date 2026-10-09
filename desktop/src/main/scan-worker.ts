import { allScanners } from './scanners'
import { performScanWithScanners } from './services/scan-core.service'
import {
  isScanWorkerRequest,
  type ScanWorkerFailure,
  type ScanWorkerSuccess,
} from './services/scan-worker.protocol'
import { closeDatabase, openDatabase } from './services/sqlite-storage.service'
import { join } from 'node:path'
import { availableParallelism } from 'node:os'
import { loadCachedModelCatalog } from './services/model-catalog.service'

const parentPort = process.parentPort
let scanQueue: Promise<void> = Promise.resolve()

if (!parentPort) {
  throw new Error('扫描后台进程缺少父进程通信端口')
}

// 主进程仍可能写入通知表；扫描进程遇到短暂写锁时在后台等待，不把等待传回 UI。
loadCachedModelCatalog()
openDatabase().pragma('busy_timeout = 5000')

parentPort.on('message', (event) => {
  if (!isScanWorkerRequest(event.data)) return
  const request = event.data
  scanQueue = scanQueue.then(async () => {
    try {
      loadCachedModelCatalog()
      const workerBudget = Math.min(6, Math.max(1, availableParallelism() - 2))
      const agentConcurrency = Math.min(2, workerBudget)
      const result = await performScanWithScanners(allScanners, request.options, {
        scanId: request.scanId,
        parserWorkers: {
          entry: join(__dirname, 'codex-parse-worker.js'),
          concurrency: Math.min(4, Math.max(1, workerBudget - agentConcurrency)),
        },
        agentWorkers: {
          entry: join(__dirname, 'agent-scan-worker.js'),
          concurrency: agentConcurrency,
        },
        onProgress: (progress) =>
          parentPort.postMessage({ type: 'scan-progress', requestId: request.requestId, progress }),
      })
      const response: ScanWorkerSuccess = {
        type: 'scan-result',
        requestId: request.requestId,
        result,
      }
      parentPort.postMessage(response)
    } catch (error) {
      const response: ScanWorkerFailure = {
        type: 'scan-error',
        requestId: request.requestId,
        error: error instanceof Error ? error.message : String(error),
      }
      parentPort.postMessage(response)
    }
  })
})

process.once('exit', () => closeDatabase())
