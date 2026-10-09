import { readonly, ref } from 'vue'
import { isChartColorMode, type ChartColorMode } from '../utils/chart-color-mode'

const key = 'chart-color-mode'
const stored = localStorage.getItem(key)
const mode = ref<ChartColorMode>(isChartColorMode(stored) ? stored : 'tonal')
const channel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('ohmyagent-preferences')

window.addEventListener('storage', (event) => {
  if (event.key === key) mode.value = isChartColorMode(event.newValue) ? event.newValue : 'tonal'
})
channel?.addEventListener('message', (event: MessageEvent) => {
  if (event.data?.type === key && isChartColorMode(event.data.value)) mode.value = event.data.value
})

export function useChartColorMode() {
  function setMode(value: ChartColorMode): void {
    if (!isChartColorMode(value) || mode.value === value) return
    mode.value = value
    localStorage.setItem(key, value)
    channel?.postMessage({ type: key, value })
  }
  return { mode: readonly(mode), setMode }
}
