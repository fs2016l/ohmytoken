import {
  REPLAY_MAX_BYTES,
  REPLAY_MAX_CHUNK,
  replayFps,
  type ReplayFailure,
  type ReplaySnapshot,
  type ReplayWorkerRequest,
  type ReplayWorkerResponse,
} from '@shared/replay'
import {
  REPLAY_GIF_MAX_WORKERS,
  type GifFrameRequest,
  type GifFrameResponse,
} from './replay-gif-protocol'

type FrameWorker = Pick<
  Worker,
  'onmessage' | 'onerror' | 'onmessageerror' | 'postMessage' | 'terminate'
>
interface Slot {
  worker: FrameWorker
  ready: boolean
  frame?: number
}

/** All workers belong to the task directly, so cancellation can terminate every encoder. */
export class ReplayGifPool {
  onmessage: ((event: MessageEvent<ReplayWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent) => void) | null = null
  private slots: Slot[] = []
  private buffered = new Map<number, Uint8Array<ArrayBuffer>>()
  private snapshot?: ReplaySnapshot
  private thumbnail = ''
  private stopped = false
  private frames = 0
  private assigned = 0
  private committed = 0
  private offset = 0
  private position = 0
  private sequence = 0
  private writing?: { sequence: number; length: number }

  constructor(
    concurrency: number,
    createWorker: () => FrameWorker = () =>
      new Worker(new URL('./replay-gif.worker.ts', import.meta.url), { type: 'module' }),
  ) {
    const count = Number.isFinite(concurrency)
      ? Math.max(1, Math.min(REPLAY_GIF_MAX_WORKERS, Math.floor(concurrency)))
      : 1
    try {
      for (let index = 0; index < count; index++) {
        const slot: Slot = { worker: createWorker(), ready: false }
        this.slots.push(slot)
        slot.worker.onmessage = (event: MessageEvent<GifFrameResponse>) => {
          if (this.stopped) return
          try {
            this.receive(slot, index, event.data)
          } catch {
            this.abort('encoding')
          }
        }
        slot.worker.onerror = slot.worker.onmessageerror = () => this.abort('encoding')
      }
    } catch (error) {
      this.terminate()
      throw error
    }
  }

  postMessage(message: ReplayWorkerRequest): void {
    if (this.stopped) return
    if (message.type === 'cancel') {
      this.terminate()
    } else if (message.type === 'start') {
      if (this.snapshot) return
      this.snapshot = message.snapshot
      this.frames = message.snapshot.options.duration * replayFps(message.snapshot.options)
      this.send(this.slots[0], { type: 'initialize', snapshot: message.snapshot })
    } else if (this.writing?.sequence === message.sequence) {
      if (message.error) {
        this.abort('write')
        return
      }
      this.position += this.writing.length
      this.offset += this.writing.length
      this.writing = undefined
      const data = this.buffered.get(this.committed)!
      if (this.offset === data.length) {
        this.buffered.delete(this.committed++)
        this.offset = 0
        this.emit({ type: 'progress', frame: this.committed, frames: this.frames })
      }
      if (this.committed === this.frames) {
        const listener = this.onmessage
        const thumbnail = this.thumbnail
        this.terminate()
        listener?.(new MessageEvent('message', { data: { type: 'complete', thumbnail } }))
      } else this.pump()
    }
  }

  terminate(): void {
    this.stopped = true
    for (const { worker } of this.slots) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null
      worker.terminate()
    }
    this.slots = []
    this.buffered.clear()
    this.writing = undefined
    this.snapshot = undefined
    this.thumbnail = ''
    this.onmessage = this.onerror = this.onmessageerror = null
  }

  private send(slot: Slot, message: GifFrameRequest): void {
    slot.worker.postMessage(message)
  }

  private emit(message: ReplayWorkerResponse): void {
    this.onmessage?.(new MessageEvent('message', { data: message }))
  }

  private abort(code: ReplayFailure): void {
    const listener = this.onmessage
    this.terminate()
    listener?.(new MessageEvent('message', { data: { type: 'error', code } }))
  }

  private receive(slot: Slot, index: number, message: GifFrameResponse): void {
    if (message.type === 'error') {
      this.abort('encoding')
      return
    }
    if (message.type === 'ready') {
      if (slot.ready || !this.snapshot) throw new Error('unexpected-ready')
      slot.ready = true
      if (index === 0) {
        if (!message.thumbnail) throw new Error('missing-thumbnail')
        this.thumbnail = message.thumbnail
        for (const other of this.slots.slice(1))
          this.send(other, {
            type: 'initialize',
            snapshot: this.snapshot,
            palette: message.palette,
          })
      }
    } else {
      if (
        slot.frame !== message.frame ||
        !(message.data instanceof Uint8Array) ||
        !message.data.length
      )
        throw new Error('unexpected-frame')
      slot.frame = undefined
      this.buffered.set(message.frame, message.data)
    }
    this.pump()
  }

  private pump(): void {
    if (this.stopped) return
    this.drain()
    if (this.stopped) return
    // Bound both in-flight work and out-of-order results to two frames per encoder.
    for (const slot of this.slots) {
      if (this.assigned >= this.frames || this.assigned >= this.committed + this.slots.length * 2)
        break
      if (slot.ready && slot.frame === undefined) {
        slot.frame = this.assigned++
        this.send(slot, { type: 'frame', frame: slot.frame })
      }
    }
  }

  private drain(): void {
    if (this.writing) return
    const data = this.buffered.get(this.committed)
    if (!data) return
    if (this.offset === 0 && this.position + data.length > REPLAY_MAX_BYTES) {
      this.abort('too-large')
      return
    }
    const bytes = data.slice(this.offset, this.offset + REPLAY_MAX_CHUNK)
    this.writing = { sequence: ++this.sequence, length: bytes.length }
    this.emit({ type: 'write', sequence: this.sequence, position: this.position, data: bytes })
  }
}
