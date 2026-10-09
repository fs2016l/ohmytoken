import type {
  ScanOptions,
  ScanResult,
  ScannerUsageDetails,
  TokenUsageRecord,
} from '../../shared/models'
import type { ScanWorkProgress } from '../../shared/scan-progress'
import { isoLocalDateTime } from '../lib/date-utils'
import { refreshCostCache } from '../cost/cost-cache'
import { openDatabase, withUsageDatabase } from './sqlite-storage.service'
import type { AgentScanner } from '../scanners'
import { validateScannerUsageDetails } from '../scanners/token-usage'
import {
  buildAgentScanPlan,
  incrementalFromDisplay,
  persistAgentScan,
} from './incremental-scan-storage.service'
import { ScanStaging } from './scan-staging.service'
import { ScanPreviewAccumulator } from './scan-preview.service'
import { ScanProgressReporter, type ScanExecutionOptions } from './scan-progress.service'
import { existsSync } from 'node:fs'
import { AgentWorkerUnavailableError, type AgentScanOutput } from './agent-scan-pool'
import { prepareParallelAgents } from './parallel-agent-scan.service'

/** 首次与全量扫描先提供已校验概览，明细完整就绪后原子替换正式统计。 */
export async function performScanWithScanners(
  scanners: AgentScanner[],
  options: ScanOptions = {},
  execution: ScanExecutionOptions = {},
): Promise<ScanResult> {
  const requestedMode = options.mode === 'full' ? 'full' : 'incremental'
  const startedAt = Date.now()
  const progress = new ScanProgressReporter(requestedMode, execution, startedAt)
  progress.update({}, true)
  const records: TokenUsageRecord[] = []
  const scannedAgents: string[] = []
  const errors: string[] = []
  const detectedAgents: string[] = []
  const incrementalStarts: number[] = []
  const plans: Array<{ scanner: AgentScanner; plan: ReturnType<typeof buildAgentScanPlan> }> = []
  for (const scanner of scanners) {
    try {
      if (scanner.isAvailable())
        plans.push({
          scanner,
          plan: buildAgentScanPlan(scanner.agentName, requestedMode, startedAt),
        })
    } catch (error) {
      errors.push(`${scanner.agentName}: ${(error as Error).message}`)
    }
  }
  for (const { plan } of plans) plan.context.storage = 'session'
  const target = openDatabase()
  const empty =
    !target.prepare('SELECT 1 FROM usage_api_calls LIMIT 1').get() &&
    !target.prepare('SELECT 1 FROM usage_records LIMIT 1').get() &&
    !target.prepare('SELECT 1 FROM usage_session_data LIMIT 1').get()
  const rebuilding =
    plans.length > 0 &&
    (requestedMode === 'full' || (empty && plans.every(({ plan }) => plan.context.mode === 'full')))
  progress.update({ rebuilding, totalAgents: plans.length }, true)
  let staging: ScanStaging | undefined
  let committed = false
  try {
    if (rebuilding) staging = new ScanStaging()
    let preview = rebuilding
      ? new ScanPreviewAccumulator(plans.map(({ scanner }) => scanner.agentName))
      : undefined
    if (preview) progress.update({ preview: preview.snapshot() }, true)
    let parallelResults: AgentScanOutput[] | undefined
    if (
      execution.agentWorkers &&
      execution.agentWorkers.concurrency > 1 &&
      plans.length > 1 &&
      existsSync(execution.agentWorkers.entry)
    ) {
      try {
        parallelResults = await prepareParallelAgents(plans, staging, preview, progress, execution)
      } catch (error) {
        if (!(error instanceof AgentWorkerUnavailableError)) throw error
        console.warn('[scan] Agent 扫描线程启动失败，继续使用单线程扫描')
        if (staging) {
          staging.dispose()
          staging = new ScanStaging()
          preview = new ScanPreviewAccumulator(plans.map(({ scanner }) => scanner.agentName))
        }
        progress.update(
          { completedAgents: 0, activeAgents: [], preview: preview?.snapshot() },
          true,
        )
      }
    }
    if (parallelResults) {
      for (let index = 0; index < plans.length; index++) {
        const { scanner, plan } = plans[index]
        const result = parallelResults[index]
        if (plan.context.mode === 'incremental' && plan.context.sinceMs)
          incrementalStarts.push(plan.context.sinceMs)
        if (!staging) {
          progress.update({ phase: 'writing', agent: scanner.agentName, work: undefined }, true)
          persistAgentScan(
            scanner.agentName,
            {
              ...plan.context,
              reportProgress: (work) => progress.update({ work }),
            },
            result.details!,
            result.sourceStates,
          )
        }
        records.push(...result.records)
        scannedAgents.push(scanner.agentName)
        if (!result.records.length) detectedAgents.push(scanner.agentName)
      }
    } else
      for (let index = 0; index < plans.length; index++) {
        const { scanner, plan } = plans[index]
        const agent = scanner.agentName
        const context = {
          ...plan.context,
          parserWorkers: execution.parserWorkers,
          strict: rebuilding,
          reportProgress: (work: ScanWorkProgress) => progress.update({ work }),
        }
        progress.update({ phase: 'reading', agent, completedAgents: index, work: undefined }, true)
        try {
          if (context.mode === 'incremental' && context.sinceMs)
            incrementalStarts.push(context.sinceMs)
          const details = scanner.scanDetailed
            ? await scanner.scanDetailed(context)
            : legacyDetails(await scanner.scan(context))
          validateScannerUsageDetails(agent, details)
          const sourceStates = scanner.takeScanStateUpdates?.() ?? []
          if (staging) {
            staging.store(agent, context, details, sourceStates)
            preview!.add(details)
            progress.update(
              { completedAgents: index + 1, work: undefined, preview: preview!.snapshot() },
              true,
            )
          } else {
            progress.update({ phase: 'writing', work: undefined }, true)
            persistAgentScan(agent, context, details, sourceStates)
          }
          records.push(...details.records)
          scannedAgents.push(agent)
          progress.update({ completedAgents: index + 1 }, true)
          if (!details.records.length) detectedAgents.push(agent)
        } catch (error) {
          errors.push(`${agent}: ${(error as Error).message}`)
          if (staging) break
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    if (
      staging &&
      plans.every(({ plan }) => plan.context.storage === 'session') &&
      !errors.length &&
      staging.canCommitAgents(target, plans.length)
    ) {
      progress.update(
        {
          phase: 'committing',
          agent: undefined,
          work: undefined,
          preview: preview!.snapshot(true),
        },
        true,
      )
      staging.commitAgents(target, scannedAgents)
      committed = true
    } else if (staging && !errors.length) {
      progress.update(
        {
          phase: 'writing',
          agent: undefined,
          work: undefined,
          completedAgents: plans.length,
          preview: preview!.snapshot(true),
        },
        true,
      )
      const stagedDatabase = staging.open()
      for (let index = 0; index < plans.length; index++) {
        if (parallelResults || plans[index].plan.context.storage === 'session') {
          progress.update({ agent: plans[index].scanner.agentName, work: undefined }, true)
          staging.mergeAgent(index, plans[index].scanner.agentName)
          await new Promise<void>((resolve) => setImmediate(resolve))
          continue
        }
        const stored = staging.load(index)
        progress.update({ agent: stored.agent, work: undefined }, true)
        withUsageDatabase(stagedDatabase, () =>
          persistAgentScan(
            stored.agent,
            {
              ...stored.context,
              preserveHistory: false,
              reportProgress: (work) => progress.update({ work }),
            },
            stored.details,
            stored.sourceStates,
          ),
        )
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      progress.update({ phase: 'costs', agent: undefined, work: undefined }, true)
      staging.prepareCosts()
      await refreshCostCache(stagedDatabase)
      progress.update({ phase: 'committing', work: undefined }, true)
      staging.commit(target, scannedAgents)
      committed = true
    } else if (!staging && scannedAgents.length) {
      progress.update({ phase: 'costs', agent: undefined, work: undefined }, true)
      await refreshCostCache(target)
    }
  } catch (error) {
    errors.push((error as Error).message)
  } finally {
    try {
      staging?.dispose()
    } catch (error) {
      console.warn('[scan] 暂存目录清理失败:', (error as Error).message)
    }
  }
  if (rebuilding && !committed) {
    records.length = 0
    scannedAgents.length = 0
    detectedAgents.length = 0
  }
  progress.update(
    {
      status: errors.length ? 'failed' : 'complete',
      agent: undefined,
      work: undefined,
      activeAgents: [],
      error: errors.length ? errors.join('\n') : undefined,
    },
    true,
  )
  const earliest = incrementalStarts.length ? Math.min(...incrementalStarts) : undefined
  return {
    scanTime: isoLocalDateTime(),
    mode: requestedMode,
    ...(earliest
      ? {
          incrementalFrom: incrementalFromDisplay({
            mode: 'incremental',
            sinceMs: earliest,
            scanStartedAtMs: startedAt,
          }),
        }
      : {}),
    totalRecords: records.length,
    records,
    scannedAgents,
    errors,
    detectedAgents,
  }
}

function legacyDetails(records: TokenUsageRecord[]): ScannerUsageDetails {
  return { records, sessions: [], apiCalls: [] }
}
