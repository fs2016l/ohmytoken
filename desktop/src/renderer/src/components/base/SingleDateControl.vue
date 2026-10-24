<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import { enUS, zhCN } from 'date-fns/locale'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'
import { localDate, parseDateInput } from '../../utils/date-range'
import SelectionPopover from './SelectionPopover.vue'
import '../../styles/date-picker.css'

const props = withDefaults(defineProps<{ id: string; label: string; disabled?: boolean }>(), {
  disabled: false,
})
const model = defineModel<string>({ required: true })
const { label: text, currentLang } = useI18n()
const { currentTheme } = useTheme()
const open = ref(false)
const control = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const picker = ref<InstanceType<typeof VueDatePicker> | null>(null)
const panelId = useId()
const normalized = computed(() => {
  const date = parseDateInput(model.value)
  return date && date >= '1000-01-01' ? date : null
})
const dateText = computed({
  get: () => model.value.replaceAll('-', '/'),
  set: (value) => {
    model.value = value.replaceAll('/', '-')
  },
})
const selection = computed({
  get: () => (normalized.value ? new Date(`${normalized.value}T00:00:00`) : null),
  set: (date: Date | null) => {
    if (!date) return
    model.value = localDate(date)
    close()
  },
})
function normalize(): void {
  if (normalized.value) model.value = normalized.value
}
function chooseToday(): void {
  model.value = localDate()
  close()
}
function close(): void {
  open.value = false
  input.value?.focus({ preventScroll: true })
}
async function opened(panel: HTMLElement): Promise<void> {
  const date = selection.value ?? new Date()
  picker.value?.setMonthYear({ month: date.getMonth(), year: date.getFullYear() })
  await nextTick()
  panel.querySelector<HTMLElement>('[role="gridcell"][aria-selected="true"]')?.focus()
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) open.value = false
  },
)
</script>

<template>
  <div
    ref="control"
    class="single-date-control"
    :class="{ invalid: model && !normalized, disabled }"
  >
    <button
      type="button"
      :disabled="disabled"
      :aria-label="text(`Choose ${label}`, `选择${label}`)"
      :aria-controls="panelId"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="open = !open"
    >
      <span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>
    </button>
    <input
      :id="id"
      ref="input"
      v-model="dateText"
      type="text"
      maxlength="10"
      placeholder="YYYY/MM/DD"
      autocomplete="off"
      spellcheck="false"
      :disabled="disabled"
      :aria-label="label"
      :aria-invalid="Boolean(model && !normalized)"
      required
      @blur="normalize"
      @keydown.alt.down.prevent="open = true"
      @keydown.enter.prevent="normalize"
    />
  </div>
  <SelectionPopover
    :id="panelId"
    v-model="open"
    :anchor="control"
    :label="text('Choose date', '选择日期')"
    :width="320"
    :match-anchor-width="false"
    :max-height="410"
    class="single-date-popover"
    @opened="opened"
  >
    <VueDatePicker
      ref="picker"
      v-model="selection"
      inline
      auto-apply
      class="base-date-picker single-date-calendar"
      :time-config="{ enableTimePicker: false }"
      :locale="currentLang === 'zh' ? zhCN : enUS"
      :dark="currentTheme === 'dark'"
      :min-date="new Date(1000, 0, 1)"
      :max-date="new Date(9999, 11, 31)"
      :week-start="1"
      :day-names="currentLang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : undefined"
      :year-first="currentLang === 'zh'"
      :ui="{ menu: 'workspace-calendar workspace-single-calendar' }"
      :formats="{
        month: currentLang === 'zh' ? 'M 月' : 'MMM',
        year: currentLang === 'zh' ? 'yyyy 年' : 'yyyy',
      }"
      :aria-labels="{
        menu: text('Date calendar', '日期日历'),
        nextMonth: text('Next month', '下个月'),
        prevMonth: text('Previous month', '上个月'),
        openMonthsOverlay: text('Choose month', '选择月份'),
        openYearsOverlay: text('Choose year', '选择年份'),
        day: (day) => localDate(day.value).replaceAll('-', '/'),
      }"
      :config="{ monthChangeOnScroll: false }"
      :transitions="false"
      six-weeks
    />
    <div class="single-date-actions">
      <button type="button" class="workspace-button" @click="close">
        {{ text('Cancel', '取消') }}
      </button>
      <button type="button" class="workspace-button workspace-button--soft" @click="chooseToday">
        {{ text('Today', '今天') }}
      </button>
    </div>
  </SelectionPopover>
</template>

<style scoped>
.single-date-control {
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--control-height, 36px);
  border: 1px solid var(--border);
  border-radius: var(--control-radius, 8px);
  background: var(--surface-low);
}
.single-date-control:focus-within {
  border-color: var(--primary-border);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
.single-date-control.invalid {
  border-color: var(--error);
}
.single-date-control.disabled {
  opacity: 0.5;
}
.single-date-control input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  padding: 0 12px 0 2px;
  outline: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--text);
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.single-date-control button {
  display: grid;
  place-items: center;
  width: 36px;
  flex: none;
  height: 100%;
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: var(--text-soft);
  cursor: pointer;
}
.single-date-control button:hover:not(:disabled) {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.single-date-control button:disabled {
  cursor: default;
}
.single-date-control button .material-symbols-outlined {
  font-size: 19px;
}
.single-date-popover {
  padding: 12px;
}
.single-date-calendar {
  width: 100%;
}
.single-date-calendar :deep(.dp--menu) {
  border: 0;
  background: transparent;
}
.single-date-calendar :deep(.dp--menu),
.single-date-calendar :deep(.dp--menu-inner),
.single-date-calendar :deep(.dp--instance-calendar) {
  width: 100%;
}
.single-date-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
  padding-top: 10px;
}
</style>
