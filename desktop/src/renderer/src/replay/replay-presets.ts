import {
  REPLAY_ANIMATION_MAX_RESOLUTION,
  REPLAY_ANIMATION_MAX_FPS,
  replayFormat,
  replayFps,
  type ReplayOptions,
} from '@shared/replay'

export const REPLAY_QUALITY_PRESETS = ['light', 'standard', 'fine'] as const
export type ReplayQualityPreset = (typeof REPLAY_QUALITY_PRESETS)[number]
type Settings = Partial<
  Pick<ReplayOptions, 'resolution' | 'scale' | 'quality' | 'fps' | 'colors' | 'duration'>
>

/** Only output quality parameters belong to a preset; content and styling remain independent. */
export function replayPresetSettings(
  options: ReplayOptions,
  preset: ReplayQualityPreset,
): Settings {
  const light = preset === 'light',
    fine = preset === 'fine'
  const quality = light ? 65 : fine ? 95 : 85
  if (replayFormat(options).kind === 'image')
    return {
      resolution: light ? 540 : 1080,
      scale: light ? 1 : fine ? 3 : 2,
      ...(options.format === 'png' ? {} : { quality }),
    }
  const duration = light ? 10 : fine ? 60 : 20
  if (options.format === 'gif')
    return {
      resolution: light ? 360 : fine ? REPLAY_ANIMATION_MAX_RESOLUTION : 540,
      fps: fine ? REPLAY_ANIMATION_MAX_FPS : 10,
      colors: light ? 64 : fine ? 256 : 128,
      duration,
    }
  const video = replayFormat(options).kind === 'video'
  return {
    resolution: light ? 540 : video ? 1080 : REPLAY_ANIMATION_MAX_RESOLUTION,
    fps: light ? 10 : video ? (fine ? 60 : 30) : fine ? REPLAY_ANIMATION_MAX_FPS : 20,
    quality,
    duration,
  }
}

function currentSettings(options: ReplayOptions): Settings {
  return {
    ...options,
    fps: replayFps(options),
    quality: options.quality ?? 85,
    colors: options.colors ?? 128,
    scale: options.scale ?? 1,
  }
}

export function matchingReplayPreset(options: ReplayOptions): ReplayQualityPreset | 'custom' {
  const current = currentSettings(options)
  return (
    REPLAY_QUALITY_PRESETS.find((preset) =>
      Object.entries(replayPresetSettings(options, preset)).every(
        ([key, value]) => current[key as keyof Settings] === value,
      ),
    ) ?? 'custom'
  )
}

export function replayQualitySignature(options: ReplayOptions): string {
  const current = currentSettings(options)
  return JSON.stringify([
    options.format ?? 'mp4',
    ...Object.keys(replayPresetSettings(options, 'fine')).map(
      (key) => current[key as keyof Settings],
    ),
  ])
}
