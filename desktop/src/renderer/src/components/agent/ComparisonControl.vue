<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '../../styles/date-picker.css'
import { enUS, zhCN } from 'date-fns/locale'
import AnchoredPopover from '../base/AnchoredPopover.vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import {
  comparisonDates,
  validDate,
  type ComparisonRange,
  type ComparisonMode,
} from '../../utils/analytics-trend'
import { calendarDays } from '../../utils/analytics-display'
import { localDate } from '../../utils/date-range'
const props = defineProps<{ current: { from: string; to: string } }>()
const model = defineModel<ComparisonRange>({ required: true })
const { label, currentLang } = useI18n(),
  { currentTheme } = useTheme()
const anchor = ref<HTMLElement | null>(null),
  open = ref(false)
const picker = ref<InstanceType<typeof VueDatePicker> | null>(null)
const draft = reactive<ComparisonRange>({ mode: 'previous', from: '', to: '' })
const modes = computed(() => [
  { value: 'none', label: label('No comparison', '不对比') },
  { value: 'previous', label: label('Previous period', '上一时段') },
  { value: 'year', label: label('Previous year', '去年同期') },
  { value: 'custom', label: label('Custom', '自定义') },
])
watch(open, (value) => {
  if (value) {
    Object.assign(draft, model.value)
    updateRange()
  }
})
watch(
  () => [props.current.from, props.current.to],
  () => {
    if (open.value) updateRange()
  },
)
watch(
  () => [open.value, draft.to],
  async () => {
    if (!open.value || !validDate(draft.to)) return
    const date = new Date(`${draft.to}T00:00:00`)
    date.setDate(1)
    date.setMonth(date.getMonth() - 1)
    await nextTick()
    if (open.value) picker.value?.setMonthYear({ month: date.getMonth(), year: date.getFullYear() })
  },
)
function updateRange(): void {
  const range = comparisonDates(props.current, draft)
  if (range) Object.assign(draft, range)
}
function choose(mode: string): void {
  draft.mode = mode as ComparisonMode
  updateRange()
}
const dates = computed({
  get: () =>
    validDate(draft.from) && validDate(draft.to)
      ? [new Date(`${draft.from}T00:00:00`), new Date(`${draft.to}T00:00:00`)]
      : null,
  set: (values: Date[] | null) => {
    if (values?.[0] && values[1])
      Object.assign(draft, { mode: 'custom', from: localDate(values[0]), to: localDate(values[1]) })
  },
})
const valid = computed(
  () =>
    draft.mode === 'none' ||
    (validDate(draft.from) &&
      validDate(draft.to) &&
      draft.from <= draft.to &&
      draft.to <= localDate()),
)
function apply(): void {
  if (valid.value) {
    model.value = { ...draft }
    open.value = false
  }
}
</script>
<template>
  <button
    ref="anchor"
    type="button"
    class="workspace-button comparison-trigger"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click="open = !open"
  >
    <span class="material-symbols-outlined" aria-hidden="true">swap_vert</span>
    {{ label('Compare', '对比') }}: {{ modes.find((mode) => mode.value === model.mode)?.label }}
    <DropdownChevron :open="open" />
  </button>
  <AnchoredPopover v-model="open" :anchor="anchor" :label="label('Comparison period', '对比时段')">
    <div class="comparison-calendar">
      <header>
        <b>{{ label('Comparison period', '对比时段') }}</b>
        <span>
          {{ label('Current', '当前') }}: {{ current.from || '—' }} — {{ current.to || '—' }} ·
          {{ calendarDays(current.from, current.to).length }} {{ label('days', '天') }}
        </span>
      </header>
      <div class="comparison-body">
        <nav class="selection-list" :aria-label="label('Comparison mode', '对比方式')">
          <button
            v-for="mode in modes"
            :key="mode.value"
            type="button"
            :class="{ selected: draft.mode === mode.value }"
            :aria-pressed="draft.mode === mode.value"
            @click="choose(mode.value)"
          >
            {{ mode.label }}
            <span v-if="draft.mode === mode.value">✓</span>
          </button>
        </nav>
        <div class="comparison-dates">
          <VueDatePicker
            ref="picker"
            v-model="dates"
            inline
            auto-apply
            :range="{ partialRange: false }"
            :multi-calendars="2"
            :time-config="{ enableTimePicker: false }"
            :locale="currentLang === 'zh' ? zhCN : enUS"
            :dark="currentTheme === 'dark'"
            :max-date="new Date()"
            :week-start="1"
            :ui="{ menu: 'workspace-calendar' }"
            :class="{ 'comparison-disabled': draft.mode === 'none' }"
          />
          <footer>
            <label>
              {{ label('Start date', '开始日期') }}
              <input
                v-model="draft.from"
                type="date"
                :max="localDate()"
                :disabled="draft.mode === 'none'"
                @input="draft.mode = 'custom'"
              />
            </label>
            <label>
              {{ label('End date', '结束日期') }}
              <input
                v-model="draft.to"
                type="date"
                :max="localDate()"
                :disabled="draft.mode === 'none'"
                @input="draft.mode = 'custom'"
              />
            </label>
            <button type="button" class="workspace-button" @click="open = false">
              {{ label('Cancel', '取消') }}
            </button>
            <button
              type="button"
              class="workspace-button workspace-button--primary"
              :disabled="!valid"
              @click="apply"
            >
              {{ label('Apply', '应用') }}
            </button>
          </footer>
        </div>
      </div>
    </div>
  </AnchoredPopover>
</template>
<style scoped>
.comparison-trigger {
  color: var(--accent);
  border-color: var(--primary-border);
  font-size: 12px;
}
.comparison-trigger .material-symbols-outlined {
  font-size: 16px;
}
.comparison-calendar {
  width: 664px;
  font-size: 13px;
}
header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
header span {
  font-size: 12px;
  color: var(--text-soft);
}
.comparison-body {
  display: flex;
  gap: 16px;
}
nav {
  width: 128px;
  flex: none;
  background: var(--surface-container);
  border-radius: 8px;
  padding: 8px;
}
nav button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}
nav button.selected {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.comparison-dates {
  flex: 1;
  min-width: 0;
}
.comparison-dates :deep(.dp--menu) {
  border: 0;
  box-shadow: none;
}
.comparison-dates :deep(.dp--menu-wrapper) {
  width: 100%;
}
.comparison-dates :deep(.dp--instance-calendar) {
  flex: 1;
}
.comparison-dates :deep(.dp--menu-inner) {
  padding: 0;
}
.comparison-dates :deep(.dp--cell-inner) {
  height: 30px;
  font-size: 12px;
}
.comparison-disabled {
  opacity: 0.4;
  pointer-events: none;
}
footer {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  margin-top: 12px;
}
footer label {
  min-width: 0;
  flex: 1;
  font-size: 12px;
  color: var(--text-soft);
}
input {
  width: 100%;
  height: 36px;
  margin-top: 6px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-low);
  color: var(--text);
  font-family: var(--font-number);
  font-size: 12px;
}
</style>
