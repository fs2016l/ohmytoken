import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'

export type LegendVisibilityState = 'all' | 'partial' | 'none'

export interface LegendSelection<T> {
  selected: Ref<Set<T>>
  isSelected: (item: T) => boolean
  toggle: (item: T) => void
  toggleAll: () => void
  allSelected: ComputedRef<boolean>
  visibilityState: ComputedRef<LegendVisibilityState>
}

export function useLegendSelection<T>(
  allItems: ComputedRef<T[]>,
  onChange?: () => void,
): LegendSelection<T> {
  const selected = ref(new Set<T>()) as Ref<Set<T>>
  const knownItems = new Set<T>()

  watch(
    allItems,
    (items) => {
      const currentItems = new Set(items)
      const next = new Set<T>()

      selected.value.forEach((item) => {
        if (currentItems.has(item)) next.add(item)
      })

      for (const knownItem of knownItems) {
        if (!currentItems.has(knownItem)) knownItems.delete(knownItem)
      }

      items.forEach((item) => {
        if (!knownItems.has(item)) next.add(item)
        knownItems.add(item)
      })

      selected.value = next
      onChange?.()
    },
    { immediate: true },
  )

  const allSelected = computed(() => {
    const items = allItems.value
    return items.length > 0 && items.every((item) => selected.value.has(item))
  })

  const visibilityState = computed<LegendVisibilityState>(() => {
    const items = allItems.value
    if (items.length === 0) return 'none'
    const selectedCount = items.filter((item) => selected.value.has(item)).length
    if (selectedCount === 0) return 'none'
    if (selectedCount === items.length) return 'all'
    return 'partial'
  })

  function isSelected(item: T): boolean {
    return selected.value.has(item)
  }

  function toggle(item: T): void {
    const next = new Set(selected.value)
    if (next.has(item)) {
      next.delete(item)
    } else {
      next.add(item)
    }
    selected.value = next
    onChange?.()
  }

  function toggleAll(): void {
    const items = allItems.value
    const shouldSelectAll = !items.every((item) => selected.value.has(item))
    const next = new Set(selected.value)

    items.forEach((item) => {
      if (shouldSelectAll) {
        next.add(item)
      } else {
        next.delete(item)
      }
      knownItems.add(item)
    })

    selected.value = next
    onChange?.()
  }

  return { selected, isSelected, toggle, toggleAll, allSelected, visibilityState }
}
