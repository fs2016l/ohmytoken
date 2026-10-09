<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { enUS, zhCN } from 'date-fns/locale'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import { localDate, parseDateInput } from '../../utils/date-range'
import '../../styles/date-picker.css'

const props = defineProps<{ today: string; invalid?: boolean }>()
const date = defineModel<string>('date', { required: true })
const time = defineModel<string>('time', { required: true })
const calendarOpen = defineModel<boolean>('calendarOpen', { required: true })
const { label, currentLang } = useI18n()
const { currentTheme } = useTheme()
const picker = ref<InstanceType<typeof VueDatePicker> | null>(null)
const calendarPanel = ref<HTMLElement | null>(null)
const dateButton = ref<HTMLButtonElement | null>(null)
const timeInput = ref<HTMLInputElement | null>(null)
const dateId = useId(),
  timeId = useId(),
  panelId = useId()
const normalizedDate = computed(() => parseDateInput(date.value))
const dateText = computed({
  get: () => date.value.replaceAll('-', '/'),
  set: (value: string) => (date.value = value.replaceAll('/', '-')),
})
const selection = computed({
  get: () => (normalizedDate.value ? new Date(`${normalizedDate.value}T00:00:00`) : null),
  set: (value: Date | null) => {
    if (!value) return
    date.value = localDate(value)
    closeCalendar()
  },
})
const validTime = computed(() => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time.value))

async function closeCalendar(): Promise<void> {
  calendarOpen.value = false
  await nextTick()
  dateButton.value?.focus()
}
function chooseToday(): void {
  date.value = props.today
  closeCalendar()
}
function segment(): number {
  return Math.min(2, Math.floor((timeInput.value?.selectionStart ?? 0) / 3))
}
async function selectSegment(index = segment()): Promise<void> {
  await nextTick()
  timeInput.value?.setSelectionRange(index * 3, index * 3 + 2)
}
function focusTime(): void {
  timeInput.value?.focus()
  selectSegment(0)
}
function stepTime(index: number, value: number | 'min' | 'max'): void {
  if (!validTime.value) return
  const parts = time.value.split(':').map(Number)
  parts[2] ??= 0
  const max = index === 0 ? 23 : 59
  parts[index] =
    value === 'min' ? 0 : value === 'max' ? max : Math.max(0, Math.min(max, parts[index] + value))
  time.value = parts.map((part) => String(part).padStart(2, '0')).join(':')
  selectSegment(index)
}
function timeKey(event: KeyboardEvent): void {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
  const index = segment()
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    selectSegment(Math.max(0, Math.min(2, index + (event.key === 'ArrowRight' ? 1 : -1))))
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    stepTime(index, event.key === 'ArrowUp' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault()
    stepTime(index, event.key === 'Home' ? 'min' : 'max')
  }
}
function timeWheel(event: WheelEvent): void {
  if (document.activeElement !== timeInput.value || event.deltaY === 0) return
  event.preventDefault()
  stepTime(segment(), event.deltaY < 0 ? 1 : -1)
}
watch(calendarOpen, async (open) => {
  if (!open) return
  const value = selection.value ?? new Date(`${props.today}T00:00:00`)
  await nextTick()
  picker.value?.setMonthYear({ month: value.getMonth(), year: value.getFullYear() })
  await nextTick()
  calendarPanel.value
    ?.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"]')
    ?.focus()
})
</script>

