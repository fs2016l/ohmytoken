<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { getPageScroll, savePageScroll } from '../../composables/usePageState'

// Omit pageKey for transient surfaces outside the main-window browsing-state store.
const props = withDefaults(
  defineProps<{ pageKey?: string; fixed?: boolean; reading?: boolean }>(),
  {
    pageKey: '',
    fixed: false,
    reading: false,
  },
)
const scroller = ref<HTMLElement | null>(null)
let restoring = false
let active = true
let restoreGeneration = 0
let resize: ResizeObserver | undefined
let restoreTimer: ReturnType<typeof setTimeout> | undefined

function save(): void {
  if (props.pageKey && scroller.value && active && !restoring)
    savePageScroll(props.pageKey, 'page', scroller.value.scrollTop, scroller.value.scrollLeft)
}
function stopRestoring(): void {
  restoring = false
  resize?.disconnect()
  clearTimeout(restoreTimer)
}
async function restore(): Promise<void> {
  const generation = ++restoreGeneration
  restoring = true
  await nextTick()
  if (!scroller.value || generation !== restoreGeneration) return
  const saved = props.pageKey ? getPageScroll(props.pageKey, 'page') : { top: 0, left: 0 }
  const apply = (): void => {
    const element = scroller.value
    if (!element || generation !== restoreGeneration) return
    element.scrollTo({ top: saved.top, left: saved.left, behavior: 'instant' })
    if (element.scrollHeight - element.clientHeight >= saved.top - 1) stopRestoring()
  }
  resize?.disconnect()
  resize = new ResizeObserver(apply)
  const content = scroller.value.firstElementChild
  if (content) resize.observe(content)
  apply()
  // A changed dataset may be shorter than before; never fight the user's scroll.
  restoreTimer = setTimeout(stopRestoring, 10000)
}
watch(
  () => props.pageKey,
  (_key, previousKey) => {
    if (!active) return
    // Save the old tab before its content changes, without remounting shared controls.
    if (previousKey && scroller.value && !restoring)
      savePageScroll(previousKey, 'page', scroller.value.scrollTop, scroller.value.scrollLeft)
    stopRestoring()
    void restore()
  },
  { flush: 'pre' },
)
onMounted(() => {
  void restore()
})
onActivated(() => {
  active = true
  void restore()
})
// Vue has already moved a cached subtree into its storage container here; reading
// scrollTop after that move can yield zero. The scroll event saved the last live value.
onDeactivated(() => {
  active = false
  restoreGeneration++
  stopRestoring()
})
onBeforeUnmount(() => {
  save()
  active = false
  restoreGeneration++
  stopRestoring()
})
defineExpose({
  scroller,
  scrollToTop: () => scroller.value?.scrollTo({ top: 0, behavior: 'instant' }),
})
</script>

<template>
  <div
    ref="scroller"
    class="page-surface"
    :class="{ 'page-surface--fixed': fixed, 'page-surface--reading': reading }"
    @scroll.passive="save"
    @wheel.passive="stopRestoring"
    @touchstart.passive="stopRestoring"
    @pointerdown="stopRestoring"
  >
    <div class="page-surface-content"><slot /></div>
    <div v-if="$slots.footer" class="page-surface-footer"><slot name="footer" /></div>
  </div>
</template>

<style scoped>
.page-surface {
  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  overflow-anchor: none;
  scrollbar-gutter: auto;
}
.page-surface-content,
.page-surface-footer {
  width: min(100%, var(--workspace-width));
  margin-inline: auto;
  padding: var(--page-gutter-block) var(--page-gutter-inline);
}
.page-surface--fixed {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.page-surface--fixed .page-surface-content {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.page-surface--fixed:has(> .page-surface-footer) .page-surface-content {
  padding-bottom: 0;
}
.page-surface-footer {
  flex: 0 0 auto;
  padding-top: 0;
}
.page-surface--reading .page-surface-content {
  max-width: 1040px;
}
</style>
