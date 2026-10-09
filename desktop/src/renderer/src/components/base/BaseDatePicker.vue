<script setup lang="ts">
import { computed } from 'vue'
import { VueDatePicker } from '@vuepic/vue-datepicker'
import '../../styles/date-picker.css'
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
    // 日历日期按本地时间读取；纯 yyyy-MM-dd 会被 Date 当作 UTC 零点。
    const date = new Date(`${model.value.replace(/\//g, '-')}T00:00:00`)
    return Number.isNaN(date.getTime()) ? null : date
  },
  set(val: Date | null) {
    if (!val) {
      model.value = ''
      return
    }
    const y = val.getFullYear()
    const m = String(val.getMonth() + 1).padStart(2, '0')
    const d = String(val.getDate()).padStart(2, '0')
    model.value = `${y}-${m}-${d}`
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
.base-date-picker,
.base-date-picker.dp-light {
  --dp-background-color: var(--bg-elevated);
  --dp-text-color: var(--text);
  --dp-hover-color: var(--bg-hover);
  --dp-hover-text-color: var(--text);
  --dp-primary-color: var(--primary);
  --dp-primary-text-color: var(--primary-on);
  --dp-border-color: transparent;
  --dp-border-color-hover: var(--primary-border);
  --dp-menu-border-color: var(--border);
  --dp-disabled-color: var(--surface-container);
  --dp-scroll-bar-background: var(--surface-container);
  --dp-scroll-bar-color: var(--border-strong);
  --dp-icon-color: var(--text-muted);
  --dp-divider-color: var(--border);
  --dp-cell-hover: var(--bg-hover);
  --dp-active-cell-color: var(--primary);
  --dp-cell-in-range-bg: var(--primary-soft);
}
.base-date-picker .dp--input-icon-pad {
  padding-left: 0 !important;
}
.base-date-picker .dp__input {
  background: transparent !important;
  border: none !important;
  color: var(--text) !important;
  font-family: var(--font-number) !important;
  font-size: 13px !important;
  font-weight: var(--weight-medium) !important;
  padding: 0 !important;
  height: auto !important;
}
.base-date-picker .dp__input:focus {
  box-shadow: none !important;
}
.base-date-picker .dp--input-icon {
  display: none !important;
}
.base-date-picker .dp__clear_icon {
  color: var(--text-muted) !important;
}
.base-date-picker .dp__menu {
  background: var(--bg-elevated) !important;
  border: 1px solid var(--border) !important;
  border-radius: 8px !important;
  box-shadow: var(--shadow-popover) !important;
  color: var(--text) !important;
}
.base-date-picker .dp__active_date {
  background: var(--primary) !important;
  color: var(--primary-on) !important;
}
</style>
