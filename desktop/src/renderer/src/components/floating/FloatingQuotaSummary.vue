<script setup lang="ts">
import { computed } from 'vue'
import type { TokenPlanConnection, TokenPlanUsageSnapshot } from '@shared/token-plan'
import { useI18n } from '../../i18n/useI18n'
import { useVisibleNow } from '../../composables/useVisibleNow'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../../config/token-plan-providers'
import { groupQuotaWindows, quotaBalanceView } from '../../utils/quota-window-display'
import { deepSeekAmounts, deepSeekMoney, deepSeekReadings } from '../../utils/deepseek-display'
import FloatingQuotaWindows from './FloatingQuotaWindows.vue'
import QuotaUpdatedAt from '../token-plan/QuotaUpdatedAt.vue'
import VendorMark from '../base/VendorMark.vue'
import { motion } from '../../config/motion'

const props = defineProps<{
  followed: TokenPlanConnection[]
  snapshots: Record<string, TokenPlanUsageSnapshot>
  failed: boolean
  busy: boolean
  dragging?: string
  orderFailed?: boolean
}>()
const emit = defineEmits<{ manage: []; dragStart: [event: PointerEvent] }>()
const { label, currentLang } = useI18n()
const now = useVisibleNow()
const accounts = computed(() =>
  props.followed.slice(0, 3).map((account) => {
    const snapshot = props.snapshots[account.id]
    const windows = snapshot?.windows ?? []
    const provider = TOKEN_PLAN_PROVIDER_BY_ID[account.providerId]
    const layout = groupQuotaWindows(windows, account.providerId, label)
    const wallets = deepSeekAmounts(windows)
    const paused =
      snapshot?.errorCode === 'region_restricted' || snapshot?.errorCode === 'region_unknown'
    const failed = props.failed || !!snapshot?.errorCode || snapshot?.status === 'error'
    return {
      account,
      snapshot,
      name: currentLang.value === 'zh' ? provider.nameZh : provider.nameEn,
      tier:
        account.providerId === 'deepseek' && wallets.length === 1
          ? wallets[0].currency
          : snapshot?.plan.tier,
      groups: layout.groups,
      balances: layout.balances.map((usage) => quotaBalanceView(usage, label)),
      wallets,
      failed,
      stale: !!snapshot?.stale,
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
      status: paused
        ? label('Refresh paused', '已停止刷新')
        : failed
          ? label('Refresh failed', '刷新失败')
          : '',
    }
  }),
)
const walletNames = computed(() => ({
  recharge: label('Recharge balance', '充值余额'),
  granted: label('Granted balance', '赠送余额'),
  total: label('Available balance', '可用余额'),
}))
</script>

<template>
  <div v-if="accounts.length" class="floating-summary floating-quota-summary" :aria-busy="busy">
    <div class="floating-summary-heading">
      <strong>
        {{ label('Account quota', '账户额度') }}
        <span class="floating-summary-count">{{ accounts.length }}</span>
      </strong>
      <span class="floating-summary-quota-controls">
        <small>
          {{ label('Remaining / reset', '剩余 / 重置') }}
        </small>
        <button
          type="button"
          class="floating-link"
          :aria-label="label('Manage follows', '管理关注')"
          @click="emit('manage')"
        >
          {{ label('Manage', '管理') }}
          <template v-if="followed.length > 3">+{{ followed.length - 3 }}</template>
        </button>
      </span>
    </div>
    <p v-if="orderFailed" class="floating-error" role="alert">
      {{
        label('Could not save the order. Drag again to retry.', '顺序未能保存，请重新拖动重试。')
      }}
    </p>
    <TransitionGroup
      tag="div"
      name="floating-quota-reorder"
      class="floating-summary-accounts"
      :style="{ '--quota-reorder-duration': `${motion.reorder}ms` }"
    >
      <section
        v-for="row in accounts"
        :key="row.account.id"
        class="floating-summary-account"
        :class="{ 'floating-quota-account--dragging': dragging === row.account.id }"
        :data-connection="row.account.id"
        :aria-label="row.name + ' ' + label('quota', '额度')"
        :title="label('Drag to reorder', '拖动调整顺序')"
        @pointerdown="emit('dragStart', $event)"
      >
        <div class="floating-summary-identity">
          <b>
            <VendorMark :provider="row.account.providerId" :size="16" />
            <span class="floating-summary-name">{{ row.name }}</span>
          </b>
          <small v-if="row.tier" class="floating-summary-tier" :title="row.tier">
            {{ row.tier }}
          </small>
          <small
            v-if="row.status || row.snapshot?.observedAt != null"
            class="floating-summary-account-status"
            :class="{ 'is-failed': row.failed, 'is-stale': row.stale }"
            :title="row.regionMessage || undefined"
          >
            <span v-if="row.status" role="status">{{ row.status }}</span>
            <QuotaUpdatedAt
              v-if="row.snapshot?.observedAt != null"
              :observed-at="row.snapshot.observedAt"
            />
            <span v-if="row.regionMessage" class="floating-summary-region">
              {{ row.regionMessage }}
            </span>
          </small>
        </div>
        <div class="floating-summary-account-data">
          <template v-if="row.account.providerId === 'deepseek'">
            <div
              v-for="wallet in row.wallets"
              :key="wallet.currency"
              class="floating-summary-wallet"
            >
              <small v-if="row.wallets.length > 1" class="floating-summary-currency">
                {{ wallet.currency }}
              </small>
              <div class="floating-summary-wallet-grid">
                <div v-for="item in deepSeekReadings(wallet)" :key="item.key">
                  <small>{{ walletNames[item.key] }}</small>
                  <b>{{ deepSeekMoney(item.value, wallet.currency) }}</b>
                </div>
                <div>
                  <small>{{ label('Total spending', '累计消费') }}</small>
                  <b>{{ deepSeekMoney(wallet.spent, wallet.currency) }}</b>
                </div>
              </div>
            </div>
            <p v-if="!row.wallets.length" class="floating-summary-no-quota">
              —
              {{
                busy
                  ? label('Reading balances…', '正在读取余额…')
                  : label('Balance unavailable', '暂无余额数据')
              }}
            </p>
          </template>
          <template v-else>
            <FloatingQuotaWindows :groups="row.groups" variant="bars" :now="now" summary />
            <div
              v-if="row.balances.length"
              class="floating-summary-balances"
              :class="{ 'floating-summary-balances--standalone': !row.groups.length }"
            >
              <span v-for="balance in row.balances" :key="balance.id" :title="balance.title">
                <small>{{ balance.caption || balance.title }}</small>
                <b>{{ balance.value }}</b>
              </span>
            </div>
            <p v-if="!row.groups.length && !row.balances.length" class="floating-summary-no-quota">
              —
              {{
                busy
                  ? label('Reading quota…', '正在读取额度…')
                  : label('Quota unavailable', '暂无额度数据')
              }}
            </p>
          </template>
        </div>
      </section>
    </TransitionGroup>
  </div>
</template>

<style scoped src="./floating-quota-summary.css"></style>
