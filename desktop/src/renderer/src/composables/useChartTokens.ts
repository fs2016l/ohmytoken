import { computed } from 'vue'
import { useTheme } from './useTheme'
import { getTheme } from '../config/themes'
import { useChartColorMode } from './useChartColorMode'
import { chartPalette } from '../utils/chart-color-mode'
export function useChartTokens() {
  const { currentAccent, currentTheme } = useTheme()
  const { mode } = useChartColorMode()
  return computed(() =>
    chartPalette(getTheme(currentAccent.value).colors[currentTheme.value], mode.value),
  )
}
