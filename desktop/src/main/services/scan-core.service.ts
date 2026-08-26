import type {
  ScanOptions,
  ScanResult,
  ScannerUsageDetails,
  TokenUsageRecord,
} from '../../shared/models'
import { isoLocalDateTime } from '../lib/date-utils'
import type { AgentScanner } from '../scanners'
import { validateScannerUsageDetails } from '../scanners/token-usage'
import {
  buildAgentScanPlan,
  incrementalFromDisplay,
  persistAgentScan,
} from './incremental-scan-storage.service'

/**
 * 扫描执行核心。生产环境由 scan-worker 在独立 Utility Process 中调用；
 * 测试可注入 scanner 列表直接验证扫描与原子落库口径。
 */
export async function performScanWithScanners(
  scanners: AgentScanner[],
  options: ScanOptions = {},
): Promise<ScanResult> {
  const requestedMode = normalizeMode(options.mode)
  const scanStartedAtMs = Date.now()
  const allRecords: TokenUsageRecord[] = []
  const scannedAgents: string[] = []
  const errors: string[] = []
  const detectedAgents: string[] = []
  const incrementalStarts: number[] = []

  for (const scanner of scanners) {
    try {
      if (!scanner.isAvailable()) continue

      const plan = buildAgentScanPlan(scanner.agentName, requestedMode, scanStartedAtMs)
      if (plan.context.mode === 'incremental' && plan.context.sinceMs) {
        incrementalStarts.push(plan.context.sinceMs)
      }
      const details = scanner.scanDetailed
        ? await scanner.scanDetailed(plan.context)
        : legacyDetails(await scanner.scan(plan.context))

      validateScannerUsageDetails(scanner.agentName, details)
      const sourceStateUpdates = scanner.takeScanStateUpdates?.() ?? []

      // 每个 Agent 扫描完立即原子提交，避免跨 Agent 持有全部 API 对象。
      persistAgentScan(scanner.agentName, plan.context, details, sourceStateUpdates)
      allRecords.push(...details.records)
      scannedAgents.push(scanner.agentName)
      if (details.records.length === 0) detectedAgents.push(scanner.agentName)
    } catch (e) {
      errors.push(`${scanner.agentName}: ${(e as Error).message}`)
    }
  }

  const earliestIncremental =
    incrementalStarts.length > 0 ? Math.min(...incrementalStarts) : undefined
  return {
    scanTime: isoLocalDateTime(),
    mode: requestedMode,
    ...(earliestIncremental
      ? {
          incrementalFrom: incrementalFromDisplay({
            mode: 'incremental',
            sinceMs: earliestIncremental,
            scanStartedAtMs,
          }),
        }
      : {}),
    totalRecords: allRecords.length,
    records: allRecords,
    scannedAgents,
    errors,
    detectedAgents,
  }
}

function legacyDetails(records: TokenUsageRecord[]): ScannerUsageDetails {
  return { records, sessions: [], apiCalls: [] }
}

function normalizeMode(mode: ScanOptions['mode']): 'incremental' | 'full' {
  return mode === 'full' ? 'full' : 'incremental'
}
