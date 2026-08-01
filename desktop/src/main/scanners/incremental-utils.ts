import { statSync } from 'fs'
import type { TokenUsageApiCall } from '../../shared/models'
import { timestampEpochMs } from '../lib/date-utils'
import type { ScannerScanContext } from './types'

export const SCAN_LOOKBACK_MS = 5 * 60 * 60 * 1000

export function fullScanContext(scanStartedAtMs = Date.now()): ScannerScanContext {
  return { mode: 'full', scanStartedAtMs }
}

export function normalizeScanContext(context?: ScannerScanContext): ScannerScanContext {
  return context ?? fullScanContext()
}

export function isIncrementalContext(
  context: ScannerScanContext,
): context is ScannerScanContext & { sinceMs: number } {
  return context.mode === 'incremental' && Number.isFinite(context.sinceMs) && context.sinceMs! > 0
}

/**
 * 文件扫描候选过滤。全量模式读取全部；增量模式只读取回看窗口内有过写入的文件。
 * 内容解析后仍需按事件时间过滤，mtime 只负责减少无关历史文件 I/O。
 */
export function shouldScanFile(file: string, context: ScannerScanContext): boolean {
  if (!isIncrementalContext(context)) return true
  try {
    return statSync(file).mtimeMs >= context.sinceMs
  } catch (e) {
    throw new Error(`扫描候选文件状态不可读 (${file}): ${(e as Error).message}`)
  }
}

/** 无法解析时间的新记录保留，避免来源缺少时间字段时永久漏数。 */
export function isApiCallInWindow(
  call: Pick<TokenUsageApiCall, 'rawTimestamp' | 'timestamp'>,
  context: ScannerScanContext,
): boolean {
  if (!isIncrementalContext(context)) return true
  const eventMs = eventTimestampMs(call)
  return eventMs <= 0 || eventMs >= context.sinceMs
}

export function eventTimestampMs(
  call: Pick<TokenUsageApiCall, 'rawTimestamp' | 'timestamp'>,
): number {
  return timestampEpochMs(call.rawTimestamp) || timestampEpochMs(call.timestamp)
}

export function filterApiCallsForContext(
  calls: TokenUsageApiCall[],
  context: ScannerScanContext,
): TokenUsageApiCall[] {
  return isIncrementalContext(context)
    ? calls.filter((call) => isApiCallInWindow(call, context))
    : calls
}
