<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageSurface from '../components/base/PageSurface.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import SelectControl from '../components/base/SelectControl.vue'
import DropdownChevron from '../components/base/DropdownChevron.vue'
import ProviderQuotaCard from '../components/token-plan/ProviderQuotaCard.vue'
import QuotaRefreshInterval from '../components/token-plan/QuotaRefreshInterval.vue'
import QuotaDetailsModal from '../components/token-plan/QuotaDetailsModal.vue'
import { TOKEN_PLAN_PROVIDERS } from '../config/token-plan-providers'
import { useTokenPlanUsage } from '../composables/useTokenPlanUsage'
import { usePageState } from '../composables/usePageState'
import { useI18n } from '../i18n/useI18n'
import type { TokenPlanConnection } from '../../../shared/token-plan'

const { label, currentLang } = useI18n()
const {
  inventory,
  snapshots,
  refreshing,
  initializing,
  busy,
  loadFailed,
  refreshAll,
  refreshConnection,
  refreshInterval,
  setRefreshInterval,
} = useTokenPlanUsage()
const state = usePageState('quota', {
  provider: 'all',
  status: 'all',
  expanded: [] as string[],
  detailId: '',
  diagnostics: false as boolean,
})
const surface = ref<InstanceType<typeof PageSurface> | null>(null)
const detected = computed(() => inventory.value?.connections ?? [])
const detailConnection = computed(
  () => detected.value.find((row) => row.id === state.detailId) ?? null,
)
function availability(connection: TokenPlanConnection): 'available' | 'failed' | 'pending' {
  const snapshot = snapshots.value[connection.id]
  if (snapshot?.windows.some((window) => window.available)) return 'available'
  if (connection.state !== 'ready' || snapshot?.errorCode || snapshot?.status === 'error')
    return 'failed'
  return 'pending'
}
const statusOptions = computed(() => [
  { value: 'all', label: label('All accounts', '全部账号') + ' ' + detected.value.length },
  {
    value: 'available',
    label:
      label('Available', '可用') +
      ' ' +
      detected.value.filter((row) => availability(row) === 'available').length,
  },
  {
    value: 'failed',
    label:
      label('Unavailable', '识别失败') +
      ' ' +
      detected.value.filter((row) => availability(row) === 'failed').length,
  },
])
const matching = computed(() =>
  detected.value.filter(
    (connection) =>
      (state.provider === 'all' || connection.providerId === state.provider) &&
      (state.status === 'all' || availability(connection) === state.status),
  ),
)
watch(
  () => [state.provider, state.status],
  () => surface.value?.scrollToTop(),
)
function expand(id: string, expanded: boolean): void {
  state.expanded = expanded
    ? [...new Set([...state.expanded, id])]
    : state.expanded.filter((value) => value !== id)
}
function issueText(reason: string): string {
  if (reason === 'unreadable') return label('Configuration could not be read', '配置暂时无法读取')
  if (reason === 'invalid_config')
    return label('Configuration format not recognized', '配置格式无法识别')
  if (reason === 'scope_missing')
    return label('Account or project scope is incomplete', '账户或项目范围不完整')
  return label('No verified quota interface for this connection', '该连接暂无已验证的额度查询接口')
}
</script>

<template>
  <PageSurface ref="surface" page-key="quota">
    <header class="workspace-heading">
      <div>
        <h1>{{ label('Quota', '额度') }}</h1>
        <p>{{ label('Remaining now, and when it resets.', '当前还剩多少，下一次何时恢复。') }}</p>
      </div>
    </header>
    <div class="quota-toolbar">
      <SegmentedControl
        v-model="state.status"
        :options="statusOptions"
        :label="label('Account status', '账号状态')"
      />
      <SelectControl
        v-model="state.provider"
        :label="label('Provider', '厂商')"
        :options="[
          { value: 'all', label: label('All providers', '全部厂商') },
          ...TOKEN_PLAN_PROVIDERS.map((provider) => ({
            value: provider.id,
            label: currentLang === 'zh' ? provider.nameZh : provider.nameEn,
          })),
        ]"
      />
      <QuotaRefreshInterval
        :model-value="refreshInterval"
        @update:model-value="setRefreshInterval"
      />
      <button class="workspace-button" type="button" :disabled="busy" @click="refreshAll()">
        <span v-if="busy" class="material-symbols-outlined is-spinning">refresh</span>
        {{ label('Refresh quota', '刷新额度') }}
      </button>
    </div>
    <div v-if="loadFailed" class="workspace-error quota-notice" role="status">
      {{
        label(
          'Some connections could not be refreshed. Existing results remain available.',
          '部分连接暂时未能刷新，已有结果仍可查看。',
        )
      }}
    </div>
    <div v-if="initializing && !detected.length" class="workspace-empty" role="status">
      {{ label('Detecting existing connections…', '正在自动发现已有连接…') }}
    </div>
    <div v-else-if="!detected.length" class="workspace-empty">
      <span class="material-symbols-outlined">account_balance_wallet</span>
      <strong>{{ label('No supported connection found yet', '暂未发现可识别的连接') }}</strong>
      <p>
        {{
          label(
            'Sign in or configure a provider in your Agent and complete one conversation, then refresh quota here.',
            '在 Agent 中登录或配置厂商，并完成一次对话后，再点击刷新额度。',
          )
        }}
      </p>
    </div>
    <div v-else-if="!matching.length" class="workspace-empty">
      {{ label('No matching connections', '没有匹配的连接') }}
    </div>
    <section v-else class="quota-list" :aria-label="label('Account quotas', '账户额度')">
      <ProviderQuotaCard
        v-for="connection in matching"
        :key="connection.id"
        :connection="connection"
        :snapshot="snapshots[connection.id]"
        :loading="refreshing.has(connection.id)"
        :expanded="state.expanded.includes(connection.id)"
        @update:expanded="expand(connection.id, $event)"
        @refresh="refreshConnection(connection.id)"
        @details="state.detailId = connection.id"
      />
    </section>
    <QuotaDetailsModal
      v-if="detailConnection"
      :key="detailConnection.id"
      :connection="detailConnection"
      @close="state.detailId = ''"
    />
    <details
      class="quota-diagnostics"
      :open="state.diagnostics"
      @toggle="state.diagnostics = ($event.target as HTMLDetailsElement).open"
    >
      <summary class="disclosure-summary">
        <DropdownChevron disclosure direction="right" />
        {{ label('Connection detection', '连接检测') }}
      </summary>
      <template v-if="state.diagnostics">
        <div v-if="inventory">
          <p>
            {{ label('Checked sources', '已检查来源') }} ·
            {{ inventory.checkedSources.join(' · ') }}
          </p>
          <p v-for="issue in inventory.issues" :key="issue.source + ':' + issue.reason">
            {{ issue.source }}：{{ issueText(issue.reason) }}
          </p>
        </div>
      </template>
    </details>
  </PageSurface>
</template>

<style scoped>
.quota-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.quota-toolbar .select-control {
  max-width: 150px;
}
.quota-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.quota-notice {
  margin-bottom: 16px;
}
.quota-diagnostics {
  margin-top: 24px;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 20px;
}
.quota-diagnostics summary {
  cursor: pointer;
}
.quota-diagnostics > div {
  margin-top: 16px;
}
.workspace-empty p {
  margin: 0;
  max-width: 560px;
}
</style>
