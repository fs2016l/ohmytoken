import { Worker } from 'node:worker_threads'
import type { ScannerUsageDetails, TokenUsageRecord } from '../../shared/models'
import type { ScanAgentProgress, ScanPreview } from '../../shared/scan-progress'
import type { ParserWorkerOptions, ScannerScanContext } from '../scanners/types'
import type { ScanSourceStateRow, ScanSourceStateUpdate } from './scan-source-state.service'

export interface AgentScanJob {
  index: number
  agent: string
  context: Omit<ScannerScanContext, 'reportProgress'>
  sourceStates: ScanSourceStateRow[]
  databasePath?: string
}

export interface AgentScanOutput {
  records: TokenUsageRecord[]
  details?: ScannerUsageDetails
  sourceStates?: ScanSourceStateUpdate[]
}

export type AgentScanReply =
  | { type: 'ready' }
  | { type: 'progress'; index: number; progress: ScanAgentProgress }
  | { type: 'preview'; index: number; preview: ScanPreview }
  | { type: 'result'; index: number; result: AgentScanOutput }
  | { type: 'error'; index: number; error: string }

export interface AgentScanCallbacks {
  onProgress: (job: AgentScanJob, progress: ScanAgentProgress) => void
  onPreview: (job: AgentScanJob, preview: ScanPreview) => void
  onComplete: (job: AgentScanJob) => void
}

export class AgentWorkerUnavailableError extends Error {
  override name = 'AgentWorkerUnavailableError'
}

/** 每个线程一次只处理一个来源，结果按计划顺序返回。 */
export async function runAgentScanJobs(
  jobs: AgentScanJob[],
  options: ParserWorkerOptions,
  callbacks: AgentScanCallbacks,
): Promise<AgentScanOutput[]> {
  if (!jobs.length) return []
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1)
    throw new Error('Agent 扫描并行数无效')
  const workers: Worker[] = []
  try {
    return await new Promise<AgentScanOutput[]>((resolve, reject) => {
      const results: AgentScanOutput[] = new Array(jobs.length)
      let next = 0
      let completed = 0
      let finished = false
      const fail = (error: Error): void => {
        if (finished) return
        finished = true
        reject(error)
      }
      for (let slot = 0; slot < Math.min(3, jobs.length, options.concurrency); slot++) {
        let worker: Worker
        try {
          worker = new Worker(options.entry, {
            execArgv: options.execArgv ?? [],
            resourceLimits: { maxYoungGenerationSizeMb: 8 },
          })
        } catch (error) {
          fail(new AgentWorkerUnavailableError(String(error)))
          break
        }
        workers.push(worker)
        let ready = false
        let active = -1
        let previewReceived = false
        const startupTimer = setTimeout(
          () => fail(new AgentWorkerUnavailableError('Agent 扫描线程启动超时')),
          15000,
        )
        const dispatch = (): void => {
          if (finished || next >= jobs.length) return
          active = next++
          previewReceived = false
          const job = jobs[active]
          callbacks.onProgress(job, { agent: job.agent, phase: 'reading' })
          worker.postMessage(job)
        }
        worker.on('message', (reply: AgentScanReply) => {
          if (finished) return
          try {
            if (reply?.type === 'ready' && !ready) {
              ready = true
              clearTimeout(startupTimer)
              dispatch()
              return
            }
            const job = jobs[active]
            if (!reply || reply.type === 'ready' || !job || reply.index !== job.index)
              throw new Error('Agent 扫描结果与当前来源不匹配')
            if (reply.type === 'error') throw new Error(`${job.agent}: ${reply.error}`)
            if (reply.type === 'progress') {
              if (reply.progress?.agent !== job.agent) throw new Error('Agent 扫描进度来源不匹配')
              callbacks.onProgress(job, reply.progress)
            } else if (reply.type === 'preview') {
              if (!job.databasePath || previewReceived)
                throw new Error('Agent 扫描摘要重复或模式不匹配')
              previewReceived = true
              callbacks.onPreview(job, reply.preview)
            } else if (reply.type === 'result') {
              if (
                !Array.isArray(reply.result?.records) ||
                (job.databasePath ? !previewReceived : !reply.result.details)
              )
                throw new Error('Agent 扫描结果不完整')
              results[active] = reply.result
              active = -1
              callbacks.onComplete(job)
              if (++completed === jobs.length) {
                finished = true
                resolve(results)
              } else dispatch()
            } else throw new Error('Agent 扫描线程消息无效')
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        })
        worker.once('error', (error) => {
          clearTimeout(startupTimer)
          fail(ready ? error : new AgentWorkerUnavailableError(error.message))
        })
        worker.once('exit', (code) => {
          clearTimeout(startupTimer)
          fail(
            ready
              ? new Error(`Agent 扫描线程提前退出（${code}）`)
              : new AgentWorkerUnavailableError(`Agent 扫描线程启动失败（${code}）`),
          )
        })
      }
    })
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.terminate()))
  }
}
