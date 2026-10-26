import type { ThemeColors } from '../config/themes'
import { mixChartColor, type ChartColorMode } from './chart-color-mode'

function shiftHue(color: string, degrees: number): string {
  const [r, g, b] = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return color
  const hue =
    60 * (max === r ? (g - b) / chroma : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4)
  const sector = ((((hue + degrees) % 360) + 360) % 360) / 60
  const x = chroma * (1 - Math.abs((sector % 2) - 1))
  const channels = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][Math.floor(sector)]!
  return (
    '#' +
    channels
      .map((value) =>
        Math.round((value + min) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  )
}

/** A quiet neighboring-hue ramp follows the selected theme, including grayscale themes. */
export function floatingTrendPalette(colors: ThemeColors, mode: ChartColorMode): ThemeColors {
  if (mode === 'categorical') return colors
  const primary = mixChartColor(colors['--primary'], colors['--surface-low'], 0.14)
  const secondary = shiftHue(primary, -28)
  const tertiary = shiftHue(primary, -58)
  return {
    ...colors,
    '--chart-primary': primary,
    '--chart-secondary': secondary,
    '--chart-tertiary': tertiary,
    '--analytics-series-1': primary,
    '--analytics-series-2': secondary,
    '--analytics-series-3': tertiary,
    '--analytics-series-4': mixChartColor(primary, secondary, 0.35),
    '--analytics-series-5': mixChartColor(secondary, tertiary, 0.35),
    '--analytics-series-other': tertiary,
  }
}

export function floatingBarGradient(color: string, surface: string) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color },
      { offset: 0.35, color: mixChartColor(color, surface, 0.12) },
      { offset: 1, color: mixChartColor(color, surface, 0.7) },
    ],
  }
}
