<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'

const time = defineModel<string>({ required: true })
const { label } = useI18n()
const root = ref<HTMLElement | null>(null)
const units = computed(() => [label('Hours', '时'), label('Minutes', '分'), label('Seconds', '秒')])
const parts = computed(() => {
  const values = time.value.split(':')
  return [23, 59, 59].map((max, index) => {
    const value = values[index]
    return value && /^\d{1,2}$/.test(value) && Number(value) <= max ? Number(value) : null
  })
})
const pad = (value: number): string => String(value).padStart(2, '0')

async function revealSelection(): Promise<void> {
  await nextTick()
  root.value?.querySelectorAll<HTMLElement>('[role="listbox"]').forEach((list) => {
    const selected = list.querySelector<HTMLElement>('[aria-selected="true"]')
    if (selected)
      list.scrollTop = selected.offsetTop - (list.clientHeight - selected.offsetHeight) / 2
  })
}
function choose(index: number, value: number): void {
  const next = parts.value.map((part) => part ?? 0)
  next[index] = value
  time.value = next.map(pad).join(':')
}
function keydown(event: KeyboardEvent, column: number, value: number): void {
  const max = column === 0 ? 23 : 59
  const targets: Record<string, number> = {
    ArrowUp: Math.max(0, value - 1),
    ArrowDown: Math.min(max, value + 1),
    Home: 0,
    End: max,
    PageUp: Math.max(0, value - 5),
    PageDown: Math.min(max, value + 5),
  }
  if (!(event.key in targets)) return
  event.preventDefault()
  const target = targets[event.key]
  choose(column, target)
  root.value
    ?.querySelectorAll('[role="listbox"]')
    [column]?.querySelectorAll<HTMLElement>('[role="option"]')
    [target]?.focus({ preventScroll: true })
}
watch(time, revealSelection)
onMounted(revealSelection)
</script>

<template>
  <div ref="root" class="baseline-time-picker">
    <div v-for="(unit, index) in units" :key="index" class="baseline-time-column">
      <span class="baseline-time-label" aria-hidden="true">{{ unit }}</span>
      <div class="baseline-time-list" role="listbox" :aria-label="unit">
        <button
          v-for="value in index === 0 ? 24 : 60"
          :key="value"
          type="button"
          role="option"
          :aria-selected="parts[index] === value - 1"
          :tabindex="(parts[index] ?? 0) === value - 1 ? 0 : -1"
          @click="choose(index, value - 1)"
          @keydown="keydown($event, index, value - 1)"
        >
          {{ pad(value - 1) }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.baseline-time-picker {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.baseline-time-column {
  min-width: 0;
  text-align: center;
}
.baseline-time-label {
  display: block;
  margin-bottom: 6px;
  color: var(--text-muted);
  font-size: 11px;
}
.baseline-time-list {
  position: relative;
  height: 140px;
  padding: 2px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border);
  border-radius: 6px;
  scrollbar-width: thin;
}
.baseline-time-list button {
  display: block;
  width: 100%;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-sans);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.baseline-time-list button:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.baseline-time-list button[aria-selected='true'] {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.baseline-time-list button:focus-visible {
  outline: 1px solid var(--primary-border);
  outline-offset: -1px;
}
</style>
