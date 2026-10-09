<script setup lang="ts">
import { computed, onDeactivated, reactive, ref, useId } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '../../styles/date-picker.css'
import { enUS, zhCN } from 'date-fns/locale'
import SegmentedControl from './SegmentedControl.vue'
import DropdownChevron from './DropdownChevron.vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import {
  localDate,
  presetRange,
  matchPreset,
  quickDateRange,
  parseDateInput,
  type DateRange,
  type DatePreset,
  type QuickDateRange,
} from '../../utils/date-range'

const model = defineModel<DateRange>({ required: true })
const { label, currentLang } = useI18n()
const { currentTheme } = useTheme()
const picker = ref<InstanceType<typeof VueDatePicker> | null>(null)
const open = ref(false)
const today = ref(new Date())
const draft = reactive({ from: '', to: '' })
const errorId = useId()
const shortcuts = computed(() => [
  { value: '15days' as const, label: label('Last 15 days', '最近15天') },
  { value: '3months' as const, label: label('Last 3 months', '最近3个月') },
  { value: '6months' as const, label: label('Last 6 months', '最近半年') },
  { value: 'year' as const, label: label('Last year', '最近一年') },
])
const options = computed(() => [
  { value: 'today', label: label('Today', '今天') },
  { value: 'week', label: label('Week', '本周') },
  { value: 'month', label: label('Month', '本月') },
  { value: 'all', label: label('All', '全部') },
])
const dates = computed({
  get: () =>
    model.value.from && model.value.to
      ? [new Date(`${model.value.from}T00:00:00`), new Date(`${model.value.to}T00:00:00`)]
      : null,
  set: (value: Date[] | null) => {
    if (value?.[0] && value[1]) {
      const from = localDate(value[0])
      const to = localDate(value[1])
      model.value = { from, to, preset: matchPreset(from, to, today.value) }
    }
  },
})
const normalized = computed(() => ({
  from: parseDateInput(draft.from),
  to: parseDateInput(draft.to),
}))
const error = computed(() => {
  if (!draft.from || !draft.to) return label('Select a start and end date.', '请选择开始和结束日期')
  const { from, to } = normalized.value
  if (!from || !to)
    return label('Enter a valid date: YYYY/MM/DD.', '请输入有效日期，格式为 YYYY/MM/DD')
  if (from > to) return label('Start date must not be after end date.', '开始日期不能晚于结束日期')
  if (to > localDate(today.value))
    return label('Dates cannot be in the future.', '不能选择未来日期')
  return ''
})
const selectedShortcut = computed(
  () =>
    shortcuts.value.find(({ value }) => {
      const range = quickDateRange(value, today.value)
      return range.from === normalized.value.from && range.to === normalized.value.to
    })?.value,
)
function syncDraft(value: Date | Date[] | null): void {
  const selection = Array.isArray(value) ? value : []
  draft.from = selection[0] ? localDate(selection[0]).replaceAll('-', '/') : ''
  draft.to = selection[1] ? localDate(selection[1]).replaceAll('-', '/') : ''
}
function showEndMonth(end: string): void {
  const date = new Date(`${end}T00:00:00`)
  date.setDate(1)
  date.setMonth(date.getMonth() - 1)
  picker.value?.setMonthYear({ month: date.getMonth(), year: date.getFullYear() })
}
function opened(): void {
  today.value = new Date()
  open.value = true
  draft.from = model.value.from.replaceAll('-', '/')
  draft.to = model.value.to.replaceAll('-', '/')
}
function updateCalendar(): void {
  const { from, to } = normalized.value
  if (!error.value && from && to) {
    picker.value?.updateInternalModelValue([
      new Date(`${from}T00:00:00`),
      new Date(`${to}T00:00:00`),
    ])
    showEndMonth(to)
  }
}
function chooseShortcut(value: QuickDateRange): void {
  Object.assign(draft, quickDateRange(value, today.value))
  updateCalendar()
}
function apply(): void {
  const { from, to } = normalized.value
  if (error.value || !from || !to) return
  model.value = { from, to, preset: matchPreset(from, to, today.value) }
  picker.value?.closeMenu()
}
function choosePreset(value: string | number): void {
  picker.value?.closeMenu()
  model.value = presetRange(value as DatePreset)
}
onDeactivated(() => picker.value?.closeMenu())
</script>

