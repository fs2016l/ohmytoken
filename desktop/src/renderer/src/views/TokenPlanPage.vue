<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PageSurface from '../components/base/PageSurface.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import SelectControl from '../components/base/SelectControl.vue'
import DropdownChevron from '../components/base/DropdownChevron.vue'
import ProviderQuotaCard from '../components/token-plan/ProviderQuotaCard.vue'
import QuotaRefreshInterval from '../components/token-plan/QuotaRefreshInterval.vue'
import QuotaDetailsModal from '../components/token-plan/QuotaDetailsModal.vue'
import PlanRenewalManager from '../components/token-plan/PlanRenewalManager.vue'
import { TOKEN_PLAN_PROVIDERS } from '../config/token-plan-providers'
import { useTokenPlanUsage } from '../composables/useTokenPlanUsage'
import { usePageState } from '../composables/usePageState'
import { useFloatingCardDrag } from '../composables/useFloatingCardDrag'
import { motion } from '../config/motion'
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
  { value: 'renewals', label: label('Cycles', '周期') },
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
// 卡片可拖动排序，顺序只保存在本机；新发现的连接排在已排序卡片之后。
const orderKey = 'quota-page-order'
function readOrder(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(orderKey) ?? '[]')
    return Array.isArray(stored)
      ? [
          ...new Set(
            stored.filter((id): id is string => typeof id === 'string' && id.length <= 256),
          ),
        ]
      : []
  } catch {
    return []
  }
}
const order = ref(readOrder())
const dragging = ref('')
const orderFailed = ref(false)
let orderBeforeDrag: string[] = []
const ordered = computed(() => {
  const rank = new Map(order.value.map((id, index) => [id, index]))
  return [...matching.value].sort(
    (a, b) => (rank.get(a.id) ?? order.value.length) - (rank.get(b.id) ?? order.value.length),
  )
})
function moveCard(target: string | null, position: 'before' | 'after' | null): void {
  const source = dragging.value
  if (!source || !target || source === target || !position) return
  const ids = [...new Set([...order.value, ...detected.value.map((row) => row.id)])]
  const sourceIndex = ids.indexOf(source)
  if (sourceIndex < 0 || !ids.includes(target)) return
  ids.splice(sourceIndex, 1)
  ids.splice(ids.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
  if (ids.some((id, index) => id !== order.value[index])) order.value = ids
}
const { start: startDrag } = useFloatingCardDrag({
  layout: 'grid',
  scroll: '.page-surface',
  key: (card) => card.dataset.connection ?? '',
  cards: (card) => [
    ...(card.closest('.quota-list')?.querySelectorAll<HTMLElement>('[data-connection]') ?? []),
  ],
  previewClass: 'quota-card-drag-preview',
  draggingClass: 'quota-card--dragging',
  onStart: (id) => {
    orderBeforeDrag = [...order.value]
    dragging.value = id
  },
  onOver: moveCard,
  onEnd: () => {
    dragging.value = ''
    try {
      localStorage.setItem(orderKey, JSON.stringify(order.value))
      orderFailed.value = false
    } catch {
      orderFailed.value = true
    }
  },
  // Esc 或窗口失去焦点时放弃本次拖动，恢复拖动前的顺序。
  onCancel: () => {
    order.value = orderBeforeDrag
    dragging.value = ''
  },
})
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
  <PageSurface
    ref="surface"
    page-key="quota"
    class="quota-page-surface"
    :fixed="state.status === 'renewals'"
    :class="{ 'quota-renewals-surface': state.status === 'renewals' }"
  >
    <header class="workspace-heading">
      <div>
        <h1>{{ label('Quota', '额度') }}</h1>
        <p>
          {{ label('Check quotas and subscription renewal dates.', '查看额度与套餐续费时间。') }}
        </p>
      </div>
    </header>
    <div class="quota-toolbar">
      <SegmentedControl
        v-model="state.status"
        :options="statusOptions"
        :label="label('Quota view', '额度视图')"
      />
      <template v-if="state.status !== 'renewals'">
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
      </template>
    </div>
    <PlanRenewalManager v-if="state.status === 'renewals'" />
    <template v-else>
      <div v-if="loadFailed" class="workspace-error quota-notice" role="status">
        {{
          label(
            'Some connections could not be refreshed. Existing results remain available.',
            '部分连接暂时未能刷新，已有结果仍可查看。',
          )
        }}
      </div>
      <p v-if="orderFailed" class="workspace-error quota-notice" role="alert">
        {{
          label('Could not save the order. Drag again to retry.', '顺序未能保存，请重新拖动重试。')
        }}
      </p>
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
      <TransitionGroup
        v-else
        tag="section"
        name="quota-reorder"
        class="quota-list"
        :aria-label="label('Account quotas', '账户额度')"
        :style="{ '--quota-reorder-duration': `${motion.reorder}ms` }"
      >
        <ProviderQuotaCard
          v-for="connection in ordered"
          :key="connection.id"
          :class="{ 'quota-card--dragging': dragging === connection.id }"
          :data-connection="connection.id"
          :connection="connection"
          :snapshot="snapshots[connection.id]"
          :loading="refreshing.has(connection.id)"
          :expanded="state.expanded.includes(connection.id)"
          @update:expanded="expand(connection.id, $event)"
          @refresh="refreshConnection(connection.id)"
          @details="state.detailId = connection.id"
          @pointerdown="startDrag"
        />
      </TransitionGroup>
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
    </template>
  </PageSurface>
</template>

<style scoped>
.quota-page-surface {
  scrollbar-gutter: stable;
}
@media (max-width: 1160px) {
  .quota-renewals-surface {
    overflow: auto;
  }
  .quota-renewals-surface :deep(.page-surface-content) {
    flex: none;
  }
}
.quota-toolbar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}
.quota-toolbar .select-control {
  max-width: 150px;
}
/* 卡片至少 460px：宽窗口两列，窄窗口单列；同一排卡片等高。 */
.quota-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(460px, 1fr));
  gap: 16px;
}
.quota-reorder-move {
  transition: transform var(--quota-reorder-duration) var(--motion-ease);
}
@media (prefers-reduced-motion: reduce) {
  .quota-reorder-move {
    transition: none;
  }
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
