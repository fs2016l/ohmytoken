<script setup lang="ts">
import { computed } from 'vue'
import type { TokenPlanWindowUsage } from '../../../../shared/token-plan'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import RollingText from '../base/RollingText.vue'
import LiquidQuota from './LiquidQuota.vue'
import { quotaRemainingPercent } from '../../utils/quota-display'
import {
  quotaPeriodText,
  quotaResetText,
  quotaUnitBadge,
  quotaWindowTitle,
  quotaWindowTooltip,
} from '../../utils/quota-window-display'

/** scope 是所在分组名（如 MCP），并入标题行，不再单独占一行，同一排卡片的磁贴始终对齐。 */
const props = defineProps<{ usage: TokenPlanWindowUsage; scope?: string | null }>()
const { currentLang, label } = useI18n()
const now = useVisibleNow()
const period = computed(() =>
  [props.scope, quotaPeriodText(props.usage, label)].filter(Boolean).join(' · '),
)
// 按次计的额度不显示单位标签，单位与用量留在悬停提示。
const unit = computed(() =>
  props.usage.unit === 'requests' ? '' : quotaUnitBadge(props.usage, label),
)
const remainingPercent = computed(() => quotaRemainingPercent(props.usage))
const remainingCount = computed(() => {
  const row = props.usage
  return (
    row.remaining ??
    (row.limit !== null && row.used !== null ? Math.max(0, row.limit - row.used) : null)
  )
})
const unlimited = computed(() => props.usage.available && props.usage.unlimited)
const countFormat = computed(() =>
  props.usage.unit === 'USD' || props.usage.unit === 'CNY' ? { currency: props.usage.unit } : {},
)
const reset = computed(() => quotaResetText(props.usage, now.value, label))
const tooltip = computed(() => quotaWindowTooltip(props.usage, label, currentLang.value))
const title = computed(() => quotaWindowTitle(props.usage, label))
</script>

<template>
  <div class="quota-window" :title="tooltip">
    <div class="quota-window__heading">
      <RollingText :text="period" />
      <span v-if="unit" class="quota-window__unit">{{ unit }}</span>
    </div>
    <LiquidQuota
      :height="76"
      :percent="remainingPercent"
      :unlimited="unlimited"
      :label="`${title} · ${label('Remaining', '剩余')}`"
    >
      <div class="quota-window__value">
        <span v-if="unlimited" :aria-label="label('Unlimited', '不限量')">∞</span>
        <template v-else-if="usage.available && remainingPercent !== null">
          <AnimatedNumber :value="remainingPercent" />
          <small>%</small>
        </template>
        <AnimatedNumber
          v-else
          :value="usage.available ? remainingCount : null"
          :format="countFormat"
        />
      </div>
    </LiquidQuota>
    <div class="quota-window__reset">
      <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
      <span class="quota-window__reset-text">{{ reset }}</span>
      <span class="visually-hidden">{{ tooltip }}</span>
    </div>
  </div>
</template>

<style scoped>
.quota-window {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.quota-window__heading {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 18px;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
}
.quota-window__heading > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.quota-window__unit {
  flex: none;
  padding: 0 5px;
  border-radius: 7px;
  background: var(--surface-container);
  color: var(--text-muted);
  font-size: 10px;
  line-height: 14px;
}
.quota-window__value {
  display: flex;
  align-items: baseline;
  color: var(--text);
  font-family: var(--font-number);
  font-size: 22px;
  font-weight: 500;
  line-height: 26px;
  letter-spacing: -0.4px;
  white-space: nowrap;
}
.quota-window__value small {
  margin-left: 1px;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
}
.quota-window :deep(.liquid-readout) {
  padding: 8px 10px;
}
.quota-window__reset {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 16px;
  color: var(--text-muted);
  font-family: var(--font-number);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
.quota-window__reset .material-symbols-outlined {
  font-size: 13px;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
