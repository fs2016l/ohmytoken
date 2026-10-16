<script setup lang="ts">
import { computed } from 'vue'
import type {
  TokenPlanConnection,
  TokenPlanErrorCode,
  TokenPlanUsageSnapshot,
} from '../../../../shared/token-plan'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../../config/token-plan-providers'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
import { groupQuotaWindows, quotaBalanceView } from '../../utils/quota-window-display'
import { deepSeekAmounts, deepSeekMoney, deepSeekReadings } from '../../utils/deepseek-display'
import QuotaWindowTile from './QuotaWindowTile.vue'
import QuotaBalanceTile from './QuotaBalanceTile.vue'
import QuotaUpdatedAt from './QuotaUpdatedAt.vue'
import QuotaStatusBadge from './QuotaStatusBadge.vue'
import RollingText from '../base/RollingText.vue'
import VendorMark from '../base/VendorMark.vue'

const props = defineProps<{
  connection: TokenPlanConnection
  snapshot?: TokenPlanUsageSnapshot
  loading: boolean
  expanded?: boolean
}>()
const emit = defineEmits<{ refresh: []; details: []; 'update:expanded': [value: boolean] }>()
const { currentLang, label } = useI18n()
const provider = computed(() => TOKEN_PLAN_PROVIDER_BY_ID[props.connection.providerId])
const name = computed(() =>
  currentLang.value === 'zh' ? provider.value.nameZh : provider.value.nameEn,
)
const error = computed(() => {
  const code =
    props.snapshot?.errorCode ??
    (props.connection.state === 'unsupported'
      ? 'unsupported'
      : props.connection.state === 'expired'
        ? 'expired'
        : null)
  const messages: Record<TokenPlanErrorCode, string> = {
    not_connected: label(
      'The connection has changed. Refresh quota to detect it again.',
      '连接已变更，请点击刷新额度重新检测。',
    ),
    expired: label(
      'The source Agent access token has expired. Sign in to the source Agent and complete one conversation, then refresh quota.',
      '原 Agent 的访问凭据已过期。请在原 Agent 中登录并完成一次对话后，再刷新额度。',
    ),
    invalid_credential: label(
      'The provider rejected this saved connection. Sign in to the source Agent and complete one conversation, then refresh quota.',
      '厂商确认该连接凭据无效。请在原 Agent 中登录并完成一次对话后，再刷新额度。',
    ),
    permission_denied: label(
      'This account cannot read quota. Check the account and subscription permissions in the source Agent, then refresh.',
      '当前账号没有读取额度的权限，请在原 Agent 中确认账号及订阅权限后再刷新。',
    ),
    scope_missing: label(
      'The account has no available quota project. Sign in to Antigravity and complete account setup, then refresh quota.',
      '当前账号尚未提供可查询额度的项目。请在 Antigravity 中登录并完成账号初始化后再刷新额度。',
    ),
    rate_limited: label(
      'The provider has limited the request rate. Wait before refreshing quota again.',
      '厂商限制了查询频率，请稍后再刷新额度。',
    ),
    provider_unavailable: label(
      'The provider is temporarily unavailable. Try refreshing quota later.',
      '厂商服务暂时不可用，请稍后再刷新额度。',
    ),
    invalid_response: label(
      'The quota response could not be read. Retry later; report the issue if it persists.',
      '返回的额度数据无法可靠解释，请稍后重试；若持续出现，请反馈此问题。',
    ),
    network_error: label(
      'Could not reach the provider. Check your network connection, then refresh quota.',
      '暂时无法连接厂商，请检查网络连接后再刷新额度。',
    ),
    region_restricted: label(
      'The current region is restricted. Refresh has been stopped for safety.',
      '当前区域受限，为安全考虑，已停止刷新。',
    ),
    region_unknown: label(
      'Unable to confirm the current network region. Refresh has been stopped for safety.',
      '无法确认当前网络区域，为安全考虑，已停止刷新。',
    ),
    unsupported: label(
      'This connection does not support quota lookup. Sign in with a supported subscription account in the source Agent, complete one conversation, then refresh quota.',
      '当前连接暂不支持额度查询。请在原 Agent 中登录受支持的订阅账号并完成一次对话后，再刷新额度。',
    ),
  }
  return code ? messages[code] : ''
})
const regionPaused = computed(
  () =>
    props.snapshot?.errorCode === 'region_restricted' ||
    props.snapshot?.errorCode === 'region_unknown',
)
function date(value: number | null | undefined): string {
  return value
    ? new Date(value).toLocaleString(currentLang.value === 'zh' ? 'zh-CN' : 'en-US')
    : label('Not provided', '未提供')
}
const status = computed(() => {
  if (props.loading) return label('Updating', '查询中')
  if (regionPaused.value) return label('Refresh paused', '已停止刷新')
  if (props.snapshot?.errorCode || props.snapshot?.status === 'error')
    return label('Update failed', '更新失败')
  if (!props.snapshot?.observedAt) return label('Connection discovered', '已发现连接')
  return props.snapshot.stale ? label('Previous result', '上次结果') : label('Updated', '已更新')
})
// 正常状态只留更新时间；失败、沿用旧值或停止刷新时图标后写明状态，原因放在悬停说明里。
const statusIcon = computed(() => {
  if (props.loading) return ''
  if (regionPaused.value) return 'pause_circle'
  if (props.snapshot?.errorCode || props.snapshot?.status === 'error') return 'warning'
  return props.snapshot?.stale ? 'history' : ''
})
const layout = computed(() =>
  groupQuotaWindows(props.snapshot?.windows ?? [], props.connection.providerId, label),
)
const isDeepSeek = computed(() => props.connection.providerId === 'deepseek')
// 分组名并入磁贴标题，不再单独占一行，同一排卡片的磁贴保持对齐。
const windowTiles = computed(() =>
  layout.value.groups.flatMap((group) =>
    group.windows.map((usage) => ({ usage, scope: group.scope })),
  ),
)
interface BalanceTile {
  id: string
  caption: string
  value: string
  title: string
  note?: string
  muted?: boolean
  rowStart?: boolean
}
/** 余额与额度窗口同排平铺；DeepSeek 按币种拆成充值、赠送（或可用）与累计消费，每个币种另起一行，底注写币种。 */
const balanceTiles = computed<BalanceTile[]>(() => {
  if (isDeepSeek.value) {
    const names = {
      total: label('Available balance', '可用余额'),
      recharge: label('Recharge balance', '充值余额'),
      granted: label('Granted balance', '赠送余额'),
    }
    const spent = label('Total spending', '累计消费')
    return deepSeekAmounts(props.snapshot?.windows ?? []).flatMap((row, index) => [
      ...deepSeekReadings(row).map((item, position) => ({
        id: `${row.currency}:${item.key}`,
        rowStart: index > 0 && position === 0,
        caption: names[item.key],
        value: deepSeekMoney(item.value, row.currency),
        note: row.currency,
        title: `${names[item.key]} · ${row.currency} ${item.value ?? label('Not provided', '未提供')}`,
      })),
      {
        id: `${row.currency}:spent`,
        caption: spent,
        value: deepSeekMoney(row.spent, row.currency),
        note: row.currency,
        muted: true,
        title:
          row.spent === null
            ? label('The provider did not return cumulative spending.', '厂商未返回累计消费数据。')
            : `${spent} · ${row.currency} ${row.spent}`,
      },
    ])
  }
  return layout.value.balances.map((row) => {
    const view = quotaBalanceView(row, label)
    return {
      id: view.id,
      caption:
        view.caption ??
        (row.label === 'Credits' ? label('Credits balance', '积分余额') : view.title),
      value: view.value,
      title: view.title,
    }
  })
})
const showPlan = computed(() =>
  Boolean(props.snapshot?.windows.length || (!props.snapshot && props.loading)),
)
const planText = computed(
  () =>
    [props.snapshot?.plan.product, props.snapshot?.plan.tier].filter(Boolean).join(' · ') ||
    label('Plan not provided', '厂商未返回套餐'),
)
const canShowHint = computed(
  () => !props.loading && Boolean(props.snapshot?.errorCode || props.snapshot?.status === 'error'),
)
const hintText = computed(
  () =>
    error.value ||
    label('Quota could not be updated. Please try again later.', '额度更新失败，请稍后重试。'),
)
const sourceNames = computed(() =>
  props.connection.sources
    .map((source) =>
      source === 'Saved connection'
        ? label('Previously saved connection', '历史连接')
        : source === 'Environment'
          ? label('Environment configuration', '环境配置')
          : source,
    )
    .join(' · '),
)
</script>

