import { inject, onDeactivated, provide, shallowRef, type InjectionKey } from 'vue'

function createHover() {
  const series = shallowRef<string>()
  let owner: symbol | undefined
  return {
    series,
    set(source: symbol, value?: string) {
      if (value) {
        owner = source
        series.value = value
      } else if (source === owner) {
        owner = undefined
        series.value = undefined
      }
    },
    clear() {
      owner = undefined
      series.value = undefined
    },
  }
}

const key: InjectionKey<ReturnType<typeof createHover>> = Symbol('overview-usage-hover')

/** Share model hover identity across the overview charts and project breakdown. */
export function provideUsageBarHover(): void {
  const hover = createHover()
  provide(key, hover)
  onDeactivated(hover.clear)
}

export function useUsageBarHover() {
  return inject(key, null)
}
