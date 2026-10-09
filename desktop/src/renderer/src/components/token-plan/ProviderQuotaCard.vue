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
import QuotaWindowTile from './QuotaWindowTile.vue'
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
  <article
    class="quota-card"
    :class="{ 'quota-card--empty': !snapshot?.windows.length }"
    :aria-busy="loading"
  >
    <div class="quota-card__row">
      <header class="quota-card__identity">
        <h2 class="quota-card__name">
          <VendorMark :provider="connection.providerId" :size="22" />
          {{ name }}
        </h2>
        <p v-if="snapshot?.windows.length || (!snapshot && loading)" class="quota-card__plan">
          <RollingText
            :text="
              [snapshot?.plan.product, snapshot?.plan.tier].filter(Boolean).join(' · ') ||
              label('Plan not provided', '厂商未返回套餐')
            "
            wrap
          />
        </p>
        <div v-if="snapshot?.windows.length" class="quota-card__status">
          <QuotaStatusBadge
            :status="status"
            :stale="snapshot.stale || Boolean(error)"
            :hint="canShowHint ? hintText : undefined"
            :retry-at="snapshot.retryAt"
            :observed-at="snapshot.observedAt"
          />
          <QuotaUpdatedAt :observed-at="snapshot.observedAt" />
        </div>
        <div class="quota-card__actions">
          <button
            type="button"
            class="workspace-link"
            :aria-expanded="expanded"
            @click="emit('update:expanded', !expanded)"
          >
            {{ label('Connection details', '连接信息') }}
          </button>
          <button
            v-if="snapshot?.windows.length"
            type="button"
            class="workspace-link"
            @click="emit('details')"
          >
            {{ label('Usage details', '用量详情') }}
          </button>
          <button
            v-if="snapshot?.windows.length"
            type="button"
            class="quota-card__refresh workspace-link"
            :disabled="loading"
            :aria-label="label('Refresh quota', '刷新额度')"
            @click="emit('refresh')"
          >
            <span class="material-symbols-outlined" :class="{ 'is-spinning': loading }">
              refresh
            </span>
          </button>
        </div>
      </header>
      <div v-if="snapshot?.windows.length" class="quota-card__windows">
        <QuotaWindowTile v-for="window in snapshot.windows" :key="window.id" :usage="window" />
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
    </div>
    <p v-if="regionPaused" class="quota-card__error" role="status">{{ error }}</p>
    <div v-show="expanded" class="quota-card__information">
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

<style scoped>
.quota-card {
  min-width: 0;
  padding: 20px 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-low);
}
.quota-card__row {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 124px;
}
.quota-card--empty .quota-card__row {
  min-height: 48px;
}
.quota-card__identity {
  flex: 0 0 236px;
  min-width: 0;
}
.quota-card h2 {
  margin: 0;
  color: var(--text);
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.quota-card__name {
  display: flex;
  align-items: center;
  gap: 8px;
}
.quota-card__plan {
  margin: 6px 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.quota-card__status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-soft);
}
.quota-card__actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  min-height: 20px;
}
.quota-card__actions .workspace-link {
  color: var(--text-soft);
}
.quota-card__actions .workspace-link:hover {
  color: var(--accent);
}
.quota-card__refresh {
  display: inline-flex;
  margin-left: auto;
}
.quota-card__refresh .material-symbols-outlined {
  font-size: 16px;
}
.quota-card__refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.quota-card__windows {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 24px;
}
.quota-card__unavailable {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 24px;
  font-size: 13px;
  color: var(--text-soft);
}
.quota-card__information {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  line-height: 20px;
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.quota-card__information p {
  margin: 0 0 12px;
}
.quota-card__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin: 16px 0;
}
.quota-card__facts dt {
  color: var(--text-soft);
}
.quota-card__facts dd {
  margin: 4px 0 0;
  color: var(--text);
}
.quota-card__facts small {
  color: var(--text-soft);
}
.quota-card__error {
  color: var(--error);
}
.quota-card__breakdown {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 8px 0;
}
.quota-card__breakdown strong {
  min-width: 100px;
  font-weight: 500;
}
.quota-card footer {
  margin-top: 16px;
  color: var(--text-soft);
}
@media (max-width: 1350px) {
  .quota-card__identity {
    flex-basis: 196px;
  }
  .quota-card__windows {
    gap: 16px;
  }
}
@media (max-width: 1050px) {
  .quota-card__row {
    flex-wrap: wrap;
  }
  .quota-card__identity {
    flex: 1 1 100%;
  }
  .quota-card__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
