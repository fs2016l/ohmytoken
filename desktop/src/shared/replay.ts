import { validDate } from './calendar-date'

export type ReplayTemplate = 'race' | 'trend' | 'share' | 'summary'
export type ReplayDimension = 'agents' | 'models' | 'projects'
export type ReplayFormat = 'mp4' | 'gif' | 'webp-animation' | 'png' | 'jpeg' | 'webp'
export type ReplayMeasure = 'tokens' | 'cost' | 'turns' | 'calls'
export interface ReplayOptions {
  from: string
  to: string
  template: ReplayTemplate
  dimension: ReplayDimension
  metric: 'cumulative' | 'period'
  aspect: 'landscape' | 'portrait' | 'square'
  duration: 10 | 20 | 30 | 60
  resolution: 360 | 540 | 720 | 1080
  language: 'zh' | 'en'
  /** Optional so historical exports keep their default title. */
  title?: string
  // Optional for compatibility with MP4 records created before image export.
  format?: ReplayFormat
  measure?: ReplayMeasure
  theme?: 'midnight' | 'paper' | 'slate'
  fps?: 10 | 15 | 20 | 30 | 60
  quality?: 65 | 85 | 95
  colors?: 64 | 128 | 256
  loop?: boolean
  scale?: 1 | 2 | 3
  currency?: 'USD' | 'CNY'
  /** Empty arrays include every source; saved with each export for reproducible reuse. */
  agents?: string[]
  models?: string[]
  projectIds?: string[]
  still?: 'summary' | 'frame'
  position?: number
  transparent?: boolean
}
export interface ReplaySeries {
  id: string
  name: string
  color: string
}
export interface ReplaySummary {
  tokens: number
  cost: number | null
  costMax: number | null
  turns: number | null
  calls: number | null
}
export interface ReplaySnapshot {
  options: ReplayOptions
  capturedAt: number
  granularity: 'day' | 'hour'
  series: ReplaySeries[]
  /** Ordered, complete calendar buckets. Values are increments, not running totals. */
  points: { key: string; values: number[]; summary?: ReplaySummary }[]
  totalTokens: number
  totalValue?: number
  available?: boolean
  notes?: ('partial' | 'range' | 'unavailable')[]
  summary?: ReplaySummary
}
export type ReplayFailure = 'interrupted' | 'encoding' | 'write' | 'unsupported' | 'too-large'
export interface ReplayRecord {
  id: string
  /** New histories use a readable folder name; legacy histories use their UUID. */
  folderName?: string
  createdAt: number
  completedAt?: number
  options: ReplayOptions
  totalTokens: number
  totalValue?: number
  status: 'generating' | 'complete' | 'failed' | 'cancelled'
  bytes: number
  thumbnail?: string
  failure?: ReplayFailure
}
export interface ReplayBegin {
  options: ReplayOptions
  totalTokens: number
  totalValue?: number
}
export interface ReplayFinish {
  record: ReplayRecord
  exported: boolean
}
export interface ReplayStorageInfo {
  directory: string
  selectedDirectory: string | null
  defaultDirectory: string
  defaultReason: 'development' | 'unwritable-installation' | null
}
export interface ReplayAPI {
  replayList(): Promise<ReplayRecord[]>
  replayBegin(input: ReplayBegin): Promise<{ id: string } | null>
  replayWrite(id: string, position: number, bytes: Uint8Array): Promise<void>
  replayFinish(id: string, thumbnail: string): Promise<ReplayFinish>
  replayCancel(id: string, failure?: ReplayFailure): Promise<void>
  replayRead(id: string): Promise<Uint8Array>
  replayRemove(id: string): Promise<void>
  replaySaveCopy(id: string): Promise<boolean>
  replayOpenFolder(id?: string): Promise<void>
  replayStorageInfo(): Promise<ReplayStorageInfo>
  replayChooseStorageDirectory(): Promise<ReplayStorageInfo>
  replayResetStorageDirectory(): Promise<ReplayStorageInfo>
}
export const REPLAY_MAX_BYTES = 128 * 1024 * 1024
export const REPLAY_MAX_CHUNK = 1024 * 1024
export const REPLAY_MAX_DAYS = 3660
export const REPLAY_FPS = 30
export const REPLAY_TITLE_MAX_LENGTH = 30
export const REPLAY_ANIMATION_MAX_RESOLUTION = 720
export const REPLAY_ANIMATION_MAX_FPS = 30

export function replayTitle(options: Pick<ReplayOptions, 'title' | 'language'>): string {
  return (
    options.title?.replace(/\s+/g, ' ').trim() ||
    (options.language === 'zh' ? '我的 AI 使用回顾' : 'My AI usage recap')
  )
}

