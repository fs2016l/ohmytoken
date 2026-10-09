<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { motion } from '../../config/motion'
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    anchor: HTMLElement | null
    label: string
    id: string
    width: number
    maxHeight?: number
    role?: 'dialog' | 'listbox' | 'tooltip'
    placement?: 'auto' | 'top'
  }>(),
  { maxHeight: 360, role: 'dialog', placement: 'auto' },
)
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ opened: [element: HTMLElement] }>()
const panel = ref<HTMLElement | null>(null)
const side = ref('bottom')
let animation: Animation | undefined
let resize: ResizeObserver | undefined

function place(): void {
  const element = panel.value
  const anchor = props.anchor?.getBoundingClientRect()
  if (!element || !anchor || !open.value) return
  const width = Math.min(Math.max(props.width, anchor.width), innerWidth - 24)
  const below = innerHeight - anchor.bottom - 20
  const above = anchor.top - 20
  const up =
    props.placement === 'top'
      ? above >= Math.min(props.maxHeight, below)
      : below < props.maxHeight && above > below
  const height = Math.max(0, Math.min(props.maxHeight, up ? above : below))
  const left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12))
  side.value = up ? 'top' : 'bottom'
  element.style.width = `${width}px`
  element.style.maxHeight = `${height}px`
  element.style.left = `${left}px`
  element.style.top = `${up ? Math.max(12, anchor.top - element.offsetHeight - 8) : anchor.bottom + 8}px`
  element.style.setProperty(
    '--selection-arrow-left',
    `${Math.max(14, Math.min(width - 24, anchor.left + anchor.width / 2 - left))}px`,
  )
}
function unlisten(): void {
  resize?.disconnect()
  window.removeEventListener('resize', place)
  window.removeEventListener('scroll', scrolled, true)
  window.removeEventListener('keydown', escape, true)
}
function escape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !panel.value?.matches(':popover-open')) return
  event.preventDefault()
  event.stopPropagation()
  close(props.role !== 'tooltip')
}
function scrolled(event: Event): void {
  const inside = event.target instanceof Node && panel.value?.contains(event.target)
  if (props.role === 'tooltip' && !inside) close()
  else place()
}
function close(focus = false): void {
  open.value = false
  if (focus) props.anchor?.focus()
}
watch(
  open,
  async (value) => {
    await nextTick()
    const element = panel.value
    if (!element || value !== open.value) return
    animation?.cancel()
    unlisten()
    if (!value) {
      if (element.matches(':popover-open')) element.hidePopover()
      return
    }
    element.showPopover()
    place()
    resize = new ResizeObserver(place)
    resize.observe(element)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('keydown', escape, true)
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      animation = element.animate(
        [
          { opacity: 0, transform: `translateY(${side.value === 'top' ? 4 : -4}px)` },
          { opacity: 1, transform: 'translateY(0)' },
        ],
        { duration: motion.popover, easing: motion.ease },
      )
    }
    emit('opened', element)
  },
  { flush: 'post' },
)
watch(
  () => [props.width, props.maxHeight],
  () => void nextTick(place),
)
function toggled(event: Event): void {
  if ((event as ToggleEvent).newState === 'closed' && !panel.value?.matches(':popover-open'))
    close()
}
onDeactivated(() => close())
onBeforeUnmount(() => {
  unlisten()
  animation?.cancel()
})
</script>
<template>
  <Teleport
    :to="
      anchor?.closest('[data-selection-scope]')?.querySelector('[data-selection-host]') ||
      anchor?.closest('dialog') ||
      'body'
    "
  >
    <div
      v-bind="$attrs"
      :id="id"
      ref="panel"
      :popover="role === 'tooltip' ? 'manual' : 'auto'"
      class="selection-popover"
      :data-side="side"
      :role="role"
      :aria-label="label"
      @toggle="toggled"
    >
      <slot />
    </div>
  </Teleport>
</template>
<style scoped>
.selection-popover {
  position: fixed;
  inset: auto;
  margin: 0;
  padding: 0;
  overflow: visible;
  flex-direction: column;
  color: var(--text);
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-popover);
  -webkit-app-region: no-drag;
}
.selection-popover:popover-open {
  display: flex;
}
.selection-popover::before {
  content: '';
  position: absolute;
  top: -5px;
  left: var(--selection-arrow-left);
  width: 8px;
  height: 8px;
  transform: rotate(45deg);
  background: var(--surface-low);
  border-top: 1px solid var(--border);
  border-left: 1px solid var(--border);
}
.selection-popover[data-side='top']::before {
  top: auto;
  bottom: -5px;
  border: 0;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
</style>
