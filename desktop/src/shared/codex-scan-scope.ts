import type { ScanMode } from './models'

export type CodexScanScope = 'recent' | 'all'

export function isCodexScanScope(value: unknown): value is CodexScanScope {
  return value === 'recent' || value === 'all'
}

/** 最近一个自然月；月底向前取月时夹到目标月份的最后一天。 */
export function codexRecentStartMs(at: number): number {
  const date = new Date(at)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  date.setDate(Math.min(day, lastDay))
  return date.getTime()
}

export interface CodexScanScopeRequest {
  id: number
  mode: ScanMode
}

export interface CodexScanScopeAPI {
  codexScanScopeRead: () => Promise<CodexScanScopeRequest | null>
  codexScanScopeResolve: (id: number, scope: CodexScanScope | null) => Promise<void>
  onCodexScanScopeChanged: (callback: (request: CodexScanScopeRequest | null) => void) => () => void
}