export function validReplayOptions(value: unknown): value is ReplayOptions {
  if (!value || typeof value !== 'object') return false
  const o = value as ReplayOptions
  return (
    validDate(o.from) &&
    validDate(o.to) &&
    o.from <= o.to &&
    (Date.parse(o.to) - Date.parse(o.from)) / 86400000 < REPLAY_MAX_DAYS &&
    ['race', 'trend', 'share', 'summary'].includes(o.template) &&
    ['agents', 'models', 'projects'].includes(o.dimension) &&
    ['cumulative', 'period'].includes(o.metric) &&
    ['landscape', 'portrait', 'square'].includes(o.aspect) &&
    [10, 20, 30, 60].includes(o.duration) &&
    [360, 540, 720, 1080].includes(o.resolution) &&
    ['zh', 'en'].includes(o.language) &&
    (o.title === undefined ||
      (typeof o.title === 'string' && o.title.length <= REPLAY_TITLE_MAX_LENGTH)) &&
    (o.format === undefined || Object.hasOwn(REPLAY_FORMATS, o.format)) &&
    (o.measure === undefined || ['tokens', 'cost', 'turns', 'calls'].includes(o.measure)) &&
    (o.theme === undefined || ['midnight', 'paper', 'slate'].includes(o.theme)) &&
    (o.fps === undefined || [10, 15, 20, 30, 60].includes(o.fps)) &&
    (o.quality === undefined || [65, 85, 95].includes(o.quality)) &&
    (o.colors === undefined || [64, 128, 256].includes(o.colors)) &&
    (o.scale === undefined || [1, 2, 3].includes(o.scale)) &&
    (o.currency === undefined || ['USD', 'CNY'].includes(o.currency)) &&
    (['agents', 'models', 'projectIds'] as const).every(
      (key) =>
        o[key] === undefined ||
        (Array.isArray(o[key]) &&
          o[key].length <= 256 &&
          o[key].every((id) => typeof id === 'string' && id.length <= 512)),
    ) &&
    (o.still === undefined || ['summary', 'frame'].includes(o.still)) &&
    (o.position === undefined ||
      (Number.isFinite(o.position) && o.position >= 0 && o.position <= 1)) &&
    (o.loop === undefined || typeof o.loop === 'boolean') &&
    (o.transparent === undefined || typeof o.transparent === 'boolean') &&
    (o.template !== 'summary' || replayFormat(o).kind === 'image')
  )
}
export const REPLAY_FORMATS = {
  mp4: { extension: 'mp4', mime: 'video/mp4', label: 'MP4', kind: 'video' },
  gif: { extension: 'gif', mime: 'image/gif', label: 'GIF', kind: 'animation' },
  'webp-animation': { extension: 'webp', mime: 'image/webp', label: 'WebP', kind: 'animation' },
  png: { extension: 'png', mime: 'image/png', label: 'PNG', kind: 'image' },
  jpeg: { extension: 'jpg', mime: 'image/jpeg', label: 'JPG', kind: 'image' },
  webp: { extension: 'webp', mime: 'image/webp', label: 'WebP', kind: 'image' },
} as const
export function replayFormat(options: ReplayOptions) {
  return REPLAY_FORMATS[options.format ?? 'mp4']
}
/** New exports have stricter limits than historical records. */
export function validReplayExportOptions(value: unknown): value is ReplayOptions {
  return (
    validReplayOptions(value) &&
    (replayFormat(value).kind !== 'animation' ||
      (value.resolution <= REPLAY_ANIMATION_MAX_RESOLUTION &&
        replayFps(value) <= REPLAY_ANIMATION_MAX_FPS))
  )
}
/** Migrate saved settings and reused history without changing the original record. */
export function clampReplayAnimationSettings<
  T extends Pick<ReplayOptions, 'format' | 'resolution' | 'fps'>,
>(options: T): T {
  if (options.format !== 'gif' && options.format !== 'webp-animation') return options
  return {
    ...options,
    resolution:
      options.resolution > REPLAY_ANIMATION_MAX_RESOLUTION
        ? REPLAY_ANIMATION_MAX_RESOLUTION
        : options.resolution,
    fps:
      options.fps !== undefined && options.fps > REPLAY_ANIMATION_MAX_FPS
        ? REPLAY_ANIMATION_MAX_FPS
        : options.fps,
  }
}
export function replayFilename(options: ReplayOptions): string {
  return `${replayFormat(options).kind === 'video' ? 'video' : 'image'}.${replayFormat(options).extension}`
}
export function replayFps(options: ReplayOptions): NonNullable<ReplayOptions['fps']> {
  return options.fps ?? (replayFormat(options).kind === 'video' ? 30 : 10)
}
export function replayDimensions(options: ReplayOptions): { width: number; height: number } {
  const scale = replayFormat(options).kind === 'image' ? (options.scale ?? 1) : 1
  const short = options.resolution * scale
  const long = Math.round((options.resolution * 16) / 9) * scale
  if (options.aspect === 'square') return { width: short, height: short }
  return options.aspect === 'landscape'
    ? { width: long, height: short }
    : { width: short, height: long }
}

export type ReplayWorkerRequest =
  | { type: 'start'; snapshot: ReplaySnapshot }
  | { type: 'written'; sequence: number; error?: string }
  | { type: 'cancel' }
export type ReplayWorkerResponse =
  | { type: 'write'; sequence: number; position: number; data: Uint8Array<ArrayBuffer> }
  | { type: 'progress'; frame: number; frames: number }
  | { type: 'complete'; thumbnail: string }
  | { type: 'error'; code: ReplayFailure }
  | { type: 'cancelled' }