<template>
  <div class="date-range-control">
    <SegmentedControl
      appearance="light"
      :model-value="model.preset"
      :options="options"
      :label="label('Date range', '日期范围')"
      @update:model-value="choosePreset"
    />
    <VueDatePicker
      ref="picker"
      v-model="dates"
      :locale="currentLang === 'zh' ? zhCN : enUS"
      :range="{ partialRange: false }"
      :multi-calendars="2"
      :time-config="{ enableTimePicker: false }"
      :clearable="false"
      teleport
      :dark="currentTheme === 'dark'"
      :max-date="today"
      :week-start="1"
      :day-names="currentLang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : undefined"
      :year-first="currentLang === 'zh'"
      :formats="{
        input: 'yyyy/MM/dd',
        month: currentLang === 'zh' ? 'M 月' : 'MMM',
        year: currentLang === 'zh' ? 'yyyy 年' : 'yyyy',
      }"
      :ui="{ menu: 'workspace-calendar workspace-range-calendar' }"
      :floating="{ placement: 'bottom-end', offset: 10 }"
      :config="{ monthChangeOnScroll: false, tabOutClosesMenu: true, setDateOnMenuClose: false }"
      :transitions="{
        menuAppearTop: 'date-menu',
        menuAppearBottom: 'date-menu',
        next: 'date-calendar',
        previous: 'date-calendar',
      }"
      :aria-labels="{
        menu: label('Choose date range', '选择日期范围'),
        nextMonth: label('Next month', '下个月'),
        prevMonth: label('Previous month', '上个月'),
        openMonthsOverlay: label('Choose month', '选择月份'),
        openYearsOverlay: label('Choose year', '选择年份'),
        day: (day) => localDate(day.value).replaceAll('-', '/'),
      }"
      six-weeks
      class="workspace-date-picker"
      @open="opened"
      @menu-mounted="showEndMonth(model.to || localDate(today))"
      @closed="open = false"
      @internal-model-change="syncDraft"
    >
      <template #trigger>
        <button
          type="button"
          class="workspace-button date-trigger"
          :aria-label="label('Choose dates', '选择日期')"
          :aria-expanded="open"
          aria-haspopup="dialog"
        >
          <span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>
          <span class="numeric">
            {{
              model.from
                ? `${model.from.replaceAll('-', '/')} — ${model.to.replaceAll('-', '/')}`
                : label('All dates', '全部日期')
            }}
          </span>
          <DropdownChevron :open="open" />
        </button>
      </template>
      <template #left-sidebar>
        <nav class="date-shortcuts selection-list" :aria-label="label('Quick ranges', '快捷范围')">
          <span>{{ label('Quick ranges', '快捷范围') }}</span>
          <button
            v-for="shortcut in shortcuts"
            :key="shortcut.value"
            type="button"
            :aria-pressed="selectedShortcut === shortcut.value"
            @click="chooseShortcut(shortcut.value)"
          >
            {{ shortcut.label }}
          </button>
        </nav>
      </template>
      <template #action-row="{ closePicker }">
        <form class="date-range-footer" @submit.prevent="apply">
          <div class="date-range-fields">
            <label>
              {{ label('Start date', '开始日期') }}
              <input
                v-model="draft.from"
                type="text"
                placeholder="YYYY/MM/DD"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="Boolean(draft.from && !normalized.from)"
                :aria-describedby="error ? errorId : undefined"
                @change="updateCalendar"
              />
            </label>
            <label>
              {{ label('End date', '结束日期') }}
              <input
                v-model="draft.to"
                type="text"
                placeholder="YYYY/MM/DD"
                autocomplete="off"
                spellcheck="false"
                :aria-invalid="Boolean(draft.to && !normalized.to)"
                :aria-describedby="error ? errorId : undefined"
                @change="updateCalendar"
              />
            </label>
            <button type="button" class="workspace-button" @click="closePicker">
              {{ label('Cancel', '取消') }}
            </button>
            <button
              type="submit"
              class="workspace-button workspace-button--primary"
              :disabled="Boolean(error)"
            >
              {{ label('Apply', '应用') }}
            </button>
          </div>
          <p v-if="error" :id="errorId" class="date-range-error" role="status">{{ error }}</p>
        </form>
      </template>
    </VueDatePicker>
  </div>
</template>

