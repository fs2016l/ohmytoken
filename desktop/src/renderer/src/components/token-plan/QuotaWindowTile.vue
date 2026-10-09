<script setup lang="ts">
import { computed } from 'vue'
import type { TokenPlanWindowUsage } from '../../../../shared/token-plan'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { formatNumber } from '../../utils/number-format'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import RollingText from '../base/RollingText.vue'
import LiquidQuota from './LiquidQuota.vue'
import { quotaRemainingPercent } from '../../utils/quota-display'

const props = defineProps<{ usage: TokenPlanWindowUsage; compact?: boolean }>()
const { currentLang, label } = useI18n()
const now = useVisibleNow()
const title = computed(() => {
  const row = props.usage
  const names: Record<string, string> = {
    '5h': label('5-hour quota', '5 小时额度'),
    '7d': label('Weekly quota', '每周额度'),
    monthly: label('Monthly quota', '每月额度'),
    quota: label('Usage limit', '用量限制'),
    'MCP · monthly': label('Monthly MCP calls', '每月 MCP 调用'),
    total: label('Total quota', '总额度'),
    'Kimi shared quota': label('Kimi shared quota', 'Kimi 共享额度'),
    Credits: label('Credits', '积分'),
    'Code review': label('Code review', '代码审查'),
    'On-demand': label('On-demand usage', '按量用量'),
    Prepaid: label('Prepaid balance', '预付余额'),
    USAGE_PERIOD_TYPE_WEEKLY: label('Weekly quota', '每周额度'),
    USAGE_PERIOD_TYPE_MONTHLY: label('Monthly quota', '每月额度'),
  }
  const duration = row.windowMinutes
  const suffix =
    duration === 300
      ? '5h'
      : duration === 10080
        ? '7d'
        : duration
          ? `${formatNumber(duration)} min`
          : ''
  const canonical = ['5h', '7d', 'monthly', 'MCP · monthly'].includes(row.label)
  return `${names[row.label] ?? row.label}${!canonical && suffix ? ` · ${suffix}` : ''}`
})
const expired = computed(() => props.usage.resetsAt !== null && props.usage.resetsAt <= now.value)
const remainingCount = computed(() => {
  const row = props.usage
  return (
    row.remaining ??
    (row.limit !== null && row.used !== null ? Math.max(0, row.limit - row.used) : null)
  )
})
const remainingPercent = computed(() => quotaRemainingPercent(props.usage))
const numericValue = computed(() =>
  props.usage.available ? (remainingPercent.value ?? remainingCount.value) : null,
)
const numberFormat = computed(() =>
  remainingPercent.value !== null
    ? { percent: true }
    : props.usage.unit === 'USD' || props.usage.unit === 'CNY'
      ? { currency: props.usage.unit }
      : {},
)
const detailText = computed(() => {
  const row = props.usage
  if (!row.available)
    return row.limit !== null
      ? `${label('Limit', '限额')} ${formatNumber(row.limit)} · ${label('Usage unavailable', '用量未提供')}`
      : label('Not returned by the provider', '厂商未返回可确认的用量')
  if (row.unlimited) return label('Unlimited', '不限量')
  const remaining = remainingCount.value
  if (remaining !== null && row.limit !== null)
    return `${label('Remaining', '剩余')} ${formatNumber(remaining)} / ${formatNumber(row.limit)}${row.unit ? ` ${row.unit}` : ''}`
  if (row.usedPercent !== null)
    return `${label('Used', '已用')} ${formatNumber(row.usedPercent, { percent: true })}`
  return remaining !== null
    ? `${label('Remaining', '剩余额度')}${row.unit ? ` · ${row.unit}` : ''}`
    : label('Remaining amount not provided', '厂商未提供剩余额度')
})
const resetDate = computed(() =>
  props.usage.resetsAt
    ? new Intl.DateTimeFormat(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(props.usage.resetsAt)
    : '',
)
const resetText = computed(() => {
  if (!props.usage.resetsAt) return label('Reset time not provided', '未提供重置时间')
  if (expired.value) return label('Reset time passed. Refresh quota.', '已到重置时间，请刷新')
  const minutes = Math.max(1, Math.ceil((props.usage.resetsAt - now.value) / 60_000))
  const days = Math.floor(minutes / 1440),
    hours = Math.floor((minutes % 1440) / 60),
    rest = minutes % 60
  const duration = days
    ? label(`${days}d ${hours}h`, `${days} 天 ${hours} 小时`)
    : hours
      ? label(`${hours}h ${rest}m`, `${hours} 小时 ${rest} 分`)
      : label(`${rest}m`, `${rest} 分钟`)
  return label(`Resets in ${duration}`, `${duration}后重置`)
})
</script>

<template>
  <LiquidQuota
    class="quota-window"
    :class="{ 'quota-window--compact': compact }"
    :height="compact ? 100 : 124"
    :percent="remainingPercent"
    :unlimited="usage.available && usage.unlimited"
    :label="`${title} · ${label('Remaining', '剩余')}`"
    :title="detailText"
  >
    <div class="quota-window__heading">
      <RollingText :text="title" />
    </div>
    <div class="quota-window__value">
      <span class="visually-hidden">{{ label('Remaining', '剩余') }}</span>
      <span v-if="usage.available && usage.unlimited" :aria-label="label('Unlimited', '不限量')">
        ∞
      </span>
      <AnimatedNumber v-else :value="numericValue" :format="numberFormat" />
    </div>
    <div
      class="quota-window__reset"
      :title="
        resetDate
          ? label('Reset time in this reading: ', '这条读数记录的重置时间：') + resetDate
          : resetText
      "
    >
      {{ resetText }}
    </div>
    <span class="visually-hidden">{{ detailText }}</span>
    <span v-if="usage.details.length" class="visually-hidden">
      {{ label('Used by tool:', '工具已用：') }}
      <span v-for="detail in usage.details" :key="detail.name">
        {{ detail.name }} {{ formatNumber(detail.used) }}
      </span>
    </span>
  </LiquidQuota>
</template>

<style scoped>
.quota-window__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-muted);
}
.quota-window__heading > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.quota-window__value {
  color: var(--text);
  font-family: var(--font-number);
  font-size: 40px;
  font-weight: 600;
  line-height: 48px;
  letter-spacing: -1px;
  white-space: nowrap;
}
.quota-window__reset {
  margin-top: auto;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: 12px;
  line-height: 18px;
}
.quota-window--compact {
  container: compact-quota / inline-size;
}
.quota-window--compact .quota-window__value {
  font-size: clamp(14px, 24cqi, 28px);
  line-height: 36px;
  letter-spacing: -0.6px;
}
.quota-window--compact :deep(.liquid-readout) {
  padding: 8px clamp(4px, 6cqi, 10px);
}
.quota-window--compact .quota-window__heading,
.quota-window--compact .quota-window__reset {
  font-size: 11px;
}
@container compact-quota (max-width: 120px) {
  .quota-window__heading {
    gap: 4px;
  }
  .quota-window--compact .quota-window__heading,
  .quota-window--compact .quota-window__reset {
    font-size: 10px;
    line-height: 14px;
  }
  .quota-window__reset {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    white-space: normal;
    text-wrap: balance;
  }
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
