import {
  REPLAY_FORMATS,
  clampReplayAnimationSettings,
  validReplayOptions,
  type ReplayFormat,
  type ReplayOptions,
} from '@shared/replay'

export type ReplayExportMode = (typeof REPLAY_FORMATS)[ReplayFormat]['kind']
export type ReplayExportSettings = Required<
  Pick<
    ReplayOptions,
    | 'format'
    | 'template'
    | 'metric'
    | 'aspect'
    | 'duration'
    | 'resolution'
    | 'theme'
    | 'fps'
    | 'quality'
    | 'colors'
    | 'scale'
    | 'loop'
    | 'still'
    | 'position'
    | 'transparent'
  >
>
interface ReplayExportProfile {
  settings: ReplayExportSettings
  custom: boolean
}
export interface ReplayExportPreferences {
  format: ReplayFormat
  lastFormats: Record<ReplayExportMode, ReplayFormat>
  profiles: Record<ReplayFormat, ReplayExportProfile>
}

const storageKey = 'replay-export-preferences-v1'
export function defaultReplayExportSettings(format: ReplayFormat = 'mp4'): ReplayExportSettings {
  const image = REPLAY_FORMATS[format].kind === 'image'
  return clampReplayAnimationSettings({
    format,
    template: image ? 'summary' : 'race',
    metric: 'cumulative',
    aspect: 'landscape',
    resolution: 1080,
    duration: 60,
    fps: 60,
    quality: 95,
    colors: 256,
    scale: 3,
    theme: image ? 'paper' : 'midnight',
    loop: true,
    still: 'summary',
    position: 1,
    transparent: false,
  })
}

/** Keep export preferences separate from titles, date ranges and scanned usage data. */
export function replayExportSettings(options: ReplayExportSettings): ReplayExportSettings {
  return clampReplayAnimationSettings(
    Object.fromEntries(
      (Object.keys(defaultReplayExportSettings()) as (keyof ReplayExportSettings)[]).map((key) => [
        key,
        options[key],
      ]),
    ) as ReplayExportSettings,
  )
}

export function isReplayFormat(value: unknown): value is ReplayFormat {
  return typeof value === 'string' && Object.hasOwn(REPLAY_FORMATS, value)
}

export function readReplayExportPreferences(): ReplayExportPreferences {
  const formats = Object.keys(REPLAY_FORMATS) as ReplayFormat[]
  const result: ReplayExportPreferences = {
    format: 'mp4',
    lastFormats: { image: 'png', animation: 'gif', video: 'mp4' },
    profiles: Object.fromEntries(
      formats.map((format) => [
        format,
        { settings: defaultReplayExportSettings(format), custom: false },
      ]),
    ) as ReplayExportPreferences['profiles'],
  }
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (!saved || typeof saved !== 'object') return result
    for (const format of formats) {
      const profile = saved.profiles?.[format]
      if (!profile?.settings || typeof profile.settings !== 'object') continue
      const settings = { ...defaultReplayExportSettings(format), ...profile.settings, format }
      if (
        !validReplayOptions({
          ...settings,
          from: '2000-01-01',
          to: '2000-01-01',
          dimension: 'agents',
          language: 'en',
        }) ||
        (format !== 'gif' && (settings.resolution === 360 || settings.fps === 15))
      )
        continue
      if (format !== 'png' && format !== 'webp') settings.transparent = false
      result.profiles[format] = {
        settings: replayExportSettings(settings),
        custom: profile.custom === true,
      }
    }
    for (const mode of ['image', 'animation', 'video'] as const) {
      const format = saved.lastFormats?.[mode]
      if (isReplayFormat(format) && REPLAY_FORMATS[format].kind === mode)
        result.lastFormats[mode] = format
    }
    if (isReplayFormat(saved.format)) result.format = saved.format
  } catch {
    // Unavailable or invalid preferences must not prevent editing or exporting.
  }
  return result
}

export function writeReplayExportPreferences(preferences: ReplayExportPreferences): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(preferences))
  } catch {
    // Keep using the in-memory profiles when browser storage is unavailable.
  }
}
