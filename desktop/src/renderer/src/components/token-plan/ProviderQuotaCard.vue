<script setup lang="ts">
import { computed } from 'vue'
import type {
  TokenPlanCredentialStatus,
  TokenPlanErrorCode,
  TokenPlanUsageSnapshot,
  TokenPlanWindowId,
} from '../../../../shared/token-plan'
import type { TokenPlanProviderMeta } from '../../config/token-plan-providers'
import { useI18n } from '../../i18n/useI18n'
import QuotaWindowTile from './QuotaWindowTile.vue'

const props = defineProps<{
  provider: TokenPlanProviderMeta
  credential: TokenPlanCredentialStatus
  snapshot: TokenPlanUsageSnapshot | null
  loading: boolean
  actionError: 'save' | 'remove' | 'query' | 'restart' | null
}>()

const emit = defineEmits<{
  refresh: []
  manage: []
  docs: []
}>()

const { currentLang, label } = useI18n()

const providerName = computed(() =>
  currentLang.value === 'zh' ? props.provider.nameZh : props.provider.nameEn,
)

const status = computed(() => {
  if (props.loading) return { className: 'loading', text: label('Querying', '查询中') }
  if (!props.credential.configured) {
    return { className: 'idle', text: label('Not configured', '未配置') }
  }
  if (
    props.snapshot?.status === 'error' ||
    props.snapshot?.errorCode ||
    props.actionError === 'query'
  ) {
    return { className: 'error', text: label('Query failed', '查询失败') }
  }
  if (props.snapshot?.keyVerified) {
    return { className: 'success', text: label('Credentials verified', '凭据已验证') }
  }
  return { className: 'idle', text: label('Ready', '待查询') }
})

function windowUsage(windowId: TokenPlanWindowId) {
  return props.snapshot?.windows.find((item) => item.id === windowId) ?? null
}

function errorText(code: TokenPlanErrorCode | null): string {
  switch (code) {
    case 'not_configured':
      return label('Add an API key before querying.', '请先添加 API Key。')
    case 'invalid_credential':
      return label(
        'The API key was rejected by the provider.',
        '厂商拒绝了该 API Key，请检查是否有效。',
      )
    case 'rate_limited':
      return label(
        'The provider is rate limiting requests. Try again later.',
        '厂商请求过于频繁，请稍后重试。',
      )
    case 'provider_unavailable':
      return label('The provider service is temporarily unavailable.', '厂商服务暂时不可用。')
    case 'invalid_response':
      return label('The provider returned an unrecognized response.', '厂商返回了无法识别的数据。')
    default:
      return label(
        'Could not reach the provider. Check the network and retry.',
        '无法连接厂商，请检查网络后重试。',
      )
  }
}

const visibleError = computed(() => {
  if (props.actionError === 'query') return errorText('network_error')
  if (props.snapshot?.errorCode) return errorText(props.snapshot.errorCode)
  return ''
})

const queryTime = computed(() => {
  if (!props.snapshot?.queriedAt) return ''
  const locale = currentLang.value === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(props.snapshot.queriedAt))
})

function extraPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, (used / limit) * 100))
}
</script>

<template>
  <article class="provider-card" :style="{ '--provider-color': provider.brandColor }">
    <header class="provider-card__header">
      <div class="provider-card__identity">
        <div class="provider-card__mark" :style="{ background: provider.gradient }">
          {{ provider.mark }}
        </div>
        <div class="provider-card__name">
          <div class="provider-card__title-row">
            <h2>{{ providerName }}</h2>
            <span class="provider-card__type">
              {{ provider.category === 'coding' ? 'Coding Plan' : 'Token Plan' }}
            </span>
          </div>
          <div class="provider-card__status" :class="`provider-card__status--${status.className}`">
            <span></span>
            {{ status.text }}
            <template v-if="snapshot?.planName">· {{ snapshot.planName }}</template>
          </div>
        </div>
      </div>

      <div class="provider-card__actions">
        <button
          class="provider-card__icon-btn"
          type="button"
          :title="label('Official docs', '官方文档')"
          @click="emit('docs')"
        >
          <span class="material-symbols-outlined">description</span>
        </button>
        <button
          class="provider-card__refresh"
          type="button"
          :disabled="!credential.configured || loading"
          @click="emit('refresh')"
        >
          <span class="material-symbols-outlined" :class="{ 'is-spinning': loading }">refresh</span>
          {{ label('Refresh', '刷新') }}
        </button>
      </div>
    </header>

    <div v-if="!credential.configured" class="provider-card__setup">
      <span class="material-symbols-outlined">key</span>
      <div>
        <strong>{{ label('API key required', '需要配置 API Key') }}</strong>
        <p>
          {{
            label(
              'Add the plan key to validate access and load real quota data.',
              '添加套餐密钥后验证权限并读取真实额度。',
            )
          }}
        </p>
      </div>
      <button type="button" @click="emit('manage')">{{ label('Add key', '添加密钥') }}</button>
    </div>

    <div v-if="visibleError" class="provider-card__error">
      <span class="material-symbols-outlined">error</span>
      <span>{{ visibleError }}</span>
    </div>

    <div
      class="provider-card__quotas"
      :class="{ 'provider-card__quotas--two': provider.windowIds.length === 2 }"
    >
      <QuotaWindowTile
        v-for="windowId in provider.windowIds"
        :key="windowId"
        :window-id="windowId"
        :usage="windowUsage(windowId)"
        :configured="credential.configured"
        :accent="provider.brandColor"
      />
    </div>

    <section v-if="snapshot?.extraQuotas.length" class="provider-card__extras">
      <div v-for="quota in snapshot.extraQuotas" :key="quota.id" class="provider-card__extra">
        <div class="provider-card__extra-copy">
          <span>{{ quota.label }}</span>
          <strong>{{ quota.used.toLocaleString() }} / {{ quota.limit.toLocaleString() }}</strong>
        </div>
        <div class="provider-card__extra-track">
          <span :style="{ width: `${extraPercent(quota.used, quota.limit)}%` }"></span>
        </div>
        <small v-if="quota.details.length">
          {{ quota.details.map((item) => `${item.name} ${item.used}`).join(' · ') }}
        </small>
      </div>
    </section>

    <footer class="provider-card__footer">
      <div>
        <span class="material-symbols-outlined">shield_lock</span>
        <span v-if="credential.configured">
          {{ label('Credentials encrypted locally', '凭据已加密保存') }}
        </span>
        <span v-else>{{ label('No key stored', '未保存密钥') }}</span>
      </div>
      <div v-if="snapshot?.keyVerified && snapshot.modelCount !== null">
        <span class="material-symbols-outlined">deployed_code</span>
        {{
          label(`${snapshot.modelCount} accessible models`, `可访问 ${snapshot.modelCount} 个模型`)
        }}
      </div>
      <div v-if="queryTime">
        <span class="material-symbols-outlined">schedule</span>
        {{ label(`Updated ${queryTime}`, `更新于 ${queryTime}`) }}
      </div>
    </footer>
  </article>
</template>

<style scoped src="../../styles/token-plan-provider-card.css"></style>
