import { computed, onActivated, onDeactivated, onMounted, onUnmounted, ref, type Ref } from 'vue'

/** Observers exist only while mounted; deactivated pages never keep RAF work alive. */
export function useMotionVisibility(element: Ref<HTMLElement | null | undefined>) {
  const active = ref(true)
  const intersecting = ref(false)
  const documentVisible = ref(!document.hidden)
  const reduced = ref(false)
  const activation = ref(0)
  const visible = computed(() => active.value && intersecting.value && documentVisible.value)
  let observer: IntersectionObserver | undefined
  let preference: MediaQueryList | undefined
  const updatePreference = (): void => {
    reduced.value = preference?.matches ?? false
  }
  const updateVisibility = (): void => {
    documentVisible.value = !document.hidden
  }
  onMounted(() => {
    preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    updatePreference()
    preference.addEventListener('change', updatePreference)
    document.addEventListener('visibilitychange', updateVisibility)
    if (element.value) {
      observer = new IntersectionObserver((entries) => {
        // A quick hide/show can queue both states; use the latest for this element.
        intersecting.value = entries.at(-1)?.isIntersecting ?? false
      })
      observer.observe(element.value)
    }
  })
  onActivated(() => {
    active.value = true
    activation.value++
  })
  onDeactivated(() => {
    active.value = false
  })
  onUnmounted(() => {
    observer?.disconnect()
    preference?.removeEventListener('change', updatePreference)
    document.removeEventListener('visibilitychange', updateVisibility)
  })
  return { active, visible, reduced, activation }
}
