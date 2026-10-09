<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { motion } from '../../config/motion'
const props = defineProps<{ anchor: HTMLElement | null; label: string; compact?: boolean }>()
const open = defineModel<boolean>({ required: true })
const panel = ref<HTMLElement | null>(null)
const sizeObserver = new ResizeObserver(place)
function place(): void {
  const element = panel.value,
    rect = props.anchor?.getBoundingClientRect()
  if (!element || !rect) return
  element.style.left = `${Math.max(12, Math.min(rect.right - element.offsetWidth, innerWidth - element.offsetWidth - 12))}px`
  element.style.top = `${Math.max(12, Math.min(rect.bottom + 8, innerHeight - element.offsetHeight - 12))}px`
}
function close(): void {
  open.value = false
}
watch(
  open,
  async (value) => {
    await nextTick()
    if (!panel.value) return
    if (value) {
      panel.value.showPopover()
      place()
      sizeObserver.observe(panel.value)
      window.addEventListener('resize', place)
      window.addEventListener('scroll', place, true)
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        panel.value.animate(
          [
            { opacity: 0, transform: 'translateY(-4px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: motion.popover, easing: motion.ease },
        )
      panel.value.querySelector<HTMLElement>('input,button,[tabindex]')?.focus()
    } else {
      panel.value.hidePopover()
      sizeObserver.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  },
  { flush: 'post' },
)
function toggled(event: Event): void {
  if ((event as ToggleEvent).newState === 'closed') open.value = false
}
onDeactivated(close)
onBeforeUnmount(() => {
  sizeObserver.disconnect()
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', place, true)
})
</script>
<template>
  <Teleport to="body">
    <div
      ref="panel"
      popover="auto"
      class="workspace-popover"
      :class="{ 'workspace-popover--compact': compact }"
      role="dialog"
      :aria-label="label"
      @toggle="toggled"
    >
      <slot :close="close" />
    </div>
  </Teleport>
</template>
<style scoped>
.workspace-popover {
  position: fixed;
  margin: 0;
  inset: auto;
  max-width: calc(100vw - 24px);
  max-height: calc(100vh - 24px);
  overflow: auto;
  padding: 20px;
  background: var(--surface-low);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-popover);
}
.workspace-popover--compact {
  padding: 12px;
  border-radius: 11px;
}
</style>
