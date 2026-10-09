<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UsageAnalytics } from '@shared/analytics'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
import { calendarDays, tokenBars } from '../../utils/analytics-display'
import { shiftDate } from '../../utils/analytics-trend'
const props = defineProps<{ data: UsageAnalytics | null; from: string; to: string }>()
const selected = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [date: string] }>()
const { label, currentLang } = useI18n(),
  hovered = ref('')
const values = computed(
  () => new Map(props.data?.days.map((day) => [day.key, day.total.tokens]) || []),
)
const maximum = computed(() => Math.max(1, ...values.value.values()))
const cells = computed(() =>
  Array.from({ length: 189 }, (_, index) => {
    const date = shiftDate(props.from, index),
      value = values.value.get(date) || 0
    return {
      date,
      value,
      disabled: date > props.to,
      level: !value ? 0 : Math.max(1, Math.ceil((value / maximum.value) * 5)),
    }
  }),
)
const readout = computed(() => hovered.value || selected.value || props.to)
const readoutValue = computed(() => values.value.get(readout.value) || 0)
const active = computed(() => [...values.value.values()].filter((value) => value > 0).length)
const average = computed(
  () =>
    tokenBars(props.data).reduce((sum, point) => sum + point.value, 0) /
    Math.max(1, calendarDays(props.from, props.to).length),
)
const months = computed(() =>
  Array.from({ length: 27 }, (_, index) => {
    const date = shiftDate(props.from, index * 7),
      prior = index ? shiftDate(props.from, (index - 1) * 7) : ''
    return {
      key: date,
      name:
        !prior || date.slice(0, 7) !== prior.slice(0, 7)
          ? new Date(`${date}T00:00:00`).toLocaleDateString(
              currentLang.value === 'zh' ? 'zh-CN' : 'en-US',
              { month: 'short' },
            )
          : '',
    }
  }),
)
function choose(date: string): void {
  selected.value = date
  emit('select', date)
}
</script>
<template>
  <section class="workspace-panel token-heatmap">
    <header>
      <h2>{{ label('Token heatmap', 'Token 热力图') }}</h2>
      <span>{{ from }} — {{ to }}</span>
      <span class="heatmap-activity">
        {{ label('Active', '活跃') }} {{ active }} / {{ calendarDays(from, to).length }}
        {{ label('days', '天') }} · {{ label('Daily average', '日均') }}
        {{ formatNumber(average, { compact: true }) }}
      </span>
      <button
        type="button"
        class="heatmap-readout workspace-link"
        :title="`${readout}: ${formatNumber(readoutValue)} Token`"
        @click="choose(readout)"
      >
        <span>{{ readout.slice(5).replace('-', '/') }}</span>
        <b>{{ formatNumber(readoutValue, { compact: true }) }}</b>
        {{ label('Details', '明细') }}
      </button>
      <div class="heatmap-scale">
        {{ label('Less', '少') }}
        <i
          v-for="level in 6"
          :key="level"
          :style="{ background: `var(--analytics-heatmap-${level - 1})` }"
        />
        {{ label('More', '多') }}
      </div>
    </header>
    <div class="heatmap-scroll">
      <div class="heatmap-months">
        <span v-for="month in months" :key="month.key">{{ month.name }}</span>
      </div>
      <div class="heatmap-body">
        <div class="heatmap-weekdays">
          <span
            v-for="(day, index) in currentLang === 'zh'
              ? ['一', '二', '三', '四', '五', '六', '日']
              : ['M', 'T', 'W', 'T', 'F', 'S', 'S']"
            :key="index"
          >
            {{ day }}
          </span>
        </div>
        <div class="heatmap-grid" @mouseleave="hovered = ''">
          <button
            v-for="cell in cells"
            :key="cell.date"
            type="button"
            :disabled="cell.disabled"
            :aria-label="`${cell.date}: ${formatNumber(cell.value)} Token`"
            :aria-pressed="cell.date === selected"
            :title="`${cell.date} · ${formatNumber(cell.value)} Token`"
            :style="{
              background: cell.disabled ? 'transparent' : `var(--analytics-heatmap-${cell.level})`,
            }"
            @mouseenter="hovered = cell.date"
            @focus="hovered = cell.date"
            @blur="hovered = ''"
            @click="choose(cell.date)"
          />
        </div>
      </div>
    </div>
  </section>
</template>
<style scoped>
.token-heatmap {
  height: 316px;
  border-color: var(--border);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
header {
  display: flex;
  flex-shrink: 0;
  min-height: 24px;
  overflow-x: auto;
  white-space: nowrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-soft);
}
header h2 {
  font-size: 16px;
  color: var(--text);
}
.heatmap-scale {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}
.heatmap-scale i {
  height: 12px;
  width: 12px;
  border-radius: 4px;
}
.heatmap-scroll {
  overflow-x: auto;
  min-height: 0;
  flex: 1;
}
.heatmap-months {
  display: grid;
  grid-template-columns: repeat(27, minmax(17px, 1fr));
  gap: 6px;
  margin-left: 38px;
  min-width: 614px;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 18px;
  margin-bottom: 8px;
  white-space: nowrap;
}
.heatmap-body {
  display: flex;
  gap: 12px;
  min-width: 652px;
}
.heatmap-weekdays {
  display: grid;
  grid-template-rows: repeat(7, 22px);
  row-gap: 8px;
  color: var(--text-soft);
  font-size: 11px;
  width: 18px;
  text-align: center;
  align-items: center;
  padding-top: 8px;
}
.heatmap-grid {
  display: grid;
  flex: 1;
  grid-template-rows: repeat(7, 22px);
  grid-template-columns: repeat(27, minmax(17px, 1fr));
  grid-auto-flow: column;
  gap: 8px 6px;
  padding: 8px;
  background: var(--analytics-heatmap-row-surface);
  border-radius: 12px;
}
.heatmap-grid button {
  height: 22px;
  min-height: 22px;
  max-height: 22px;
  border-radius: 7px;
  border: 0;
  cursor: pointer;
  padding: 0;
  transition: background-color var(--motion-number) var(--motion-ease);
  animation: none;
}
.heatmap-grid button[aria-pressed='true'] {
  outline: 1px solid var(--text-muted);
  outline-offset: 2px;
}
.heatmap-grid button:disabled {
  cursor: default;
}
.heatmap-readout {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  min-height: 24px;
  line-height: 18px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--text-soft);
}
.heatmap-activity {
  font-size: 11px;
}
.heatmap-readout b {
  color: var(--text);
  font-family: var(--font-number);
}
</style>
