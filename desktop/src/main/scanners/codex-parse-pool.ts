import { Worker } from 'node:worker_threads'
import type { ParseContext, ParsedCodexSession } from './codex.scanner'
import type { ParserWorkerOptions, ScannerScanContext } from './types'
import type {
  ScanSourceStateRow,
  ScanSourceStateUpdate,
} from '../services/scan-source-state.service'

export interface CodexParseFile {
  file: ParseContext
  state?: ScanSourceStateRow
}

export interface CodexParseRequest extends CodexParseFile {
  index: number
  context: Pick<ScannerScanContext, 'mode' | 'sinceMs' | 'scanStartedAtMs' | 'strict'>
}

export interface CodexParseResult {
  session: ParsedCodexSession | null
  sourceStates: ScanSourceStateUpdate[]
}

export type CodexParseReply =
  { index: number; result: CodexParseResult } | { index: number; error: string }

export class ParserWorkerUnavailableError extends Error {
  override name = 'ParserWorkerUnavailableError'
}

/** 文件内部顺序不变，跨文件结果按原始顺序归并，避免完成先后改变重复记录取舍。 */
export async function parseCodexFiles(
  files: CodexParseFile[],
  context: ScannerScanContext,
  options: ParserWorkerOptions,
  consume?: (result: CodexParseResult, index: number) => void,
): Promise<CodexParseResult[]> {
  if (!files.length) return []
  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('日志解析并行数无效')
  }
  const workers: Worker[] = []
  try {
    return await new Promise<CodexParseResult[]>((resolve, reject) => {
      const results: CodexParseResult[] = []
      const pending = new Map<number, CodexParseResult>()
      let nextResult = 0
      let next = 0
      let completed = 0
      let finished = false
      const fail = (error: Error): void => {
        if (finished) return
        finished = true
        reject(error)
      }
      context.reportProgress?.({ unit: 'files', completed: 0, total: files.length })
      for (let i = 0; i < Math.min(options.concurrency, 4, files.length); i++) {
        let worker: Worker
        try {
          worker = new Worker(options.entry, {
            execArgv: options.execArgv ?? [],
            // 大量日志对象寿命很短，限制年轻代扩张，保留长寿命数据的堆空间。
            resourceLimits: { maxYoungGenerationSizeMb: 8 },
          })
        } catch (error) {
          fail(
            new ParserWorkerUnavailableError(
              error instanceof Error ? error.message : String(error),
            ),
          )
          break
        }
        workers.push(worker)
        let activeIndex = -1
        const dispatch = (): void => {
          if (finished || next >= files.length) return
          activeIndex = next++
          const request: CodexParseRequest = {
            ...files[activeIndex],
            index: activeIndex,
            context: {
              mode: context.mode,
              sinceMs: context.sinceMs,
              scanStartedAtMs: context.scanStartedAtMs,
              strict: context.strict,
            },
          }
          try {
            worker.postMessage(request)
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
          }
        }
        worker.on('message', (reply: CodexParseReply) => {
          if (finished) return
          if (!reply || activeIndex < 0 || reply.index !== activeIndex) {
            fail(new Error('日志解析结果与当前文件不匹配'))
            return
          }
          if ('error' in reply) {
            fail(new Error(reply.error))
            return
          }
          if (!reply.result || !Array.isArray(reply.result.sourceStates)) {
            fail(new Error('日志解析结果不完整'))
            return
          }
          pending.set(activeIndex, reply.result)
          try {
            while (pending.has(nextResult)) {
              const result = pending.get(nextResult)!
              pending.delete(nextResult)
              if (consume) consume(result, nextResult)
              else results.push(result)
              nextResult++
            }
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)))
            return
          }
          activeIndex = -1
          completed++
          context.reportProgress?.({ unit: 'files', completed, total: files.length })
          if (completed === files.length) {
            finished = true
            resolve(results)
          } else dispatch()
        })
        worker.once('error', (error) => fail(new ParserWorkerUnavailableError(error.message)))
        worker.once('exit', (code) =>
          fail(new ParserWorkerUnavailableError(`日志解析线程提前退出（${code}）`)),
        )
        dispatch()
      }
    })
  } finally {
    await Promise.allSettled(workers.map((worker) => worker.terminate()))
  }
}
