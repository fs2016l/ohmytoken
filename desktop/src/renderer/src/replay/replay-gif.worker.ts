import { GIFEncoder, applyPalette } from 'gifenc/src/index.js'
import { replayDimensions, replayFps, type ReplaySnapshot } from '@shared/replay'
import { createReplayTimeline } from './replay-data'
import { paintReplay } from './replay-painter'
import { replayPalette } from './replay-palette'
import type { GifFrameRequest, GifFrameResponse } from './replay-gif-protocol'

const post = (message: GifFrameResponse, transfer: Transferable[] = []): void =>
  self.postMessage(message, { transfer })
let snapshot: ReplaySnapshot
let timeline: ReturnType<typeof createReplayTimeline>
let canvas: OffscreenCanvas
let context: OffscreenCanvasRenderingContext2D
let palette: number[][]
let gif: ReturnType<typeof GIFEncoder>
let fps = 0

async function initialize(input: Extract<GifFrameRequest, { type: 'initialize' }>): Promise<void> {
  snapshot = input.snapshot
  timeline = createReplayTimeline(snapshot)
  const { width, height } = replayDimensions(snapshot.options)
  canvas = new OffscreenCanvas(width, height)
  context = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!
  gif = GIFEncoder({ auto: false })
  fps = replayFps(snapshot.options)
  palette = input.palette!
  let thumbnail: string | undefined
  if (!palette) {
    // Derive the palette once and share it with every encoder to keep colors identical.
    paintReplay(context, timeline, snapshot.options.duration)
    palette = replayPalette(
      context.getImageData(0, 0, width, height).data,
      snapshot.options.colors ?? 128,
    )
    const factor = 480 / Math.max(width, height)
    const cover = new OffscreenCanvas(Math.round(width * factor), Math.round(height * factor))
    const coverContext = cover.getContext('2d', { alpha: false })!
    coverContext.fillStyle = '#ffffff'
    coverContext.fillRect(0, 0, cover.width, cover.height)
    coverContext.drawImage(canvas, 0, 0, cover.width, cover.height)
    const bytes = new Uint8Array(
      await (await cover.convertToBlob({ type: 'image/jpeg', quality: 0.78 })).arrayBuffer(),
    )
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    thumbnail = 'data:image/jpeg;base64,' + btoa(binary)
  }
  post({ type: 'ready', palette, thumbnail })
}

function encodeFrame(frame: number): void {
  const frames = snapshot.options.duration * fps
  if (!Number.isInteger(frame) || frame < 0 || frame >= frames) throw new Error('invalid-frame')
  paintReplay(context, timeline, frame / fps)
  gif.reset()
  if (!frame) gif.writeHeader()
  const indexed = applyPalette(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
    palette,
    'rgb565',
  )
  gif.writeFrame(indexed, canvas.width, canvas.height, {
    first: frame === 0,
    palette: frame === 0 ? palette : undefined,
    delay: (Math.round(((frame + 1) * 100) / fps) - Math.round((frame * 100) / fps)) * 10,
    repeat: snapshot.options.loop === false ? -1 : 0,
    dispose: 1,
  })
  if (frame === frames - 1) gif.finish()
  // Transfer a copy: the encoder reuses its internal buffer for the next frame.
  const data = gif.bytesView().slice()
  post({ type: 'frame', frame, data }, [data.buffer])
}

self.onmessage = (event: MessageEvent<GifFrameRequest>): void => {
  try {
    if (event.data.type === 'initialize') {
      void initialize(event.data).catch(() => post({ type: 'error' }))
    } else encodeFrame(event.data.frame)
  } catch {
    post({ type: 'error' })
  }
}