<style>
.date-range-control {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.workspace-date-picker {
  width: max-content;
  min-width: 229px;
  flex: 0 0 auto;
}
.date-trigger {
  width: 100%;
  padding-inline: 10px;
  gap: 6px;
  font-size: 12px;
}
.date-trigger .material-symbols-outlined {
  font-size: 16px;
}
.workspace-calendar {
  --dp-background-color: var(--surface-low);
  --dp-text-color: var(--text);
  --dp-hover-color: var(--bg-hover);
  --dp-hover-text-color: var(--text);
  --dp-primary-color: var(--primary);
  --dp-primary-text-color: var(--primary-on);
  --dp-menu-border-color: var(--border);
  --dp-icon-color: var(--text-muted);
  --dp-border-color-hover: var(--accent);
  --dp-cell-in-range-bg: var(--primary-soft);
  --dp-border-color: var(--border);
  --dp-border-radius: 12px;
  --dp-font-family: var(--font-ui);
  --dp-disabled-color: var(--bg-hover);
  --dp-disabled-color-text: var(--text-soft);
  --dp-secondary-color: var(--text-soft);
  --dp-border-color-focus: var(--accent);
  --dp-common-transition: background var(--motion-hover) var(--motion-ease);
  box-shadow: var(--shadow-popover);
}
.workspace-range-calendar {
  --date-sidebar-width: 129px;
  --dp-cell-size: 36px;
  --dp-cell-padding: 0;
  --dp-menu-min-width: 268px;
  --dp-font-size: 14px;
  --dp-border-radius: 12px;
  --dp-cell-border-radius: 10px;
  --dp-disabled-color: transparent;
  --dp-range-between-dates-background-color: var(--primary-soft);
  --dp-range-between-dates-text-color: var(--text);
  --dp-range-between-border-color: transparent;
  width: 704px;
  max-width: calc(100vw - 24px);
  overflow: hidden;
  background: linear-gradient(
    90deg,
    var(--surface-container) 0 var(--date-sidebar-width),
    var(--surface-low) var(--date-sidebar-width) 100%
  );
}
.workspace-range-calendar .dp--sidebar-left {
  width: var(--date-sidebar-width);
  flex: none;
  align-self: stretch;
  padding: 12px;
  background: var(--surface-container);
  border-right: 1px solid var(--border);
}
.date-shortcuts {
  width: 104px;
}
.date-shortcuts > span {
  padding: 4px 0 12px;
  font-size: 12px;
  color: var(--text-soft);
}
.date-shortcuts button {
  min-height: 36px;
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  transition: background var(--motion-hover) var(--motion-ease);
}
.date-shortcuts button:hover {
  background: var(--bg-hover);
}
.date-shortcuts button[aria-pressed='true'] {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.workspace-range-calendar .dp--menu-inner {
  padding: 20px 20px 12px;
}
.workspace-range-calendar .dp--calendar-header-separator {
  display: none;
}
.workspace-range-calendar .dp--calendar-next {
  margin-inline-start: 24px;
}
.workspace-range-calendar .dp--active {
  border-radius: var(--dp-cell-border-radius);
}
.workspace-range-calendar .dp--calendar-header-item {
  color: var(--text-soft);
  font-weight: 400;
  font-size: 12px;
}
.workspace-range-calendar .dp--month-year-select {
  width: auto;
  padding-inline: 4px;
  font-weight: 500;
  font-size: 13px;
}
.workspace-range-calendar .dp--action-row {
  width: calc(100% - var(--date-sidebar-width));
  margin-left: var(--date-sidebar-width);
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border);
}
.workspace-range-calendar .dp--month-year-wrap {
  justify-content: center;
}
.date-range-footer {
  width: 100%;
}
.date-range-fields {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}
.date-range-fields label {
  flex: 1;
  min-width: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
}
.date-range-fields input {
  width: 100%;
  height: 36px;
  margin-top: 6px;
  padding: 0 10px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-low);
  color: var(--text);
  font-family: var(--font-number);
  font-size: 12px;
}
.date-range-fields input:focus {
  outline: 2px solid var(--primary-border);
  outline-offset: 1px;
  border-color: var(--accent);
}
.date-range-fields input[aria-invalid='true'] {
  border-color: var(--error);
}
.date-range-fields .workspace-button {
  flex: none;
  min-width: 68px;
  height: 36px;
  justify-content: center;
}
.date-range-error {
  margin: 8px 0 0;
  color: var(--error);
  font-size: 12px;
}
.date-menu-enter-active,
.date-menu-leave-active {
  transition:
    opacity var(--motion-popover) var(--motion-ease),
    transform var(--motion-popover) var(--motion-ease);
}
.date-menu-enter-from,
.date-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.date-calendar-enter-active,
.date-calendar-leave-active {
  transition: opacity var(--motion-page) var(--motion-ease);
}
.date-calendar-enter-from,
.date-calendar-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .date-menu-enter-active,
  .date-menu-leave-active,
  .date-calendar-enter-active,
  .date-calendar-leave-active {
    transition: none;
  }
}
</style>
