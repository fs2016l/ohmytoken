<script setup lang="ts">
import { computed } from 'vue'
import { renewalCountdown, renewalStatus, type PlanRenewal } from '../../../../shared/plan-renewals'
import { useI18n } from '../../i18n/useI18n'
import { useRenewalLabels } from '../../composables/useRenewalLabels'

const props = defineProps<{ item: PlanRenewal; today: string }>()
const { label, currentLang } = useI18n()
const { statusText } = useRenewalLabels()
const countdown = computed(() => renewalCountdown(props.item, props.today))
const days = computed(() => countdown.value?.days ?? null)
const tone = computed(() =>
  countdown.value ? renewalStatus(props.item.renewOn, props.today) : 'unknown',
)
const description = computed(() =>
  countdown.value
    ? statusText(props.item, props.today)
    : label('Renewal date unavailable', '续费日期不可用'),
)
const number = computed(() => {
  const count = Math.abs(days.value ?? 0)
  return count < 10_000
    ? String(count)
    : new Intl.NumberFormat(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(count)
})
const arc = computed(() => {
  if (days.value === null) return 0
  // Today and expired dates use status markers; future arcs show the remaining cycle fraction.
  if (days.value === 0) return 100
  if (days.value < 0) return 12
  return countdown.value!.fraction * 100
})
</script>

<template>
  <div
    class="renewal-countdown"
    :class="`renewal-countdown--${tone}`"
    :data-days="days"
    :title="description"
    role="img"
    :aria-label="description"
  >
    <svg viewBox="0 0 52 52" aria-hidden="true" focusable="false">
      <circle class="renewal-countdown-track" cx="26" cy="26" r="23" />
      <circle
        v-if="arc > 0"
        class="renewal-countdown-arc"
        cx="26"
        cy="26"
        r="23"
        pathLength="100"
        :stroke-dasharray="`${arc} 100`"
        transform="rotate(-90 26 26)"
      />
    </svg>
    <span v-if="days === null" class="renewal-countdown-status" aria-hidden="true">—</span>
    <span v-else-if="days < 0" class="renewal-countdown-status" aria-hidden="true">
      {{ label('Expired', '过期') }}
    </span>
    <span v-else-if="days === 0" class="renewal-countdown-status" aria-hidden="true">
      {{ label('Today', '今天') }}
    </span>
    <span v-else class="renewal-countdown-value" aria-hidden="true">
      <strong :class="{ 'is-long': number.length > 3 }">
        {{ number }}
      </strong>
      <span class="renewal-countdown-caption">{{ label('days', '天') }}</span>
    </span>
  </div>
</template>

<style scoped>
.renewal-countdown,
.renewal-countdown * {
  transition-property: none;
}
.renewal-countdown {
  position: relative;
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  color: var(--primary-soft-text);
  --countdown-stroke: var(--primary);
}
.renewal-countdown--soon {
  color: var(--warning);
  --countdown-stroke: var(--warning);
}
.renewal-countdown--overdue {
  color: var(--error);
  --countdown-stroke: var(--error);
}
.renewal-countdown--unknown {
  color: var(--text-disabled);
  --countdown-stroke: var(--text-disabled);
}
svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  fill: none;
  stroke-width: 3;
}
.renewal-countdown-track {
  stroke: color-mix(in srgb, var(--countdown-stroke) 18%, transparent);
}
.renewal-countdown-arc {
  stroke: var(--countdown-stroke);
  stroke-linecap: round;
}
.renewal-countdown-value {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.renewal-countdown-value strong {
  font-size: 16px;
  font-weight: 600;
  line-height: 18px;
}
.renewal-countdown-value strong.is-long {
  font-size: 13px;
}
.renewal-countdown-caption {
  font-size: 10px;
  line-height: 12px;
}
.renewal-countdown-status {
  font-size: 12px;
  font-weight: 500;
}
</style>
