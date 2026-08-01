<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from 'vue'
import type { TokenPlanProviderId, TokenPlanWindowId } from '../../../shared/token-plan'
import PageIntro from '../components/base/PageIntro.vue'
import ProviderQuotaCard from '../components/token-plan/ProviderQuotaCard.vue'
import { TOKEN_PLAN_PROVIDERS, type TokenPlanCategory } from '../config/token-plan-providers'
import { useTokenPlanUsage } from '../composables/useTokenPlanUsage'
import { useI18n } from '../i18n/useI18n'

type ProviderFilter = 'all' | TokenPlanCategory

const { currentLang, label } = useI18n()
const {
  snapshots,
  refreshing,
  saving,
  removing,
  actionErrors,
  initializing,
  refreshingAll,
  loadFailed,
  configuredCount,
  credentialFor,
  initialize,
  refreshProvider,
  refreshAllProviders,
  saveCredential,
  removeCredential,
} = useTokenPlanUsage()

const showCredentials = ref(false)
const providerFilter = ref<ProviderFilter>('all')
const search = ref('')
const draftKeys = reactive<Record<TokenPlanProviderId, string>>({
  minimax: '',
  zhipu: '',
})

const visibleProviders = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return TOKEN_PLAN_PROVIDERS.filter((provider) => {
    const matchesFilter =
      providerFilter.value === 'all' || provider.category === providerFilter.value
    const matchesSearch =
      !keyword ||
      provider.nameZh.toLowerCase().includes(keyword) ||
      provider.nameEn.toLowerCase().includes(keyword) ||
      provider.shortName.toLowerCase().includes(keyword)
    return matchesFilter && matchesSearch
  })
})

