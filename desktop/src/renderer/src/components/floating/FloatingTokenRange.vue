<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AnchoredPopover from '../base/AnchoredPopover.vue'
import DesignIcon from '../base/DesignIcon.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import FloatingBaselinePicker from './FloatingBaselinePicker.vue'
import type { FloatingTrendRange } from '../../composables/useFloatingTokenTrend'
import { useI18n } from '../../i18n/useI18n'
import { localDate, parseDateInput } from '../../utils/date-range'

const props = defineProps<{
  range: FloatingTrendRange
  baselineAt: number | null
}>()
const emit = defineEmits<{
  'update:range': [value: FloatingTrendRange]
  baseline: [timestamp: number]
}>()
const { label } = useI18n()
const anchor = ref<HTMLElement | null>(null)
const editorOpen = ref(false)
const date = ref('')
const time = ref('')
const error = ref('')
const today = ref('')
const options = computed(() => [
  ...(['1h', '5h', '24h', '7d'] as const).map((value) => ({ value, label: value })),
  { value: 'custom', label: label('Custom', '自定义') },
])
const pad = (value: number): string => String(value).padStart(2, '0')
function fill(timestamp: number): void {
  const start = new Date(timestamp)
  const now = new Date()
  today.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  date.value = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`
  time.value = `${pad(start.getHours())}:${pad(start.getMinutes())}:${pad(start.getSeconds())}`
  error.value = ''
}
watch(editorOpen, (value) => {
  if (value) fill(props.baselineAt ?? Date.now())
})
watch([date, time], () => (error.value = ''))
function select(value: string | number): void {
  if (value === 'custom') editorOpen.value = !editorOpen.value
  else if (value === '1h' || value === '5h' || value === '24h' || value === '7d') {
    editorOpen.value = false
    emit('update:range', value)
  }
}
function midnight(): void {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  fill(+now)
}
function apply(): void {
  const day = parseDateInput(date.value)
  const clock = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(time.value)
  const selectedTime = clock ? `${clock[1]}:${clock[2]}:${clock[3] || '00'}` : ''
  const timestamp = day && clock ? Date.parse(`${day}T${selectedTime}`) : NaN
  const selected = new Date(timestamp)
  if (
    !day ||
    !clock ||
    !Number.isFinite(timestamp) ||
    timestamp < 0 ||
    localDate(selected) !== day ||
    `${pad(selected.getHours())}:${pad(selected.getMinutes())}:${pad(selected.getSeconds())}` !==
      selectedTime
  ) {
    error.value = label('Choose a valid date and time.', '请选择有效的日期和时间。')
    return
  }
  if (timestamp > Date.now()) {
    error.value = label('The start time cannot be in the future.', '统计起点不能晚于现在。')
    return
  }
  emit('baseline', timestamp)
  editorOpen.value = false
}
</script>

<template>
  <div ref="anchor" class="floating-range-options">
    <SegmentedControl
      :model-value="range"
      appearance="light"
      :options="options"
      :label="label('Time range', '时间范围')"
      compact
      @update:model-value="select"
    />
  </div>
  <AnchoredPopover
    v-model="editorOpen"
    :anchor="anchor"
    :label="label('Custom statistics start', '自定义统计起点')"
    compact
  >
    <form class="floating-baseline-editor" novalidate @submit.prevent="apply">
      <header>
        <strong>{{ label('Custom start', '自定义起点') }}</strong>
        <button
          type="button"
          class="workspace-button workspace-button--icon floating-baseline-close"
          :aria-label="label('Close baseline settings', '关闭基线设置')"
          @click="editorOpen = false"
        >
          <DesignIcon name="floatingClose" :size="13" />
        </button>
      </header>
      <FloatingBaselinePicker
        v-if="editorOpen"
        v-model:date="date"
        v-model:time="time"
        :today="today"
        :invalid="Boolean(error)"
      />
      <p v-if="error" class="floating-baseline-error" role="alert">{{ error }}</p>
      <footer>
        <div class="floating-baseline-shortcuts">
          <button
            type="button"
            class="workspace-button floating-baseline-link"
            :title="label('Today at midnight', '今天零点')"
            @click="midnight"
          >
            {{ label('Midnight', '今天零点') }}
          </button>
          <button
            type="button"
            class="workspace-button floating-baseline-link"
            @click="fill(Date.now())"
          >
            {{ label('Now', '现在') }}
          </button>
        </div>
        <div class="floating-baseline-actions">
          <button type="button" class="workspace-button" @click="editorOpen = false">
            {{ label('Cancel', '取消') }}
          </button>
          <button
            type="submit"
            class="workspace-button workspace-button--primary"
            :aria-label="label('Apply baseline', '应用基线')"
          >
            {{ label('Apply', '应用') }}
          </button>
        </div>
      </footer>
    </form>
  </AnchoredPopover>
</template>

<style scoped>
.floating-range-options {
  min-width: 0;
  margin-bottom: 12px;
}
.floating-range-options :deep(.selection-control) {
  width: 100%;
  --selection-height: 32px;
}
.floating-range-options :deep(.selection-option) {
  flex: 1 1 0;
  padding-inline: 3px;
  font-size: 12px;
}
.floating-range-options :deep(.selection-pill) {
  background: var(--primary-soft);
}
.floating-range-options :deep(.selection-inverted) {
  color: var(--primary-soft-text);
}
.floating-baseline-editor {
  width: 246px;
  max-width: 100%;
  display: grid;
  gap: 10px;
}
.floating-baseline-editor header,
.floating-baseline-editor footer,
.floating-baseline-shortcuts,
.floating-baseline-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}
.floating-baseline-editor header {
  height: 20px;
  justify-content: space-between;
}
.floating-baseline-editor header strong {
  font-size: 13px;
  font-weight: 600;
}
.floating-baseline-editor footer {
  height: 28px;
  justify-content: space-between;
}
.floating-baseline-editor .workspace-button {
  height: 28px;
  min-height: 0;
  padding-inline: 8px;
  border-radius: 5px;
  font-size: 11px;
}
.floating-baseline-editor .floating-baseline-close {
  width: 20px;
  height: 20px;
  padding: 0;
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
}
.floating-baseline-editor .workspace-button--primary {
  padding-inline: 12px;
}
.floating-baseline-shortcuts {
  gap: 10px;
}
.floating-baseline-editor .floating-baseline-link {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--primary-soft-text);
}
.floating-baseline-actions > .workspace-button:not(.workspace-button--primary) {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
}
.floating-baseline-editor .floating-baseline-error {
  margin: 0;
  color: var(--error);
  font-size: 11px;
  line-height: 16px;
}
</style>
