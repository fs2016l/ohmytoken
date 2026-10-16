<script setup lang="ts">
import RollingText from '../base/RollingText.vue'
import LiquidQuota from '../token-plan/LiquidQuota.vue'
import QuotaParticleBar from '../token-plan/QuotaParticleBar.vue'
import { quotaRemainingPercent } from '../../utils/quota-display'
import {
  quotaPeriodText,
  quotaResetText,
  quotaUnitBadge,
  quotaWindowTitle,
  quotaWindowTooltip,
  type QuotaWindowGroup,
} from '../../utils/quota-window-display'
import { formatNumber } from '../../utils/number-format'
import { useI18n } from '../../i18n/useI18n'
import type { FloatingQuotaStyle } from '../../composables/useFloatingQuotaStyle'
import type { TokenPlanWindowUsage } from '@shared/token-plan'

defineProps<{ groups: QuotaWindowGroup[]; variant: FloatingQuotaStyle; now: number }>()
const { label, currentLang } = useI18n()

function windowValue(usage: TokenPlanWindowUsage): string {
  if (!usage.available) return '—'
  if (usage.unlimited) return '∞'
  const percent = quotaRemainingPercent(usage)
  if (percent !== null) return formatNumber(percent, { decimals: 0 })
  const remaining =
    usage.remaining ??
    (usage.limit !== null && usage.used !== null ? Math.max(0, usage.limit - usage.used) : null)
  return formatNumber(
    remaining,
    usage.unit === 'USD' || usage.unit === 'CNY' ? { currency: usage.unit } : {},
  )
}
function percentSuffix(usage: TokenPlanWindowUsage): boolean {
  return usage.available && !usage.unlimited && quotaRemainingPercent(usage) !== null
}
// 只有一个窗口的范围（如 MCP）直接以范围名作为窗口名，周期与单位放在悬停提示中。
function windowName(group: QuotaWindowGroup, usage: TokenPlanWindowUsage): string {
  return group.scope && group.windows.length === 1 ? group.scope : quotaPeriodText(usage, label)
}
function unitBadge(group: QuotaWindowGroup, usage: TokenPlanWindowUsage): string {
  return group.scope && group.windows.length === 1 ? '' : quotaUnitBadge(usage, label)
}
function barLabel(usage: TokenPlanWindowUsage): string {
  return `${quotaWindowTitle(usage, label)} · ${label('Remaining', '剩余')}`
}
</script>

<template>
  <div v-if="variant === 'bars'" class="floating-quota-windows">
    <template v-for="group in groups" :key="group.key">
      <p v-if="group.scope && group.windows.length > 1" class="floating-quota-scope">
        {{ group.scope }}
      </p>
      <div
        v-for="usage in group.windows"
        :key="usage.id"
        class="floating-quota-window"
        :title="quotaWindowTooltip(usage, label, currentLang)"
      >
        <span class="floating-quota-period">
          <RollingText :text="windowName(group, usage)" />
          <span v-if="unitBadge(group, usage)" class="floating-quota-unit">
            {{ unitBadge(group, usage) }}
          </span>
        </span>
        <QuotaParticleBar
          :percent="quotaRemainingPercent(usage)"
          :unlimited="usage.available && usage.unlimited"
          :label="barLabel(usage)"
        />
        <span class="floating-quota-value">
          <span>{{ windowValue(usage) }}</span>
          <small v-if="percentSuffix(usage)">%</small>
        </span>
        <span class="floating-quota-reset">
          <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
          <span class="floating-quota-reset-text">{{ quotaResetText(usage, now, label) }}</span>
        </span>
      </div>
    </template>
  </div>
  <!-- 圆球样式：同一范围的窗口并排，多窗口范围在上方居中显示范围名。 -->
  <div v-else class="floating-quota-orbs">
    <section v-for="group in groups" :key="group.key" class="floating-quota-orb-group">
      <p v-if="group.scope && group.windows.length > 1" class="floating-quota-orb-scope">
        <span>{{ group.scope }}</span>
      </p>
      <div class="floating-quota-orb-cells">
        <div
          v-for="usage in group.windows"
          :key="usage.id"
          class="floating-quota-orb"
          :title="quotaWindowTooltip(usage, label, currentLang)"
        >
          <LiquidQuota
            class="floating-quota-orb-liquid"
            :height="46"
            :percent="quotaRemainingPercent(usage)"
            :unlimited="usage.available && usage.unlimited"
            :label="barLabel(usage)"
          >
            <strong :data-suffix="percentSuffix(usage) ? '%' : ''">{{ windowValue(usage) }}</strong>
          </LiquidQuota>
          <span class="floating-quota-orb-name">
            <RollingText :text="windowName(group, usage)" />
            <span v-if="unitBadge(group, usage)" class="floating-quota-unit">
              {{ unitBadge(group, usage) }}
            </span>
          </span>
          <span class="floating-quota-orb-reset">
            <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
            <span class="floating-quota-orb-reset-text">
              {{ quotaResetText(usage, now, label) }}
            </span>
          </span>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped src="./floating-quota-windows.css"></style>
