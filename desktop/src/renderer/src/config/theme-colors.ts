import { appearancePalettes, type Appearance, type PaletteColors } from '../../../shared/appearance'
import { mixChartColor } from '../utils/chart-color-mode'

/** Categories retain their identity; tonal charts use the chosen palette instead. */
const categoryColors = {
  light: ['#3563e9', '#6857d8', '#00796f', '#a2650d', '#b84f84'],
  dark: ['#96beff', '#c6a0ff', '#8adebf', '#ffd086', '#efa9c9'],
} as const

/** One role mapping for every theme. Business components never branch on a theme ID. */
export function createThemeColors(p: PaletteColors, mode: Appearance) {
  const mix = mixChartColor
  const series = categoryColors[mode]
  const legend = (index: number) => mix(p.surface, series[index], mode === 'light' ? 0.08 : 0.14)
  const colors = {
    '--shell': p.shell,
    '--sidebar': p.sidebar,
    '--nav-selected': p['nav-selected'],
    '--nav-text': p['nav-text'],
    '--nav-muted': p['nav-muted'],
    '--nav-active-text': p['nav-active-text'],
    '--bg-base': p.canvas,
    '--surface': p['surface-alt'],
    '--surface-low': p.surface,
    '--surface-container': p['surface-alt'],
    '--bg-hover': mix(p.surface, p.primary, 0.1),
    '--bg-elevated': p.surface,
    '--text': p.text,
    '--text-muted': p.muted,
    '--text-soft': p.muted,
    '--border': p.border,
    '--border-strong': mix(p.border, p.text, 0.14),
    '--primary': p.primary,
    '--primary-hover': p['primary-hover'],
    '--accent': p.primary,
    '--primary-soft': p.soft,
    '--primary-soft-text': p['soft-text'],
    '--primary-border': mix(p.soft, p.primary, 0.25),
    '--primary-on': p['on-primary'],
    '--border-focus': p.focus,
    '--disabled': p.disabled,
    '--text-disabled': p['disabled-text'],
    '--success': p.success,
    '--warning': p.warning,
    '--error': p.danger,
    '--success-soft': p['success-soft'],
    '--warning-soft': p['warning-soft'],
    '--error-soft': p['danger-soft'],
    '--chart-primary': p.primary,
    '--chart-secondary': p['chart-2'],
    '--chart-tertiary': p['chart-3'],
    '--chart-quaternary': p.muted,
    '--chart-track': p.track,
    '--icon-default': p.muted,
    '--omt-overlay-scrim': '#00000059',
    '--quota-track': p.track,
    '--quota-normal': p.primary,
    '--quota-warning': p.warning,
    '--quota-critical': p.danger,
    '--quota-badge': p.surface,
    '--quota-outline': p.border,
    '--quota-warningText': p.warning,
    '--quota-criticalText': p.danger,
    '--omt-liquid-mist-top': p.surface + 'b8',
    '--omt-liquid-mist-bottom': p.surface + '00',
    '--chart-project-cost-start': p['chart-2'],
    '--chart-project-cost-end': p.primary,
    '--analytics-series-1': series[0],
    '--analytics-series-2': series[1],
    '--analytics-series-3': series[2],
    '--analytics-series-4': series[3],
    '--analytics-series-5': series[4],
    '--analytics-series-other': p.muted,
    '--analytics-heatmap-0': mix(p['surface-alt'], p.primary, 0.03),
    '--analytics-heatmap-1': mix(p['surface-alt'], p.primary, 0.15),
    '--analytics-heatmap-2': mix(p['surface-alt'], p.primary, 0.3),
    '--analytics-heatmap-3': mix(p['surface-alt'], p.primary, 0.45),
    '--analytics-heatmap-4': mix(p['surface-alt'], p.primary, 0.65),
    '--analytics-heatmap-5': mix(p['surface-alt'], p.primary, 0.85),
    '--analytics-legend-1-surface': legend(0),
    '--analytics-legend-2-surface': legend(1),
    '--analytics-legend-3-surface': legend(2),
    '--analytics-legend-4-surface': legend(3),
    '--analytics-legend-5-surface': legend(4),
    '--analytics-legend-1-border': mix(p.border, series[0], 0.3),
    '--analytics-legend-2-border': mix(p.border, series[1], 0.3),
    '--analytics-legend-3-border': mix(p.border, series[2], 0.3),
    '--analytics-legend-4-border': mix(p.border, series[3], 0.3),
    '--analytics-legend-5-border': mix(p.border, series[4], 0.3),
    '--analytics-legend-other-surface': p['surface-alt'],
    '--analytics-legend-other-border': p.border,
    '--analytics-heatmap-row-surface': p['surface-alt'],
    '--surface-provider-warm': p['surface-alt'],
    '--surface-pricing-blue': p.soft,
    '--surface-pricing-cache': p['surface-alt'],
    // Compatibility names remain aliases of the same palette, not independent colors.
    '--omt-account-surface': p.sidebar,
    '--omt-account-update-fill': p.primary,
    '--omt-account-update-on': p['on-primary'],
  }
  return Object.fromEntries(
    Object.entries(colors).map(([role, value]) => [role, value.toLowerCase()]),
  ) as Record<keyof typeof colors, string>
}

export const builtinThemeColors = {
  classic: {
    light: createThemeColors(appearancePalettes.classic.light, 'light'),
    dark: createThemeColors(appearancePalettes.classic.dark, 'dark'),
  },
  iris: {
    light: createThemeColors(appearancePalettes.iris.light, 'light'),
    dark: createThemeColors(appearancePalettes.iris.dark, 'dark'),
  },
  cobalt: {
    light: createThemeColors(appearancePalettes.cobalt.light, 'light'),
    dark: createThemeColors(appearancePalettes.cobalt.dark, 'dark'),
  },
  copper: {
    light: createThemeColors(appearancePalettes.copper.light, 'light'),
    dark: createThemeColors(appearancePalettes.copper.dark, 'dark'),
  },
}