function windowSummary(windowId: TokenPlanWindowId): number | null {
  const values = TOKEN_PLAN_PROVIDERS.flatMap((provider) => {
    const usage = snapshots[provider.id]?.windows.find((item) => item.id === windowId)
    return usage?.available && usage.usedPercent !== null ? [usage.usedPercent] : []
  })
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

const summaryCards = computed(() => {
  const windows: Array<{ id: TokenPlanWindowId; icon: string; color: string }> = [
    { id: '5h', icon: 'schedule', color: '#f97316' },
    { id: '7d', icon: 'calendar_today', color: '#0891b2' },
  ]
  return windows.map((window) => ({ ...window, percent: windowSummary(window.id) }))
})

function summaryTitle(windowId: TokenPlanWindowId): string {
  const titles: Record<TokenPlanWindowId, string> = {
    '5h': label('5-hour usage', '5 小时用量'),
    '7d': label('7-day usage', '7 天用量'),
  }
  return titles[windowId]
}

function summaryValue(percent: number | null): string {
  if (percent === null) return '--'
  return `${Math.round(percent * 10) / 10}%`
}

function credentialNote(providerId: TokenPlanProviderId): string {
  switch (providerId) {
    case 'minimax':
      return label(
        'The key directly returns the live 5-hour and weekly remaining percentage.',
        '该密钥可直接返回实时 5 小时和每周剩余百分比。',
      )
    case 'zhipu':
      return label(
        'The key returns 5-hour, weekly and monthly MCP tool-call quota fields.',
        '该密钥可返回 5 小时、每周及每月 MCP 工具调用额度字段。',
      )
  }
}

function actionErrorText(providerId: TokenPlanProviderId): string {
  switch (actionErrors[providerId]) {
    case 'save':
      return label('Could not save this key.', '密钥保存失败。')
    case 'restart':
      return label(
        'The background process is still on the old version. Fully quit and restart the app, then query again.',
        '当前后台进程仍是旧版本，请完全退出应用后重新启动，再点击查询。',
      )
    case 'remove':
      return label('Could not remove this key.', '密钥删除失败。')
    case 'query':
      return label('Could not query this provider.', '厂商查询失败。')
    default:
      return ''
  }
}

function canSubmitCredential(providerId: TokenPlanProviderId): boolean {
  return draftKeys[providerId].trim().length > 0
}

async function handleSave(providerId: TokenPlanProviderId): Promise<void> {
  const saved = await saveCredential(providerId, draftKeys[providerId])
  if (!saved) return
  draftKeys[providerId] = ''
}

async function handleRemove(providerId: TokenPlanProviderId): Promise<void> {
  const provider = TOKEN_PLAN_PROVIDERS.find((item) => item.id === providerId)
  const providerName = currentLang.value === 'zh' ? provider?.nameZh : provider?.nameEn
  const confirmed = window.confirm(
    label(
      `Remove the saved key for ${providerName ?? providerId}?`,
      `确定删除 ${providerName ?? providerId} 已保存的密钥吗？`,
    ),
  )
  if (confirmed) await removeCredential(providerId)
}

async function openCredentialManager(): Promise<void> {
  showCredentials.value = true
  await nextTick()
  document
    .querySelector('.credential-panel')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function openDocs(url: string): Promise<void> {
  await window.api.openExternal(url)
}

onMounted(() => {
  void initialize()
})
</script>

<template>
  <div class="token-plan-page">
    <PageIntro
      :eyebrow="label('LIVE PROVIDER QUOTAS', '真实厂商额度')"
      :title="label('Plan Usage', '套餐使用额度')"
      :subtitle="
        label(
          'Keys are stored only on this device. Keep them safe and prevent leakage.',
          '秘钥只会存于本地，请妥善保管秘钥，谨防泄漏',
        )
      "
      icon="deployed_code_account"
    >
      <template #actions>
        <button
          class="token-plan-page__primary-btn"
          type="button"
          :disabled="refreshingAll || configuredCount === 0"
          @click="refreshAllProviders"
        >
          <span class="material-symbols-outlined" :class="{ 'is-spinning': refreshingAll }">
            refresh
          </span>
          {{ label('Refresh all', '全部刷新') }}
        </button>
        <button
          class="token-plan-page__secondary-btn"
          type="button"
          @click="showCredentials = !showCredentials"
        >
          <span class="material-symbols-outlined">key</span>
          {{ label('Manage keys', '管理密钥') }}
        </button>
      </template>
    </PageIntro>

    <div v-if="loadFailed" class="token-plan-page__global-error">
      <span class="material-symbols-outlined">error</span>
      {{
        label(
          'Could not load the encrypted credential store.',
          '无法读取加密密钥存储，请重启应用后重试。',
        )
      }}
    </div>

    <section class="summary-grid" aria-label="Quota summary">
      <article
        v-for="card in summaryCards"
        :key="card.id"
        class="summary-card"
        :style="{ '--summary-color': card.color }"
      >
        <div class="summary-card__icon">
          <span class="material-symbols-outlined">{{ card.icon }}</span>
        </div>
        <div>
          <span>{{ summaryTitle(card.id) }}</span>
          <strong>{{ summaryValue(card.percent) }}</strong>
        </div>
      </article>

      <article class="summary-card summary-card--providers" style="--summary-color: #059669">
        <div class="summary-card__icon"><span class="material-symbols-outlined">hub</span></div>
        <div>
          <span>{{ label('Connected providers', '已接入厂商') }}</span>
          <strong>{{ configuredCount }}/2</strong>
        </div>
      </article>
    </section>

    <section v-if="showCredentials" class="credential-panel">
      <header class="credential-panel__header">
        <div>
          <h2>{{ label('Provider API keys', '厂商 API Key') }}</h2>
          <p>
            {{
              label(
                'Keys are encrypted locally. The page receives only whether each provider is configured.',
                '秘钥仅在本地加密保存，页面只接收是否已配置，不接收任何秘钥片段。',
              )
            }}
          </p>
        </div>
        <button type="button" :title="label('Close', '关闭')" @click="showCredentials = false">
          <span class="material-symbols-outlined">close</span>
        </button>
      </header>

      <div class="credential-panel__grid">
        <article
          v-for="provider in TOKEN_PLAN_PROVIDERS"
          :key="provider.id"
          class="credential-item"
        >
          <div class="credential-item__heading">
            <div class="credential-item__mark" :style="{ background: provider.gradient }">
              {{ provider.mark }}
            </div>
            <div>
              <strong>{{ currentLang === 'zh' ? provider.nameZh : provider.nameEn }}</strong>
              <span v-if="credentialFor(provider.id).configured">
                <span class="credential-item__ok"></span>
                {{ label('Configured', '已配置') }}
              </span>
              <span v-else>{{ label('Not configured', '未配置') }}</span>
            </div>
          </div>

          <p>{{ credentialNote(provider.id) }}</p>
          <div class="credential-item__input-row">
            <input
              v-model="draftKeys[provider.id]"
              type="password"
              autocomplete="new-password"
              spellcheck="false"
              :placeholder="
                credentialFor(provider.id).configured
                  ? label('Enter a new key to replace it', '输入新密钥以替换')
                  : provider.keyHint
              "
              @keyup.enter="handleSave(provider.id)"
            />
            <button
              class="credential-item__save"
              type="button"
              :disabled="!canSubmitCredential(provider.id) || saving[provider.id]"
              @click="handleSave(provider.id)"
            >
              {{ saving[provider.id] ? label('Querying…', '查询中…') : label('Query', '查询') }}
            </button>
            <button
              v-if="credentialFor(provider.id).configured"
              class="credential-item__remove"
              type="button"
              :disabled="removing[provider.id]"
              :title="label('Remove key', '删除密钥')"
              @click="handleRemove(provider.id)"
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </div>
          <small v-if="actionErrorText(provider.id)" class="credential-item__error">
            {{ actionErrorText(provider.id) }}
          </small>
        </article>
      </div>
    </section>

    <section class="provider-toolbar">
      <div class="provider-toolbar__filters">
        <button
          v-for="filter in ['all', 'coding', 'token'] as const"
          :key="filter"
          type="button"
          :class="{ active: providerFilter === filter }"
          @click="providerFilter = filter"
        >
          <span class="material-symbols-outlined">
            {{ filter === 'all' ? 'grid_view' : filter === 'coding' ? 'code' : 'deployed_code' }}
          </span>
          {{
            filter === 'all'
              ? label('All', '全部')
              : filter === 'coding'
                ? 'Coding Plan'
                : 'Token Plan'
          }}
        </button>
      </div>
      <label class="provider-toolbar__search">
        <span class="material-symbols-outlined">search</span>
        <input v-model="search" :placeholder="label('Search providers…', '搜索厂商…')" />
      </label>
    </section>

    <div v-if="initializing" class="token-plan-page__loading">
      <span class="material-symbols-outlined is-spinning">progress_activity</span>
      {{ label('Loading encrypted keys and live quota data…', '正在读取加密密钥并查询真实额度…') }}
    </div>

    <section v-else-if="visibleProviders.length" class="provider-list">
      <ProviderQuotaCard
        v-for="provider in visibleProviders"
        :key="provider.id"
        :provider="provider"
        :credential="credentialFor(provider.id)"
        :snapshot="snapshots[provider.id]"
        :loading="refreshing[provider.id]"
        :action-error="actionErrors[provider.id]"
        @refresh="refreshProvider(provider.id)"
        @manage="openCredentialManager"
        @docs="openDocs(provider.docsUrl)"
      />
    </section>

    <div v-else class="token-plan-page__empty">
      <span class="material-symbols-outlined">search_off</span>
      {{ label('No matching provider', '没有符合筛选条件的厂商') }}
    </div>
  </div>
</template>

<style scoped src="../styles/token-plan-page.css"></style>
