import type { ThemeColors } from '../config/themes'

export type ChartColorMode = 'tonal' | 'categorical'

export function isChartColorMode(value: unknown): value is ChartColorMode {
  return value === 'tonal' || value === 'categorical'
}

/** Mix configured colors, so imported themes do not inherit another theme's hue. */
export function mixChartColor(from: string, to: string, weight: number): string {
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

/** Tonal charts share a hue but retain the hierarchy of the Figma chart roles. */
export function chartPalette(colors: ThemeColors, mode: ChartColorMode): ThemeColors {
  if (mode === 'categorical') return colors
  const tone = (weight: number): string =>
    mixChartColor(colors['--primary'], colors['--chart-project-cost-start'], weight)
  return {
    ...colors,
    '--chart-primary': tone(0),
    '--chart-secondary': tone(1),
    '--chart-tertiary': tone(0.7),
    '--chart-quaternary': tone(0.45),
    '--analytics-series-1': tone(0),
    '--analytics-series-2': tone(1),
    '--analytics-series-3': tone(0.7),
    '--analytics-series-4': tone(0.3),
    '--analytics-series-5': tone(0.55),
    '--analytics-series-other': tone(0.85),
  }
}
