import { randomUUID } from 'crypto'
import type { ScanMode } from '../../shared/models'
import type { ScanProgress } from '../../shared/scan-progress'
import type { ParserWorkerOptions } from '../scanners/types'
import { canonicalModelName } from '../cost/price-catalog'

export interface ScanExecutionOptions {
  scanId?: string
  onProgress?: (progress: ScanProgress) => void
  parserWorkers?: ParserWorkerOptions
  agentWorkers?: ParserWorkerOptions
}

export class ScanProgressReporter {
  private state: ScanProgress
  private publishedAt = 0

  private readonly options: ScanExecutionOptions

  constructor(mode: ScanMode, options: ScanExecutionOptions, startedAt: number) {
    this.options = options
    this.state = {
      scanId: options.scanId ?? randomUUID(),
      sequence: 0,
      startedAt,
      mode,
      phase: 'discovering',
      status: 'running',
      rebuilding: false,
      completedAgents: 0,
      totalAgents: 0,
    }
  }

  update(change: Partial<ScanProgress>, force = false): void {
    const changedStage = change.phase !== undefined && change.phase !== this.state.phase
    this.state = { ...this.state, ...change }
    const now = Date.now()
    if (!force && !changedStage && !change.preview && now - this.publishedAt < 150) return
    this.publishedAt = now
    this.state.sequence++
    const { preview: _preview, ...progress } = this.state
    // Normalize only the display payload; worker summaries retain their original merge keys.
    const preview = change.preview
      ? {
          ...change.preview,
          records: change.preview.records.map((row) => ({
            ...row,
            model: canonicalModelName(row.model),
          })),
          hourly: change.preview.hourly.map((row) => ({
            ...row,
            model: canonicalModelName(row.model),
          })),
        }
      : undefined
    try {
      this.options.onProgress?.({
        ...progress,
        ...(preview ? { preview } : {}),
      })
    } catch {
      // 展示端离开不会中断已经开始的数据校验与提交。
    }
  }
}