<template>
  <article class="quota-card" :class="{ 'quota-card--deepseek': isDeepSeek }" :aria-busy="loading">
    <header class="quota-card__header" :title="label('Drag to reorder', '拖动调整顺序')">
      <div class="quota-card__identity">
        <h2 class="quota-card__name">
          <VendorMark :provider="connection.providerId" :size="22" />
          {{ name }}
        </h2>
        <p v-if="showPlan || snapshot?.windows.length" class="quota-card__meta">
          <span v-if="showPlan" class="quota-card__plan"><RollingText :text="planText" /></span>
          <span v-if="snapshot?.windows.length" class="quota-card__status">
            <QuotaStatusBadge
              v-if="statusIcon"
              :status="status"
              :stale="snapshot.stale || Boolean(error)"
              :hint="canShowHint ? hintText : undefined"
              :retry-at="snapshot.retryAt"
              :observed-at="snapshot.observedAt"
              :icon="statusIcon"
            />
            <span
              v-if="statusIcon && snapshot.observedAt"
              class="quota-card__separator"
              aria-hidden="true"
            >
              ·
            </span>
            <QuotaUpdatedAt :observed-at="snapshot.observedAt" />
          </span>
        </p>
      </div>
      <div class="quota-card__actions">
        <button
          type="button"
          class="quota-card__icon workspace-link"
          :aria-expanded="expanded"
          :aria-label="label('Connection details', '连接信息')"
          :title="label('Connection details', '连接信息')"
          @click="emit('update:expanded', !expanded)"
        >
          <span class="material-symbols-outlined" aria-hidden="true">info</span>
        </button>
        <button
          v-if="snapshot?.windows.length"
          type="button"
          class="quota-card__icon workspace-link"
          :aria-label="label('Usage details', '用量详情')"
          :title="label('Usage details', '用量详情')"
          @click="emit('details')"
        >
          <span class="material-symbols-outlined" aria-hidden="true">query_stats</span>
        </button>
        <button
          v-if="snapshot?.windows.length"
          type="button"
          class="quota-card__refresh quota-card__icon workspace-link"
          :disabled="loading"
          :aria-label="label('Refresh quota', '刷新额度')"
          :title="label('Refresh quota', '刷新额度')"
          @click="emit('refresh')"
        >
          <span class="material-symbols-outlined" :class="{ 'is-spinning': loading }">refresh</span>
        </button>
      </div>
    </header>
    <div v-if="windowTiles.length || balanceTiles.length" class="quota-card__tiles">
      <QuotaWindowTile
        v-for="tile in windowTiles"
        :key="tile.usage.id"
        :usage="tile.usage"
        :scope="tile.scope"
      />
      <QuotaBalanceTile
        v-for="tile in balanceTiles"
        :key="tile.id"
        :class="{ 'quota-card__row-start': tile.rowStart }"
        :caption="tile.caption"
        :value="tile.value"
        :note="tile.note"
        :muted="tile.muted"
        :title="tile.title"
      />
    </div>
    <div v-else class="quota-card__unavailable">
      <span :title="error">
        {{
          loading
            ? label('Reading quota…', '查询中…')
            : regionPaused
              ? label('Refresh paused', '已停止刷新')
              : error
                ? label('Quota unavailable', '识别失败')
                : label('No verified quota reading yet', '暂无可确认的额度读数')
        }}
      </span>
      <button class="workspace-button" type="button" :disabled="loading" @click="emit('refresh')">
        {{ label('Retry', '重新识别') }}
      </button>
    </div>
    <p v-if="regionPaused" class="quota-card__error" role="status">{{ error }}</p>
    <!-- 展开信息里的文字可以选择复制，不作为拖动起点。 -->
    <div v-show="expanded" class="quota-card__information" @pointerdown.stop>
      <p class="quota-card__source">
        {{ label('Detected from', '自动发现于') }} {{ sourceNames }}
        <span v-if="connection.accountLabel">· {{ connection.accountLabel }}</span>
        · {{ connection.region === 'cn' ? label('China', '国内站') : label('Global', '国际站') }}
        <span v-if="connection.scope === 'project'">
          · {{ label('Project quota', '项目额度') }}
        </span>
        <span v-if="(connection.connectionCount ?? 1) > 1">
          ·
          {{
            label(
              `${connection.connectionCount} connections merged`,
              `已合并 ${connection.connectionCount} 个连接`,
            )
          }}
        </span>
        <span v-if="connection.identity === 'credential'">
          · {{ label('Account identity unavailable', '账户身份未确认') }}
        </span>
      </p>
      <p v-if="error && !regionPaused" class="quota-card__error" role="status">
        {{ error }}
        <span v-if="snapshot?.retryAt">
          {{ label('Retry after ', '可重试时间 ') }}{{ date(snapshot.retryAt) }}
        </span>
      </p>
      <dl class="quota-card__facts">
        <div>
          <dt>{{ label('Plan tier', '套餐等级') }}</dt>
          <dd>
            {{ snapshot?.plan.tier || label('Not returned by provider', '厂商未返回') }}
            <small v-if="snapshot?.plan.tierSource === 'login'">
              · {{ label('From login record', '来自登录记录') }}
            </small>
          </dd>
        </div>
        <div>
          <dt>
            {{
              connection.providerId === 'kimi'
                ? label('Current period ends', '本期到期')
                : label('Plan expiry', '套餐到期')
            }}
          </dt>
          <dd>{{ date(snapshot?.plan.expiresAt) }}</dd>
        </div>
        <div>
          <dt>{{ label('Renewal date', '续期日期') }}</dt>
          <dd>{{ date(snapshot?.plan.renewalAt) }}</dd>
        </div>
        <div>
          <dt>
            {{
              connection.providerId === 'kimi'
                ? label('Code concurrency limit', 'Code 并发限制')
                : label('Concurrency limit', '并发限制')
            }}
          </dt>
          <dd>{{ snapshot?.plan.parallelLimit ?? label('Not provided', '未提供') }}</dd>
        </div>
      </dl>
      <div v-for="window in snapshot?.windows ?? []" :key="window.id" class="quota-card__breakdown">
        <strong>{{ window.label }}</strong>
        <span v-if="window.remaining !== null">
          {{ label('Remaining', '剩余') }} {{ formatNumber(window.remaining) }}
        </span>
        <span v-if="window.used !== null">
          {{ label('Used', '已用') }} {{ formatNumber(window.used) }}
        </span>
        <span v-if="window.limit !== null">
          {{ label('Limit', '限额') }} {{ formatNumber(window.limit) }} {{ window.unit }}
        </span>
        <span v-for="detail in window.details" :key="detail.name">
          {{ detail.name }} {{ formatNumber(detail.used) }}
        </span>
      </div>
      <p v-if="snapshot?.models.length">
        {{ label('Quota models', '额度对应模型') }}：{{ snapshot.models.join(' · ') }}
      </p>
      <footer>
        {{ label('Credentials are sent only to the provider', '凭据仅用于向对应厂商查询') }}
        <span v-if="snapshot?.observedAt">
          · {{ label('Observed', '数据时间') }} {{ date(snapshot.observedAt) }}
        </span>
      </footer>
    </div>
  </article>
</template>

<style scoped src="./provider-quota-card.css"></style>
