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
import { quotaPeriodText, quotaResetText } from '../../utils/quota-window-display'
import LiquidQuota from '../token-plan/LiquidQuota.vue'
import DeepSeekBalances from '../token-plan/DeepSeekBalances.vue'
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
    const usage = compactQuotaWindow(snapshot?.windows ?? [], account.providerId)
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
      unlimited: !!usage?.available && usage.unlimited,
      suffix: percent !== null && !(usage?.available && usage.unlimited) ? '%' : '',
      reading:
        usage?.available && usage.unlimited
          ? '∞'
          : percent === null
            ? '—'
            : `${Math.round(percent)}`,
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
  return row ? quotaPeriodText(row, label) : label('Quota unavailable', '暂无额度数据')
}
function reset(row: TokenPlanWindowUsage | null): string {
  return quotaResetText(row, now.value, label)
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
          'is-unavailable': row.account.providerId !== 'deepseek' && row.percent === null,
        }"
        :title="
          [
            row.name,
            row.tier,
            row.regionMessage ||
              (row.failed
                ? label('Refresh failed. Expand for details.', '刷新失败，展开查看详情。')
                : row.account.providerId === 'deepseek'
                  ? label('Account balances and total spending', '账户余额与累计消费')
                  : `${period(row.usage)} · ${reset(row.usage)}`),
          ]
            .filter(Boolean)
            .join(' · ')
        "
        @click="emit('expand')"
      >
        <DeepSeekBalances
          v-if="row.account.providerId === 'deepseek'"
          :windows="row.snapshot?.windows ?? []"
          variant="compact"
        >
          <template #identity>
            <b>
              <VendorMark :provider="row.account.providerId" :size="12" />
              <span class="floating-summary-name">{{ row.name }}</span>
              <span
                v-if="row.failed"
                class="material-symbols-outlined floating-summary-alert"
                role="img"
                :aria-label="
                  row.regionMessage ||
                  label(
                    'Refresh failed. Previous readings are retained.',
                    '刷新失败，已保留上次读数。',
                  )
                "
              >
                warning
              </span>
            </b>
          </template>
        </DeepSeekBalances>
        <template v-else>
          <LiquidQuota
            class="floating-summary-orb"
            :height="58"
            :percent="row.percent"
            :unlimited="row.unlimited"
            :label="`${row.name} · ${period(row.usage)} · ${label('Remaining', '剩余')}`"
          >
            <strong :data-suffix="row.suffix">{{ row.reading }}</strong>
          </LiquidQuota>
          <b>
            <VendorMark :provider="row.account.providerId" :size="12" />
            <span class="floating-summary-name">{{ row.name }}</span>
            <span v-if="row.tier" class="floating-summary-tier">{{ row.tier }}</span>
            <span
              v-if="row.failed && !row.regionMessage"
              class="material-symbols-outlined floating-summary-alert"
              role="img"
              :aria-label="label('Refresh failed', '刷新失败')"
            >
              warning
            </span>
          </b>
          <small :class="{ 'is-failed': row.failed }" :role="row.failed ? 'status' : undefined">
            <template v-if="row.regionMessage">
              {{ label('Refresh paused', '已停止刷新') }}
            </template>
            <template v-else>
              <span class="floating-summary-period">{{ period(row.usage) }}</span>
              <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
              <span class="floating-summary-reset">{{ reset(row.usage) }}</span>
            </template>
          </small>
        </template>
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
