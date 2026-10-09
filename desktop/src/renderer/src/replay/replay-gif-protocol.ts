import type { ReplaySnapshot } from '@shared/replay'

export type GifFrameRequest =
  | { type: 'initialize'; snapshot: ReplaySnapshot; palette?: number[][] }
  | { type: 'frame'; frame: number }

export type GifFrameResponse =
  | { type: 'ready'; palette: number[][]; thumbnail?: string }
  | { type: 'frame'; frame: number; data: Uint8Array<ArrayBuffer> }
  | { type: 'error' }

export const REPLAY_GIF_MAX_WORKERS = 2

/** Keep encoding CPU usage modest, even on machines with many logical processors. */
export function replayGifConcurrency(logicalProcessors: number): number {
  if (!Number.isFinite(logicalProcessors)) return 1
  return Math.max(1, Math.min(REPLAY_GIF_MAX_WORKERS, Math.floor(logicalProcessors / 2)))
}
