import {
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  canEncodeVideo,
} from 'mediabunny'
import { GIFEncoder, applyPalette } from 'gifenc/src/index.js'
import {
  REPLAY_MAX_BYTES,
  REPLAY_MAX_CHUNK,
  replayDimensions,
  replayFormat,
  replayFps,
  replayTitle,
  type ReplaySnapshot,
  type ReplayWorkerRequest,
  type ReplayWorkerResponse,
} from '@shared/replay'
import { createReplayTimeline } from './replay-data'
import { paintReplay } from './replay-painter'
import { webpAnimationFrame, webpAnimationHeader } from './webp-animation'
import { replayPalette } from './replay-palette'

const post = (message: ReplayWorkerResponse, transfer: Transferable[] = []): void =>
  self.postMessage(message, { transfer })
let cancelled = false,
  running = false,
  sequence = 0
let output: Output | undefined
const pending = new Map<number, { resolve: () => void; reject: (error: Error) => void }>()
async function write(position: number, data: Uint8Array<ArrayBuffer>): Promise<void> {
  if (position + data.length > REPLAY_MAX_BYTES) throw new Error('too-large')
  for (let offset = 0; offset < data.length; offset += REPLAY_MAX_CHUNK) {
    if (cancelled) throw new Error('cancelled')
    const current = ++sequence
    const copy = data.slice(offset, offset + REPLAY_MAX_CHUNK)
    await new Promise<void>((resolve, reject) => {
      pending.set(current, { resolve, reject })
      post({ type: 'write', sequence: current, position: position + offset, data: copy }, [
        copy.buffer,
      ])
    })
  }
}
async function imageBytes(
  canvas: OffscreenCanvas,
  type: string,
  quality: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await canvas.convertToBlob({ type, quality })
  if (blob.type !== type) throw new Error('unsupported')
  return new Uint8Array(await blob.arrayBuffer())
}
async function encode(snapshot: ReplaySnapshot): Promise<void> {
  const o = snapshot.options,
    format = replayFormat(o),
    fps = replayFps(o)
  const { width, height } = replayDimensions(o)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', {
    alpha: format.kind === 'image' && o.format !== 'jpeg' && !!o.transparent,
    willReadFrequently: o.format === 'gif',
  })!
  const timeline = createReplayTimeline(snapshot)
  const quality = (o.quality ?? 85) / 100
  const frames = format.kind === 'image' ? 1 : o.duration * fps
  let position = 0
  const append = async (bytes: Uint8Array<ArrayBuffer>): Promise<void> => {
    await write(position, bytes)
    position += bytes.length
  }
  if (format.kind === 'image') {
    paintReplay(ctx, timeline, o.duration)
    await append(await imageBytes(canvas, format.mime, quality))
    post({ type: 'progress', frame: 1, frames: 1 })
  } else if (o.format === 'gif' || o.format === 'webp-animation') {
    const gif = o.format === 'gif' ? GIFEncoder({ auto: false }) : null
    let palette: number[][] = []
    if (gif) {
      paintReplay(ctx, timeline, o.duration)
      palette = replayPalette(ctx.getImageData(0, 0, width, height).data, o.colors ?? 128)
    } else await append(webpAnimationHeader(width, height, o.loop !== false))
    for (let frame = 0; frame < frames; frame++) {
      if (cancelled) throw new Error('cancelled')
      paintReplay(ctx, timeline, frame / fps)
      if (gif) {
        gif.reset()
        if (!frame) gif.writeHeader()
        const indexed = applyPalette(ctx.getImageData(0, 0, width, height).data, palette, 'rgb565')
        gif.writeFrame(indexed, width, height, {
          first: frame === 0,
          palette: frame === 0 ? palette : undefined,
          delay: (Math.round(((frame + 1) * 100) / fps) - Math.round((frame * 100) / fps)) * 10,
          repeat: o.loop === false ? -1 : 0,
          dispose: 1,
        })
        if (frame === frames - 1) gif.finish()
        await append(gif.bytesView())
      } else {
        const bytes = await imageBytes(canvas, 'image/webp', quality)
        await append(
          webpAnimationFrame(
            bytes,
            width,
            height,
            Math.round(((frame + 1) * 1000) / fps) - Math.round((frame * 1000) / fps),
          ),
        )
      }
      post({ type: 'progress', frame: frame + 1, frames })
    }
    if (!gif) {
      const size = new Uint8Array(4)
      new DataView(size.buffer).setUint32(0, position - 8, true)
      await write(4, size)
    }
  } else {
    const bitrate = Math.round(
      width * height * fps * (quality >= 0.95 ? 0.1 : quality >= 0.85 ? 0.065 : 0.04),
    )
    const videoQuality = new Quality({ bitrate })
    if (!(await canEncodeVideo('avc', { width, height, frameRate: fps, quality: videoQuality })))
      throw new Error('unsupported')
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(
        new WritableStream({ write: (chunk) => write(chunk.position, chunk.data) }),
        { chunked: true, chunkSize: 512 * 1024 },
      ),
    })
    const source = new CanvasSource(canvas, {
      codec: 'avc',
      quality: videoQuality,
      keyFrameInterval: 2,
      latencyMode: 'quality',
    })
    output.addVideoTrack(source, { frameRate: fps })
    output.setMetadataTags({
      title: replayTitle(o),
      artist: 'Oh My Token',
    })
    await output.start()
    for (let frame = 0; frame < frames; frame++) {
      if (cancelled) throw new Error('cancelled')
      paintReplay(ctx, timeline, frame / fps)
      await source.add(frame / fps, 1 / fps)
      if (frame % 6 === 0) post({ type: 'progress', frame: frame + 1, frames })
    }
    await output.finalize()
  }
  if (cancelled) throw new Error('cancelled')
  const factor = 480 / Math.max(width, height)
  const thumbnail = new OffscreenCanvas(Math.round(width * factor), Math.round(height * factor))
  // Composite transparent images onto white only for their library thumbnail.
  const thumbnailContext = thumbnail.getContext('2d', { alpha: false })!
  thumbnailContext.fillStyle = '#ffffff'
  thumbnailContext.fillRect(0, 0, thumbnail.width, thumbnail.height)
  if (format.kind !== 'image') paintReplay(ctx, timeline, o.duration)
  thumbnailContext.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height)
  const bytes = await imageBytes(thumbnail, 'image/jpeg', 0.78)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  post({ type: 'complete', thumbnail: 'data:image/jpeg;base64,' + btoa(binary) })
}
self.onmessage = (event: MessageEvent<ReplayWorkerRequest>): void => {
  const message = event.data
  if (message.type === 'written') {
    const item = pending.get(message.sequence)
    pending.delete(message.sequence)
    if (message.error) item?.reject(new Error('write'))
    else item?.resolve()
  } else if (message.type === 'cancel') {
    cancelled = true
    for (const item of pending.values()) item.reject(new Error('cancelled'))
    pending.clear()
  } else if (message.type === 'start' && !running) {
    running = true
    void encode(message.snapshot).catch(async (error: unknown) => {
      await output?.cancel().catch(() => {})
      const reason = error instanceof Error ? error.message : ''
      post(
        cancelled
          ? { type: 'cancelled' }
          : {
              type: 'error',
              code:
                reason === 'unsupported'
                  ? 'unsupported'
                  : reason === 'too-large'
                    ? 'too-large'
                    : reason === 'write'
                      ? 'write'
                      : 'encoding',
            },
      )
    })
  }
}
