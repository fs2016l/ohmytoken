<script setup lang="ts">
import { computed } from 'vue'
import SegmentedControl from './SegmentedControl.vue'
import { useChartColorMode } from '../../composables/useChartColorMode'
import { useI18n } from '../../i18n/useI18n'
import { isChartColorMode } from '../../utils/chart-color-mode'

const { mode, setMode } = useChartColorMode()
const { label } = useI18n()
const options = computed(() => [
  { value: 'tonal', label: label('Tonal', '同色系') },
  { value: 'categorical', label: label('Multi', '多色') },
])
function select(value: string | number): void {
  if (isChartColorMode(value)) setMode(value)
}
</script>
<template>
  <div class="chart-color-control">
    <span class="chart-color-caption">{{ label('Chart color', '图表配色') }}</span>
    <SegmentedControl
      appearance="light"
      :model-value="mode"
      :options="options"
      :label="label('Chart color', '图表配色')"
      @update:model-value="select"
    >
      <template #option="{ option }">
        <span
          class="chart-color-option"
          :title="
            option.value === 'tonal'
              ? label(
                  'Related theme tones and gradients; model details remain available.',
                  '同色系深浅与渐变，悬浮仍可查看模型明细',
                )
              : label(
                  'Colors distinguish models and stay consistent across charts.',
                  '按模型区分颜色，相同模型保持同色',
                )
          "
        >
          <span
            class="chart-color-swatch"
            :class="{ 'is-multi': option.value === 'categorical' }"
            aria-hidden="true"
          >
            <i />
            <i />
            <i />
          </span>
          {{ option.label }}
        </span>
      </template>
    </SegmentedControl>
  </div>
</template>
<style scoped>
.chart-color-control {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.chart-color-caption {
  font-size: 11px;
  color: var(--text-soft);
  white-space: nowrap;
}
.chart-color-option {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.chart-color-swatch {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 12px;
}
.chart-color-swatch i {
  width: 3px;
  height: 5px;
  border-radius: 1px;
  background: var(--primary);
}
.chart-color-swatch i:nth-child(2) {
  height: 8px;
  opacity: 0.7;
}
.chart-color-swatch i:nth-child(3) {
  height: 11px;
  opacity: 0.5;
}
.chart-color-swatch.is-multi i:nth-child(2) {
  background: var(--analytics-series-2);
  opacity: 1;
}
.chart-color-swatch.is-multi i:nth-child(3) {
  background: var(--analytics-series-3);
  opacity: 1;
}
</style>
