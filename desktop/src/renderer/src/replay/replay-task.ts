import { computed, ref, shallowRef } from 'vue'
import { ReplayGifPool } from './replay-gif-pool'
import { replayGifConcurrency } from './replay-gif-protocol'
import type {
  ReplayFailure,
  ReplayRecord,
  ReplaySnapshot,
  ReplayWorkerResponse,
} from '@shared/replay'

type Status = 'idle' | 'choosing' | 'encoding' | 'saving' | 'cancelling' | 'complete' | 'error'
const status = ref<Status>('idle')
const preparing = ref(false)
const progress = ref(0)
const failure = ref<ReplayFailure | 'start' | 'history' | ''>('')
const records = shallowRef<ReplayRecord[]>([])
const current = shallowRef<ReplaySnapshot | null>(null)
const exported = ref(false)
let worker: Worker | ReplayGifPool | undefined
let jobId = ''
let stallTimer: ReturnType<typeof setTimeout> | undefined
const busy = computed(() => ['choosing', 'encoding', 'saving', 'cancelling'].includes(status.value))

async function refresh(): Promise<void> {
  try {
    records.value = await window.api.replayList()
    if (failure.value === 'history') failure.value = ''
  } catch {
    if (!busy.value) failure.value = 'history'
  }
}
function stopWorker(): void {
  clearTimeout(stallTimer)
  worker?.terminate()
  worker = undefined
}
async function fail(code: ReplayFailure): Promise<void> {
  stopWorker()
  status.value = 'cancelling'
  const id = jobId
  jobId = ''
  if (id) await window.api.replayCancel(id, code).catch(() => {})
  failure.value = code
  status.value = 'error'
  await refresh()
}
function heartbeat(): void {
  clearTimeout(stallTimer)
  stallTimer = setTimeout(() => {
    if (status.value === 'encoding') void fail('encoding')
  }, 120000)
}
async function start(snapshot: ReplaySnapshot): Promise<void> {
  if (busy.value) return
  failure.value = ''
  exported.value = false
  progress.value = 0
  current.value = structuredClone(snapshot)
  status.value = 'choosing'
  try {
    const job = await window.api.replayBegin({
      options: snapshot.options,
      totalTokens: snapshot.totalTokens,
      totalValue: snapshot.totalValue,
    })
    if (!job) {
      status.value = 'idle'
      return
    }
    jobId = job.id
    status.value = 'encoding'
    const concurrency = replayGifConcurrency(navigator.hardwareConcurrency)
    const activeWorker =
      snapshot.options.format === 'gif' && concurrency > 1
        ? new ReplayGifPool(concurrency)
        : new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' })
    worker = activeWorker
    const isCurrent = (): boolean => jobId === job.id && worker === activeWorker
    activeWorker.onmessage = (event: MessageEvent<ReplayWorkerResponse>): void => {
      if (!isCurrent() || status.value !== 'encoding') return
      const message = event.data
      heartbeat()
      if (message.type === 'write') {
        void window.api
          .replayWrite(job.id, message.position, message.data)
          .then(() => {
            if (isCurrent())
              activeWorker.postMessage({ type: 'written', sequence: message.sequence })
          })
          .catch(() => {
            if (isCurrent()) void fail('write')
          })
      } else if (message.type === 'progress') {
        progress.value = Math.min(0.97, (message.frame / message.frames) * 0.97)
      } else if (message.type === 'error') void fail(message.code)
      else if (message.type === 'complete') {
        status.value = 'saving'
        stopWorker()
        void window.api
          .replayFinish(job.id, message.thumbnail)
          .then((result) => {
            jobId = ''
            exported.value = result.exported
            progress.value = 1
            status.value = 'complete'
            void refresh()
          })
          .catch(() => {
            void fail('write')
          })
      }
    }
    activeWorker.onerror = () => {
      if (isCurrent()) void fail('encoding')
    }
    activeWorker.onmessageerror = () => {
      if (isCurrent()) void fail('encoding')
    }
    heartbeat()
    activeWorker.postMessage({ type: 'start', snapshot: current.value })
    void refresh()
  } catch {
    if (jobId) await fail('encoding')
    else {
      failure.value = 'start'
      status.value = 'error'
    }
  }
}
async function cancel(): Promise<void> {
  if (status.value !== 'encoding' || !jobId) return
  status.value = 'cancelling'
  stopWorker()
  const id = jobId
  jobId = ''
  try {
    await window.api.replayCancel(id)
    status.value = 'idle'
  } catch {
    status.value = 'error'
    failure.value = 'write'
  }
  await refresh()
}
/** Module lifetime is independent of route lifetime; navigating away never cancels an export. */
export function useReplayTask() {
  return {
    status,
    preparing,
    busy,
    progress,
    failure,
    records,
    current,
    exported,
    start,
    cancel,
    refresh,
  }
}
