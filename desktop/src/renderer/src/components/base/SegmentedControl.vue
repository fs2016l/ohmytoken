<script setup lang="ts">
import { computed, nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
import { motion, selectionProgress } from '../../config/motion'
import { useMotionVisibility } from '../../composables/useMotionVisibility'

export interface SelectionOption {
  value: string | number
  label: string
  title?: string
  disabled?: boolean
}
const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: readonly SelectionOption[]
    label: string
    compact?: boolean
    appearance?: 'group' | 'light' | 'separated' | 'underline'
  }>(),
  { compact: false, appearance: 'group' },
)
const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()
const root = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(root)
const positions = ref<{ left: number; width: number }[]>([])
const pill = ref({ left: 0, width: 0 })
const index = computed(() => props.options.findIndex((option) => option.value === props.modelValue))
const pillStyle = computed(() => ({
  transform: `translateX(${pill.value.left}px)`,
  width: `${pill.value.width}px`,
}))
let frame = 0
let resize: ResizeObserver | undefined

function measure(animate = false): void {
  if (!root.value) return
  positions.value = Array.from(
    root.value.querySelectorAll<HTMLButtonElement>('.selection-option'),
  ).map((button) => ({ left: button.offsetLeft, width: button.offsetWidth }))
  const target = positions.value[index.value] ?? { left: pill.value.left, width: 0 }
  cancelAnimationFrame(frame)
  if (!animate || reduced.value || !visible.value || pill.value.width === 0) {
    pill.value = { ...target }
    return
  }
  const origin = { ...pill.value }
  const start = performance.now()
  const tick = (now: number): void => {
    const progress = Math.min(1, (now - start) / motion.selection)
    const spring = selectionProgress(progress)
    pill.value = {
      left: origin.left + (target.left - origin.left) * spring,
      width: Math.max(0, origin.width + (target.width - origin.width) * spring),
    }
    if (progress < 1) frame = requestAnimationFrame(tick)
  }
  frame = requestAnimationFrame(tick)
}

function mask(optionIndex: number): Record<string, string> {
  const position = positions.value[optionIndex]
  if (!position) return { visibility: 'hidden' }
  const left = Math.max(0, Math.min(position.width, pill.value.left - position.left))
  const right = Math.max(
    0,
    Math.min(position.width, position.left + position.width - pill.value.left - pill.value.width),
  )
  return { clipPath: `inset(0 ${right}px 0 ${left}px)` }
}

function navigate(event: KeyboardEvent, from: number): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const enabled = props.options.map((option, i) => (option.disabled ? -1 : i)).filter((i) => i >= 0)
  if (!enabled.length) return
  const current = enabled.indexOf(from)
  const target =
    event.key === 'Home'
      ? enabled[0]!
      : event.key === 'End'
        ? enabled.at(-1)!
        : enabled[
            (current + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length
          ]!
  emit('update:modelValue', props.options[target]!.value)
  root.value?.querySelectorAll<HTMLButtonElement>('.selection-option')[target]?.focus()
}

watch(
  () => props.modelValue,
  () => {
    void nextTick(() => measure(true))
  },
)
watch(
  // Inline option arrays are recreated on selection; only content changes resize the pill.
  () => JSON.stringify(props.options),
  () => {
    void nextTick(() => measure())
  },
)
watch([visible, reduced], () => {
  if (!visible.value || reduced.value) measure()
})
onMounted(() => {
  measure()
  resize = new ResizeObserver(() => measure())
  if (root.value) resize.observe(root.value)
  void document.fonts.ready.then(() => measure())
})
onActivated(() => {
  void nextTick(() => measure())
})
onUnmounted(() => {
  cancelAnimationFrame(frame)
  resize?.disconnect()
})
</script>

