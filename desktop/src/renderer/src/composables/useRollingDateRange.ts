import { onActivated, onDeactivated, watch } from 'vue'
import { localDate, rollDateRange, type DateRange } from '../utils/date-range'
import { useVisibleNow } from './useVisibleNow'

/** Keep selected relative ranges current without polling usage data. */
export function useRollingDateRange(state: { range: DateRange }): void {
  const now = useVisibleNow()
  let active = true
  function synchronize(at = new Date()): void {
    const next = rollDateRange(state.range, at)
    if (next !== state.range) state.range = next
  }
  synchronize()
  watch(
    () => localDate(new Date(now.value)),
    () => {
      if (active) synchronize(new Date(now.value))
    },
  )
  onActivated(() => {
    active = true
    synchronize()
  })
  onDeactivated(() => {
    active = false
  })
}
