<script setup lang="ts">
import { computed } from 'vue'
import type { TokenPlanWindowUsage } from '@shared/token-plan'
import { useI18n } from '../../i18n/useI18n'
import {
  deepSeekAmounts,
  deepSeekMoney,
  deepSeekReadings,
  type DeepSeekAmounts,
} from '../../utils/deepseek-display'

// 主页面改用与额度窗口一致的余额磁贴；本组件只服务浮窗的展开与紧凑视图。
const props = withDefaults(
  defineProps<{
    windows: TokenPlanWindowUsage[]
    variant?: 'floating' | 'compact'
  }>(),
  { variant: 'floating' },
)
const { label } = useI18n()
const amounts = computed(() => deepSeekAmounts(props.windows))
const groups = computed(() =>
  props.variant === 'compact'
    ? [
        amounts.value[0] ?? {
          currency: 'CNY' as const,
          recharge: null,
          granted: null,
          total: null,
          spent: null,
        },
      ]
    : amounts.value,
)
const caption = computed(() =>
  props.variant === 'compact' ? label('Spent', '累计消费') : label('Total spending', '累计消费'),
)
function readings(row: DeepSeekAmounts) {
  const compact = props.variant === 'compact'
  const names = {
    total: label('Available balance', '可用余额'),
    recharge: compact ? label('Recharge', '充值余额') : label('Recharge balance', '充值余额'),
    granted: compact ? label('Granted', '赠送余额') : label('Granted balance', '赠送余额'),
  }
  return deepSeekReadings(row).map((item) => ({ ...item, name: names[item.key] }))
}
const tooltip = computed(() =>
  amounts.value
    .map((row) =>
      [
        row.currency,
        ...readings(row).map((item) => `${item.name} ${deepSeekMoney(item.value, row.currency)}`),
        `${caption.value} ${deepSeekMoney(row.spent, row.currency)}`,
      ].join(' · '),
    )
    .join('\n'),
)
</script>

<template>
  <div class="deepseek-balances" :class="`deepseek-balances--${variant}`" :title="tooltip">
    <div v-for="row in groups" :key="row.currency" class="deepseek-balances__currency">
      <div class="deepseek-balances__primary">
        <div
          v-for="item in readings(row)"
          :key="item.key"
          class="deepseek-balances__wallet"
          :data-wallet="item.key"
          :title="`${item.name} · ${row.currency} ${item.value ?? label('Not provided', '未提供')}`"
        >
          <span>{{ item.name }}</span>
          <strong>{{ deepSeekMoney(item.value, row.currency) }}</strong>
        </div>
      </div>
      <div v-if="$slots.identity" class="deepseek-balances__identity"><slot name="identity" /></div>
      <div
        class="deepseek-balances__spent"
        :title="
          row.spent === null
            ? label('The provider did not return cumulative spending.', '厂商未返回累计消费数据。')
            : `${caption} · ${row.currency} ${row.spent}`
        "
      >
        <span>{{ caption }}</span>
        <strong>{{ deepSeekMoney(row.spent, row.currency) }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped src="./deepseek-balances.css"></style>
