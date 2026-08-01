import { allScanners } from './scanners'
import { performScanWithScanners } from './services/scan-core.service'
import {
  isScanWorkerRequest,
  type ScanWorkerFailure,
  type ScanWorkerSuccess,
} from './services/scan-worker.protocol'
import { closeDatabase, openDatabase } from './services/sqlite-storage.service'

const parentPort = process.parentPort
let scanQueue: Promise<void> = Promise.resolve()

if (!parentPort) {
  throw new Error('扫描后台进程缺少父进程通信端口')
}

// 主进程仍可能写入通知表；扫描进程遇到短暂写锁时在后台等待，不把等待传回 UI。
openDatabase().pragma('busy_timeout = 5000')

parentPort.on('message', (event) => {
  if (!isScanWorkerRequest(event.data)) return
  const request = event.data
  scanQueue = scanQueue.then(async () => {
    try {
      const result = await performScanWithScanners(allScanners, request.options)
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