<template>
  <div
    ref="root"
    class="selection-control"
    :class="{
      'selection-control--compact': compact,
      'selection-control--light': appearance === 'light',
      'selection-control--separated': appearance === 'separated',
      'selection-control--underline': appearance === 'underline',
    }"
    role="tablist"
    :aria-label="label"
  >
    <span class="selection-pill" :style="pillStyle" aria-hidden="true" />
    <button
      v-for="(option, i) in options"
      :key="option.value"
      class="selection-option"
      type="button"
      role="tab"
      :title="option.title"
      :aria-selected="option.value === modelValue"
      :disabled="option.disabled"
      :tabindex="i === index || (index < 0 && i === 0) ? 0 : -1"
      @click="emit('update:modelValue', option.value)"
      @keydown="navigate($event, i)"
    >
      <span>
        <slot name="option" :option="option">{{ option.label }}</slot>
      </span>
      <span
        v-if="appearance !== 'underline'"
        class="selection-inverted"
        :style="mask(i)"
        aria-hidden="true"
      >
        <slot name="option" :option="option">{{ option.label }}</slot>
      </span>
    </button>
  </div>
</template>

<style scoped>
.selection-control {
  --selection-inset: 3px;
  --selection-height: var(--control-height);
  display: inline-flex;
  align-items: center;
  position: relative;
  isolation: isolate;
  gap: 2px;
  padding: var(--selection-inset);
  height: var(--selection-height);
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-low);
  max-width: 100%;
}
.selection-pill {
  position: absolute;
  top: var(--selection-inset);
  bottom: var(--selection-inset);
  left: 0;
  border-radius: 4px;
  background: var(--primary);
  pointer-events: none;
}
.selection-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: calc(var(--selection-height) - 2 * var(--selection-inset) - 2px);
  min-height: 0;
  padding: 0 12px;
  flex-shrink: 0;
  min-width: 0;
  border: 0;
  border-radius: 4px;
  font: 500 13px/20px var(--font-sans);
  color: var(--text-muted);
  background: transparent;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--motion-hover) var(--motion-ease);
}
.selection-option:hover:not(:disabled) {
  color: var(--accent);
}
.selection-option:disabled {
  opacity: 0.45;
  cursor: default;
}
.selection-option:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.selection-inverted {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary-on);
  pointer-events: none;
}
.selection-control--compact {
  --selection-height: var(--control-height-compact);
  --selection-inset: 2px;
  border-radius: var(--control-radius-compact);
}
.selection-control--compact .selection-option {
  padding: 0 10px;
  font-size: 12px;
}
.selection-control--light {
  background: var(--surface-low);
}
.selection-control--light .selection-option {
  color: var(--text);
  transition:
    color var(--motion-hover) var(--motion-ease),
    background var(--motion-hover) var(--motion-ease);
}
.selection-control--light .selection-option:hover:not(:disabled):not([aria-selected='true']) {
  color: var(--accent);
  background: color-mix(in srgb, var(--primary) 6%, transparent);
}
.selection-control--light .selection-pill {
  background: color-mix(in srgb, var(--primary) 15%, var(--surface-low));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--primary) 38%, var(--surface-low));
}
.selection-control--light .selection-inverted {
  color: var(--accent);
}
.selection-control--separated {
  --selection-inset: 0px;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
}
.selection-control--separated .selection-option {
  height: var(--selection-height);
  color: var(--text);
  border-radius: var(--control-radius);
}
.selection-control--separated .selection-option::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -2;
  border: 1px solid var(--border-strong);
  border-radius: inherit;
  background: var(--surface-low);
}
.selection-control--separated .selection-pill {
  z-index: -1;
  border-radius: var(--control-radius);
}
.selection-control--underline {
  --selection-inset: 0px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.selection-control--underline .selection-pill {
  top: auto;
  bottom: 0;
  height: 2px;
  border-radius: 2px;
}
.selection-control--underline .selection-option {
  height: var(--selection-height);
  padding-inline: 9px;
  font-size: 12px;
  font-weight: 600;
  user-select: none;
  transition:
    color var(--motion-hover) var(--motion-ease),
    transform var(--motion-hover) var(--motion-ease);
}
.selection-control--underline .selection-option > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.selection-control--underline .selection-option[aria-selected='true'] {
  color: var(--accent);
}
.selection-control--underline .selection-option:active:not(:disabled) {
  transform: translateY(1px);
}
@media (prefers-reduced-motion: reduce) {
  .selection-option,
  .selection-control--light .selection-option,
  .selection-control--underline .selection-option {
    transition: none;
  }
}
</style>