<template>
  <div v-if="!calendarOpen" class="baseline-fields">
    <div class="baseline-input baseline-date-input">
      <button
        ref="dateButton"
        type="button"
        :aria-label="label('Choose date', '选择日期')"
        :aria-controls="panelId"
        :aria-expanded="calendarOpen"
        @click="calendarOpen = true"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="5" width="16" height="16" rx="3" />
          <path d="M8 3v4m8-4v4M4 10h16" />
        </svg>
      </button>
      <input
        :id="dateId"
        v-model="dateText"
        type="text"
        placeholder="YYYY/MM/DD"
        maxlength="10"
        autocomplete="off"
        spellcheck="false"
        :aria-label="label('Date', '日期')"
        :aria-invalid="invalid || Boolean(date && !normalizedDate)"
        @keydown.alt.down.prevent="calendarOpen = true"
      />
    </div>
    <div class="baseline-input baseline-time-input">
      <button type="button" :aria-label="label('Edit time', '编辑时间')" @click="focusTime">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7v5l3 2" />
        </svg>
      </button>
      <input
        :id="timeId"
        ref="timeInput"
        v-model="time"
        type="text"
        placeholder="HH:mm:ss"
        maxlength="8"
        autocomplete="off"
        spellcheck="false"
        :aria-label="label('Time', '时间')"
        :aria-invalid="invalid || Boolean(time && !validTime)"
        :title="
          label(
            'Type a time, or adjust with arrow keys and the mouse wheel',
            '输入时间，或用方向键和滚轮微调',
          )
        "
        @click="selectSegment()"
        @keydown="timeKey"
        @wheel="timeWheel"
      />
    </div>
  </div>
  <div
    v-else
    :id="panelId"
    ref="calendarPanel"
    class="baseline-panel"
    @keydown.esc.capture.stop.prevent="closeCalendar"
  >
    <VueDatePicker
      ref="picker"
      v-model="selection"
      inline
      auto-apply
      :time-config="{ enableTimePicker: false }"
      :locale="currentLang === 'zh' ? zhCN : enUS"
      :dark="currentTheme === 'dark'"
      :min-date="new Date(1970, 0, 1)"
      :max-date="new Date(`${today}T00:00:00`)"
      prevent-min-max-navigation
      :week-start="1"
      :day-names="currentLang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : undefined"
      :year-first="currentLang === 'zh'"
      :formats="{
        month: currentLang === 'zh' ? 'M 月' : 'MMM',
        year: currentLang === 'zh' ? 'yyyy 年' : 'yyyy',
      }"
      :aria-labels="{
        menu: label('Choose date', '选择日期'),
        nextMonth: label('Next month', '下个月'),
        prevMonth: label('Previous month', '上个月'),
        openMonthsOverlay: label('Choose month', '选择月份'),
        openYearsOverlay: label('Choose year', '选择年份'),
        day: (day) => localDate(day.value).replaceAll('-', '/'),
      }"
      :config="{ monthChangeOnScroll: false }"
      :transitions="false"
      class="baseline-calendar"
    />
    <div class="baseline-calendar-footer">
      <button type="button" class="baseline-back" @click="closeCalendar">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
        {{ label('Back to edit', '返回编辑') }}
      </button>
      <button type="button" class="baseline-today" @click="chooseToday">
        {{ label('Today', '今天') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.baseline-fields {
  display: grid;
  grid-template-columns: minmax(0, 126fr) minmax(0, 112fr);
  gap: 8px;
}
.baseline-input {
  display: flex;
  align-items: center;
  height: 30px;
  padding-inline: 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-low);
}
.baseline-input:focus-within {
  border-color: var(--primary-border);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
.baseline-input:has(input[aria-invalid='true']) {
  border-color: var(--error);
}
.baseline-input input {
  width: 100%;
  min-width: 0;
  height: 100%;
  padding: 0 0 0 4px;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font-family: var(--font-number);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.baseline-input input::placeholder {
  color: var(--text-soft);
}
.baseline-input input::selection {
  color: var(--primary);
  background: var(--primary-soft);
}
.baseline-input button {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.baseline-input:focus-within button {
  color: var(--primary);
}
.baseline-input svg,
.baseline-back svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.baseline-calendar :deep(.dp--menu) {
  --dp-background-color: var(--surface-low);
  --dp-text-color: var(--text);
  --dp-hover-color: var(--bg-hover);
  --dp-hover-text-color: var(--text);
  --dp-primary-color: var(--primary);
  --dp-primary-text-color: var(--primary-on);
  --dp-icon-color: var(--text-muted);
  --dp-hover-icon-color: var(--primary);
  --dp-secondary-color: var(--text-disabled);
  --dp-disabled-color: transparent;
  --dp-disabled-color-text: var(--text-disabled);
  --dp-border-color: var(--border);
  --dp-menu-border-color: transparent;
  --dp-font-family: var(--font-ui);
  --dp-font-size: 11px;
  --dp-cell-size: 28px;
  --dp-cell-padding: 0;
  --dp-cell-border-radius: 6px;
  --dp-row-margin: 2px 0;
  --dp-menu-min-width: 0;
  --dp-month-year-row-height: 28px;
  --dp-month-year-row-button-size: 24px;
  --dp-button-icon-height: 13px;
  --dp-calendar-wrap-padding: 0;
  width: 100%;
  border: 0;
}
.baseline-calendar :deep(.dp--menu-inner) {
  padding: 0;
}
.baseline-calendar :deep(.dp--month-year-wrap) {
  order: -1;
  justify-content: flex-start;
}
.baseline-calendar :deep(.dp--month-year-select) {
  width: auto;
  padding-inline: 3px;
  color: var(--text);
  font-size: 12px;
  font-weight: 550;
}
.baseline-calendar :deep(.dp--calendar-header-separator) {
  display: none;
}
.baseline-calendar :deep(.dp--calendar-header-item) {
  height: 22px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
}
.baseline-calendar :deep(.dp--calendar-row),
.baseline-calendar :deep(.dp--calendar-header) {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  column-gap: 4px;
}
.baseline-calendar :deep(.dp--calendar-header-item),
.baseline-calendar :deep(.dp--calendar-item) {
  min-width: 0;
  width: auto;
}
.baseline-calendar :deep(.dp--cell-inner) {
  width: 28px;
  margin-inline: auto;
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums;
}
.baseline-calendar :deep(.dp--cell-inner.dp--active) {
  background: var(--primary);
  color: var(--primary-on);
  font-weight: 600;
}
.baseline-calendar :deep(.dp--today:not(.dp--active)) {
  border-color: var(--primary-border);
  background: var(--primary-soft);
  color: var(--primary);
}
.baseline-calendar-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  margin-top: 10px;
}
.baseline-calendar-footer button {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 3px;
  border: 0;
  border-radius: 5px;
  color: var(--text-muted);
  background: transparent;
  font-size: 10px;
  cursor: pointer;
}
.baseline-calendar-footer .baseline-today {
  padding-inline: 10px;
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
</style>
