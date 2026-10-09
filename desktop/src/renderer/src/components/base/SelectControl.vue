<script setup lang="ts" generic="T extends string | number">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import DropdownChevron from './DropdownChevron.vue'
import SelectionPopover from './SelectionPopover.vue'
import { useI18n } from '../../i18n/useI18n'

defineOptions({ inheritAttrs: false })
const props = withDefaults(
  defineProps<{
    modelValue: T
    options: readonly { value: T; label: string; disabled?: boolean }[]
    label: string
    compact?: boolean
    disabled?: boolean
    placement?: 'auto' | 'top'
    minMenuWidth?: number
  }>(),
  { compact: false, disabled: false, placement: 'auto', minMenuWidth: 120 },
)
const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
const { label: text } = useI18n()
const id = useId()
const anchor = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
const active = ref(-1)
const selected = computed(() =>
  props.options.findIndex((option) => option.value === props.modelValue),
)
const selectedLabel = computed(
  () => props.options[selected.value]?.label ?? String(props.modelValue),
)
const menuWidth = computed(() =>
  Math.max(
    props.minMenuWidth,
    Math.min(
      320,
      Math.max(
        0,
        ...props.options.map((option) =>
          [...option.label].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 13 : 7), 0),
        ),
      ) + 58,
    ),
  ),
)
let typed = ''
let timer: ReturnType<typeof setTimeout> | undefined
function enabled(): number[] {
  return props.options.flatMap((option, index) => (option.disabled ? [] : [index]))
}
function focusOption(index: number): void {
  active.value = index
  void nextTick(() =>
    menu.value
      ?.querySelectorAll<HTMLButtonElement>('[role="option"]')
      [index]?.focus({ preventScroll: false }),
  )
}
function opened(): void {
  focusOption(
    selected.value >= 0 && !props.options[selected.value]?.disabled
      ? selected.value
      : (enabled()[0] ?? -1),
  )
}
function choose(index: number): void {
  const option = props.options[index]
  if (!option || option.disabled || props.disabled) return
  emit('update:modelValue', option.value)
  open.value = false
  anchor.value?.focus()
}
function keydown(event: KeyboardEvent): void {
  if (props.disabled) return
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (keys.includes(event.key)) {
    event.preventDefault()
    if (!open.value) {
      open.value = true
      return
    }
    const values = enabled()
    if (!values.length) return
    const current = values.indexOf(active.value)
    focusOption(
      event.key === 'Home'
        ? values[0]!
        : event.key === 'End'
          ? values.at(-1)!
          : values[
              (current + (event.key === 'ArrowDown' ? 1 : -1) + values.length) % values.length
            ]!,
    )
  } else if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    event.key !== ' '
  ) {
    event.preventDefault()
    clearTimeout(timer)
    typed += event.key.toLocaleLowerCase()
    timer = setTimeout(() => {
      typed = ''
    }, 700)
    const values = enabled()
    const from = values.indexOf(active.value)
    const ordered = [...values.slice(from + 1), ...values.slice(0, from + 1)]
    const match = ordered.find((index) =>
      props.options[index]!.label.toLocaleLowerCase().startsWith(typed),
    )
    if (match !== undefined) {
      if (open.value) focusOption(match)
      else choose(match)
    }
  } else if (event.key === 'Tab') {
    open.value = false
    anchor.value?.focus()
  }
}
watch(
  () => props.disabled,
  (value) => {
    if (value) open.value = false
  },
)
watch(
  () => props.options,
  (options, previous) => {
    if (!open.value) return
    const value = previous[active.value]?.value
    const index = options.findIndex((option) => option.value === value && !option.disabled)
    if (index < 0) opened()
    else if (index !== active.value) focusOption(index)
  },
  { deep: true },
)
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <button
    ref="anchor"
    v-bind="$attrs"
    type="button"
    class="select-control"
    :class="{ 'select-control--compact': compact }"
    role="combobox"
    :disabled="disabled"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="id"
    aria-haspopup="listbox"
    :title="selectedLabel"
    @click="open = !open"
    @keydown="keydown"
  >
    <span class="select-control-value">{{ selectedLabel }}</span>
    <DropdownChevron :open="open" />
  </button>
  <SelectionPopover
    :id="id"
    v-model="open"
    :anchor="anchor"
    :label="label"
    :width="menuWidth"
    :max-height="Math.min(320, Math.max(48, options.length * 36 + 8))"
    :placement="placement"
    role="listbox"
    class="select-menu"
    @opened="opened"
  >
    <div ref="menu" class="select-menu-options selection-list" @keydown="keydown">
      <button
        v-for="(option, index) in options"
        :key="option.value"
        type="button"
        class="select-menu-option"
        role="option"
        :aria-selected="option.value === modelValue"
        :disabled="option.disabled"
        :tabindex="index === active ? 0 : -1"
        :title="option.label"
        @focus="active = index"
        @click="choose(index)"
      >
        <span>{{ option.label }}</span>
        <span class="material-symbols-outlined select-option-check" aria-hidden="true">check</span>
      </button>
      <p v-if="!options.length">{{ text('No options', '暂无选项') }}</p>
    </div>
  </SelectionPopover>
</template>
<style scoped>
.select-control {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: var(--control-height);
  min-width: 0;
  max-width: 100%;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--control-radius);
  background: var(--surface-low);
  color: var(--text);
  font: 500 13px/20px var(--font-sans);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition:
    border-color var(--motion-popover) var(--motion-ease),
    color var(--motion-popover) var(--motion-ease);
}
.select-control--compact {
  height: var(--control-height-compact);
  padding: 0 8px;
  border-radius: var(--control-radius-compact);
  font-size: 12px;
}
.select-control:hover:not(:disabled),
.select-control[aria-expanded='true'] {
  border-color: var(--primary-border);
  color: var(--accent);
}
.select-control:disabled {
  opacity: 0.45;
  cursor: default;
}
.select-control:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.select-control-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.select-menu-options {
  min-height: 0;
  overflow: auto;
  padding: 5px;
  overscroll-behavior: contain;
}
.select-menu-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  min-height: 32px;
  padding: 5px 9px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: 400 13px/20px var(--font-sans);
  cursor: pointer;
}
.select-menu-option > span:first-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.select-menu-option:hover:not(:disabled),
.select-menu-option:focus-visible {
  background: var(--bg-hover);
}
.select-menu-option[aria-selected='true'] {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.select-menu-option:disabled {
  opacity: 0.45;
  cursor: default;
}
.select-option-check {
  font-size: 16px;
  flex: none;
  visibility: hidden;
}
.select-menu-option[aria-selected='true'] .select-option-check {
  visibility: visible;
}
.select-menu-options p {
  margin: 8px;
  font-size: 12px;
  color: var(--text-soft);
}
</style>
