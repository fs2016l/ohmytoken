<script setup lang="ts">
import { computed } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '@vuepic/vue-datepicker/dist/main.css'
import { enUS, zhCN } from 'date-fns/locale'
import { useI18n } from '../../i18n/useI18n'
import { useTheme } from '../../composables/useTheme'

const model = defineModel<string>()

const { currentLang } = useI18n()
const { currentTheme } = useTheme()

const isDark = computed(() => currentTheme.value === 'dark')

const locale = computed(() => (currentLang.value === 'zh' ? zhCN : enUS))

const placeholder = computed(() => (currentLang.value === 'zh' ? '选择日期' : 'Select date'))

const dateValue = computed({
  get() {
    if (!model.value) return null
    return new Date(model.value)
  },
  set(val: Date | null) {
    if (!val) {
      model.value = ''
      return
    }
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    model.value = `${y}/${m}/${d}`
  },
})
</script>

<template>
  <VueDatePicker
    v-model="dateValue"
    :locale="locale"
    :placeholder="placeholder"
    :enable-time-picker="false"
    :clearable="true"
    :auto-apply="true"
    :formats="{ input: 'yyyy/MM/dd' }"
    :dark="isDark"
    class="base-date-picker"
    :class="{ 'dp-light': !isDark }"
  />
</template>

<style>
.base-date-picker {
  --dp-border-color: transparent;
  --dp-border-color-hover: var(--dp-primary-color, #8b5cf6);
}

/* Dark mode (default) */
.base-date-picker {
  --dp-background-color: transparent;
  --dp-text-color: #e5e7eb;
  --dp-hover-color: #334155;
  --dp-hover-text-color: #ffffff;
  --dp-primary-color: #8b5cf6;
  --dp-primary-text-color: #ffffff;
  --dp-menu-border-color: #475569;
  --dp-disabled-color: #334155;
  --dp-scroll-bar-background: #1e293b;
  --dp-scroll-bar-color: #64748b;
  --dp-icon-color: #94a3b8;
  --dp-divider-color: #475569;
  --dp-cell-hover: #334155;
  --dp-active-cell-color: #8b5cf6;
  --dp-cell-in-range-bg: rgba(139, 92, 246, 0.2);
}

/* Light mode */
.base-date-picker.dp-light {
  --dp-background-color: transparent;
  --dp-text-color: #111827;
  --dp-hover-color: #f3f4f6;
  --dp-hover-text-color: #111827;
  --dp-primary-color: #6d3bd7;
  --dp-primary-text-color: #ffffff;
  --dp-menu-border-color: #d0d5dd;
  --dp-disabled-color: #e5e7eb;
  --dp-scroll-bar-background: #f3f4f6;
  --dp-scroll-bar-color: #9ca3af;
  --dp-icon-color: #6b7280;
  --dp-divider-color: #e5e7eb;
  --dp-cell-hover: #f3f4f6;
  --dp-active-cell-color: #6d3bd7;
  --dp-cell-in-range-bg: rgba(109, 59, 215, 0.1);
}

.base-date-picker .dp--input-icon-pad {
  padding-left: 0 !important;
}

.base-date-picker .dp__input {
  background: transparent !important;
  border: none !important;
  color: var(--dp-text-color) !important;
  font-family: var(--font-number) !important;
  font-size: 13px !important;
  font-weight: var(--weight-medium) !important;
  padding: 0 !important;
  padding-left: 0 !important;
  height: auto !important;
}

.base-date-picker .dp__input:focus {
  box-shadow: none !important;
}

.base-date-picker .dp--input-icon {
  display: none !important;
}

.base-date-picker .dp__clear_icon {
  color: var(--dp-icon-color) !important;
}

/* Dark mode dropdown */
.base-date-picker .dp__menu {
  background: #1e293b !important;
  border: 1px solid #475569 !important;
  border-radius: 8px !important;
}

/* Light mode dropdown */
.base-date-picker.dp-light .dp__menu {
  background: #ffffff !important;
  border: 1px solid #d0d5dd !important;
  border-radius: 8px !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12) !important;
  color: #111827 !important;
}

.base-date-picker.dp-light .dp__calendar_header_item,
.base-date-picker.dp-light .dp__calendar_item,
.base-date-picker.dp-light .dp__today,
.base-date-picker.dp-light .dp__time_picker,
.base-date-picker.dp-light .dp__action_row,
.base-date-picker.dp-light .dp__action_buttons button {
  color: #4b5563 !important;
}

.base-date-picker.dp-light .dp__calendar_item[aria-disabled='false']:hover,
.base-date-picker.dp-light .dp__calendar_item[aria-disabled='false']:focus {
  background: #f3f4f6 !important;
  color: #111827 !important;
}

.base-date-picker.dp-light .dp__active_date {
  background: #6d3bd7 !important;
  color: #ffffff !important;
}
</style>
