import type { ThemeColors } from '../config/themes'

/** A model's identity, never its rank or the current filter, determines its palette position. */
export function modelSeriesColor(model: string, colors: ThemeColors): string {
  let hash = 2166136261
  for (const char of model.trim().toLowerCase())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  // Sample the configured palette continuously, preserving custom and grayscale themes.
  const position = (hash / 0x100000000) * 5
  const index = Math.floor(position)
  const from = colors[`--analytics-series-${index + 1}` as keyof ThemeColors]
  const to = colors[`--analytics-series-${((index + 1) % 5) + 1}` as keyof ThemeColors]
  const weight = position - index
  return (
    '#' +
    [1, 3, 5]
      .map((offset) => {
        const a = parseInt(from.slice(offset, offset + 2), 16)
        const b = parseInt(to.slice(offset, offset + 2), 16)
        return Math.round(a + (b - a) * weight)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}
