<script setup lang="ts">
import { computed } from 'vue'
import type {
  TokenPlanConnection,
  TokenPlanUsageSnapshot,
  TokenPlanWindowUsage,
} from '@shared/token-plan'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../../config/token-plan-providers'
import { compactQuotaWindow } from '../../utils/floating-summary'
import { quotaRemainingPercent } from '../../utils/quota-display'
import { formatNumber } from '../../utils/number-format'
import QuotaUpdatedAt from '../token-plan/QuotaUpdatedAt.vue'
import VendorMark from '../base/VendorMark.vue'

const props = defineProps<{
  followed: TokenPlanConnection[]
  snapshots: Record<string, TokenPlanUsageSnapshot>
  failed: boolean
  refreshedAt: number
  busy: boolean
}>()
const emit = defineEmits<{ expand: []; manage: [] }>()
const { label, currentLang } = useI18n()
const now = useVisibleNow()
const accounts = computed(() =>
  props.followed.slice(0, 3).map((account) => {
    const snapshot = props.snapshots[account.id]
    const usage = compactQuotaWindow(snapshot?.windows ?? [])
    const percent = usage ? quotaRemainingPercent(usage) : null
    const provider = TOKEN_PLAN_PROVIDER_BY_ID[account.providerId]
    return {
      account,
      snapshot,
      usage,
      percent,
      name: currentLang.value === 'zh' ? provider.nameZh : provider.nameEn,
      tier: snapshot?.plan.tier,
      regionMessage:
        snapshot?.errorCode === 'region_restricted'
          ? label(
              'The current region is restricted. Refresh has been stopped for safety.',
              '当前区域受限，为安全考虑，已停止刷新。',
            )
          : snapshot?.errorCode === 'region_unknown'
            ? label(
                'Unable to confirm the current network region. Refresh has been stopped for safety.',
                '无法确认当前网络区域，为安全考虑，已停止刷新。',
              )
            : '',
      failed: props.failed || !!snapshot?.errorCode || snapshot?.status === 'error',
      reading:
        usage?.available && usage.unlimited
          ? '∞'
          : percent === null
            ? '—'
            : `${Math.round(percent)}%`,
    }
  }),
)
const updated = computed(() => {
  const timestamps = [
    props.refreshedAt,
    ...accounts.value.map((row) => row.snapshot?.checkedAt ?? row.snapshot?.observedAt ?? 0),
  ].filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
  return Math.max(0, ...timestamps)
})
function period(row: TokenPlanWindowUsage | null): string {
  if (!row) return label('Quota unavailable', '暂无额度数据')
  if (row.windowMinutes === 300) return label('5h', '5小时')
  if (row.windowMinutes === 10080) return label('7d', '7天')
  if (row.windowMinutes)
    return label(
      `${formatNumber(row.windowMinutes / 60)}h`,
      `${formatNumber(row.windowMinutes / 60)}小时`,
    )
  return row.label
}
function reset(row: TokenPlanWindowUsage | null): string {
  if (!row?.resetsAt) return label('Reset unknown', '重置时间未知')
  const minutes = Math.ceil((row.resetsAt - now.value) / 60000)
  if (minutes <= 0) return label('Awaiting refresh', '待刷新')
  const duration =
    minutes >= 1440
      ? `${Math.ceil(minutes / 1440)}d`
      : minutes >= 60
        ? `${Math.ceil(minutes / 60)}h`
        : `${minutes}m`
  return label(`Resets in ${duration}`, `${duration}后重置`)
}
</script>

<template>
  <div class="floating-summary floating-quota-summary">
    <div class="floating-summary-heading">
      <strong>{{ label('Remaining quota', '剩余额度') }}</strong>
    </div>
    <div
      v-if="accounts.length"
      class="floating-summary-accounts"
      :style="{ '--summary-columns': accounts.length }"
    >
      <button
        v-for="row in accounts"
        :key="row.account.id"
        class="floating-summary-account"
        :class="{
          'is-low': row.percent !== null && row.percent <= 20,
          'is-unavailable': row.percent === null,
        }"
        :title="
          [
            row.name,
            row.tier,
            row.regionMessage ||
              (row.failed
                ? label('Refresh failed. Expand for details.', '刷新失败，展开查看详情。')
                : `${period(row.usage)} · ${reset(row.usage)}`),
          ]
            .filter(Boolean)
            .join(' · ')
        "
        @click="emit('expand')"
      >
        <span class="floating-summary-ring">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="27" class="ring-track" />
            <circle
              v-if="row.percent !== null"
              cx="32"
              cy="32"
              r="27"
              class="ring-value"
              pathLength="100"
              :stroke-dasharray="`${row.percent} 100`"
            />
          </svg>
          <strong>{{ row.reading }}</strong>
        </span>
        <b>
          <VendorMark :provider="row.account.providerId" :size="12" />
          {{ row.name }}
          <template v-if="row.tier">· {{ row.tier }}</template>
        </b>
        <small :class="{ 'is-failed': row.failed }" :role="row.failed ? 'status' : undefined">
          <template v-if="row.regionMessage">{{ label('Refresh paused', '已停止刷新') }}</template>
          <template v-else-if="row.failed">{{ label('Refresh failed', '刷新失败') }}</template>
          <template v-else>{{ period(row.usage) }} · {{ reset(row.usage) }}</template>
        </small>
      </button>
    </div>
    <p v-else class="floating-summary-empty">
      {{
        busy
          ? label('Reading quota…', '正在读取额度…')
          : label('Choose accounts to follow.', '请选择要关注的账号。')
      }}
    </p>
    <div class="floating-summary-footer">
      <span>
        <QuotaUpdatedAt v-if="updated" :observed-at="updated" />
        <template v-else>{{ label('Waiting for data', '等待数据') }}</template>
      </span>
      <button class="floating-link" @click="emit('manage')">
        {{ label('Manage follows', '管理关注') }}
        <template v-if="followed.length > 3">+{{ followed.length - 3 }}</template>
        ›
      </button>
    </div>
  </div>
</template>
