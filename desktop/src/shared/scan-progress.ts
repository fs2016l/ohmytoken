import type { ScanMode, TokenUsageRecord } from './models'

export type ScanPhase = 'discovering' | 'reading' | 'writing' | 'costs' | 'committing'

export interface ScanWorkProgress {
  unit: 'files' | 'bytes' | 'rows' | 'calls' | 'sessions' | 'days'
  completed: number
  total?: number
}

export interface ScanAgentProgress {
  agent: string
  phase: 'reading' | 'writing'
  work?: ScanWorkProgress
}

export interface ScanHourlyPreview {
  agent: string
  model: string
  date: string
  hour: number
  totalTokens: number
}

export interface ScanPreview {
  records: TokenUsageRecord[]
  hourly: ScanHourlyPreview[]
  apiCalls: number
  complete: boolean
  retainedAgents: string[]
}

export interface ScanProgress {
  scanId: string
  sequence: number
  startedAt: number
  finishedAt?: number
  mode: ScanMode
  status: 'running' | 'complete' | 'failed'
  phase: ScanPhase
  rebuilding: boolean
  completedAgents: number
  totalAgents: number
  agent?: string
  work?: ScanWorkProgress
  activeAgents?: ScanAgentProgress[]
  preview?: ScanPreview
  error?: string
}

export function isScanProgress(value: unknown): value is ScanProgress {
  if (!value || typeof value !== 'object') return false
  const progress = value as Partial<ScanProgress>
  const count = (number: unknown): number is number =>
    Number.isSafeInteger(number) && (number as number) >= 0
  const validWork = (work: ScanWorkProgress): boolean =>
    ['files', 'bytes', 'rows', 'calls', 'sessions', 'days'].includes(work.unit) &&
    count(work.completed) &&
    (work.total === undefined || (count(work.total) && work.completed <= work.total))
  if (progress.work && !validWork(progress.work)) return false
  if (
    progress.activeAgents !== undefined &&
    (!Array.isArray(progress.activeAgents) ||
      progress.activeAgents.some(
        (item) =>
          !item ||
          typeof item.agent !== 'string' ||
          !item.agent ||
          !['reading', 'writing'].includes(item.phase) ||
          (item.work && !validWork(item.work)),
      ) ||
      new Set(progress.activeAgents.map((item) => item.agent)).size !==
        progress.activeAgents.length)
  )
    return false
  if (
    progress.preview &&
    (!Array.isArray(progress.preview.records) ||
      !Array.isArray(progress.preview.hourly) ||
      !count(progress.preview.apiCalls) ||
      typeof progress.preview.complete !== 'boolean' ||
      !Array.isArray(progress.preview.retainedAgents))
  )
    return false
  return (
    typeof progress.scanId === 'string' &&
    progress.scanId.length > 0 &&
    count(progress.sequence) &&
    Number.isFinite(progress.startedAt) &&
    (progress.finishedAt === undefined || Number.isFinite(progress.finishedAt)) &&
    (progress.mode === 'full' || progress.mode === 'incremental') &&
    ['running', 'complete', 'failed'].includes(progress.status ?? '') &&
    ['discovering', 'reading', 'writing', 'costs', 'committing'].includes(progress.phase ?? '') &&
    typeof progress.rebuilding === 'boolean' &&
    count(progress.completedAgents) &&
    count(progress.totalAgents) &&
    progress.completedAgents <= progress.totalAgents
  )
}
