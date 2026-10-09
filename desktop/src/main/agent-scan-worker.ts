import { parentPort } from 'node:worker_threads'
import { allScanners, CodexScanner } from './scanners'
import { validateScannerUsageDetails } from './scanners/token-usage'
import type { ScanAgentProgress } from '../shared/scan-progress'
import type { AgentScanJob, AgentScanOutput, AgentScanReply } from './services/agent-scan-pool'
import { ScanPreviewAccumulator } from './services/scan-preview.service'
import { openUsageDatabase, withUsageDatabase } from './services/sqlite-storage.service'
import { prepareScanImport } from './services/scan-import-schema'
import { persistAgentScan } from './services/incremental-scan-storage.service'
import { refreshCostCache } from './cost/cost-cache'
import { loadCachedModelCatalog } from './services/model-catalog.service'

if (!parentPort) throw new Error('Agent 扫描线程缺少通信端口')
loadCachedModelCatalog()
const port = parentPort
const send = (reply: AgentScanReply): void => port.postMessage(reply)
let busy = false

interface PreparedAgentScan {
  result: AgentScanOutput
  database?: ReturnType<typeof openUsageDatabase>
}

/** 明细写入后结束解析作用域，费用汇总期间只保留数据库和轻量摘要。 */
async function prepareAgentScan(job: AgentScanJob): Promise<PreparedAgentScan> {
  const scanner =
    job.agent === 'codex'
      ? new CodexScanner(job.sourceStates)
      : allScanners.find((scanner) => scanner.agentName === job.agent)
  if (!scanner) throw new Error('未注册的 Agent 扫描器')
  if (!scanner.isAvailable()) throw new Error('扫描来源已不可用')
  let phase: ScanAgentProgress['phase'] = 'reading'
  let lastPublished = 0
  const context = {
    ...job.context,
    reportProgress: (work: ScanAgentProgress['work']) => {
      const now = Date.now()
      if (now - lastPublished < 150 && work?.completed !== work?.total) return
      lastPublished = now
      send({ type: 'progress', index: job.index, progress: { agent: job.agent, phase, work } })
    },
  }
  const details = scanner.scanDetailed
    ? await scanner.scanDetailed(context)
    : { records: await scanner.scan(context), sessions: [], apiCalls: [] }
  validateScannerUsageDetails(job.agent, details)
  const sourceStates = scanner.takeScanStateUpdates?.() ?? []
  if (!job.databasePath) {
    return { result: { records: details.records, details, sourceStates } }
  }
  const preview = new ScanPreviewAccumulator([], false)
  preview.add(details)
  send({ type: 'preview', index: job.index, preview: preview.snapshot() })
  phase = 'writing'
  send({ type: 'progress', index: job.index, progress: { agent: job.agent, phase } })
  const db = openUsageDatabase(job.databasePath)
  try {
    const prepareCosts = prepareScanImport(db)
    withUsageDatabase(db, () =>
      persistAgentScan(job.agent, { ...context, preserveHistory: false }, details, sourceStates),
    )
    prepareCosts()
    return { result: { records: details.records }, database: db }
  } catch (error) {
    db.close()
    throw error
  }
}

port.on('message', async (job: AgentScanJob) => {
  if (busy) {
    send({ type: 'error', index: job.index, error: 'Agent 扫描线程仍在处理上一来源' })
    return
  }
  busy = true
  try {
    loadCachedModelCatalog()
    const { result, database } = await prepareAgentScan(job)
    if (database) {
      try {
        await refreshCostCache(database)
      } finally {
        database.close()
      }
    }
    send({ type: 'result', index: job.index, result })
  } catch (error) {
    send({
      type: 'error',
      index: job.index,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    busy = false
  }
})
send({ type: 'ready' })
