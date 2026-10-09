import { nextTick, ref, watch } from 'vue'
import type { BrowsingValue } from '@shared/browsing-state'
import { getPageScroll, savePageScroll, usePageState } from './usePageState'

/** Keep each table tab's browsing position while filters remain shared by the page. */
export function useTableTabState<T extends Record<string, BrowsingValue> & { page: number }>(
  pageKey: string,
  tab: () => string,
  state: T,
  defaults: Partial<T>,
  legacyRegion = 'table',
) {
  type Entry = Record<string, BrowsingValue>
  const saved = usePageState(`${pageKey}/tabs`, { entries: {} as Record<string, Entry> })
  const switching = ref(false)
  let generation = 0
  const copy = (value: Partial<T> | Entry): Entry => JSON.parse(JSON.stringify(value))
  const capture = (): Entry =>
    copy(Object.fromEntries(Object.keys(defaults).map((key) => [key, state[key]])))
  const region = (key: string): string => `table/${key}`

  // Preserve the active view and scroll from snapshots created before tab isolation.
  if (!saved.entries[tab()]) {
    saved.entries[tab()] = capture()
    const old = getPageScroll(pageKey, legacyRegion)
    savePageScroll(pageKey, region(tab()), old.top, old.left)
  }
  watch(
    tab,
    (current, previous) => {
      const version = ++generation
      switching.value = true
      saved.entries[previous] = capture()
      saved.entries[current] ??= copy(defaults)
      Object.assign(state, copy(saved.entries[current]))
      void nextTick(() => {
        if (generation === version) switching.value = false
      })
    },
    { flush: 'sync' },
  )

  function resetPaging(allTabs = false): void {
    if (switching.value && !allTabs) return
    for (const key of allTabs ? Object.keys(saved.entries) : [tab()]) {
      if (saved.entries[key]) saved.entries[key].page = 1
      const scroll = getPageScroll(pageKey, region(key))
      savePageScroll(pageKey, region(key), 0, scroll.left)
    }
    state.page = 1
  }
  return { switching, resetPaging, region }
}
