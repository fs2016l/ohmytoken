<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import DesignIcon from '../base/DesignIcon.vue'
import RollingText from '../base/RollingText.vue'
import VendorMark from '../base/VendorMark.vue'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import QuotaWindowTile from '../token-plan/QuotaWindowTile.vue'
import QuotaUpdatedAt from '../token-plan/QuotaUpdatedAt.vue'
import QuotaRefreshInterval from '../token-plan/QuotaRefreshInterval.vue'
import NetworkRefreshButton from '../network/NetworkRefreshButton.vue'
import FloatingQuotaSummary from './FloatingQuotaSummary.vue'
import { useTokenPlanUsage } from '../../composables/useTokenPlanUsage'
import { useFloatingScroll } from '../../composables/useFloatingScroll'
import { useFloatingCardDrag } from '../../composables/useFloatingCardDrag'
import { motion } from '../../config/motion'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../../config/token-plan-providers'
import { quotaRemainingPercent } from '../../utils/quota-display'
import { useI18n } from '../../i18n/useI18n'
import type { FloatingWorkspace } from '@shared/floating-window'
import type { TokenPlanConnection } from '@shared/token-plan'

defineProps<{ compact?: boolean }>()
const emit = defineEmits<{
  open: [destination: FloatingWorkspace]
  attention: [value: boolean]
  expand: []
}>()
const { label, currentLang } = useI18n()
const {
  inventory,
  snapshots,
  busy,
  refreshing,
  loadFailed,
  lastRefreshAt,
  refreshAll,
  refreshConnection,
  refreshInterval,
  setRefreshInterval,
} = useTokenPlanUsage()
const storageKey = 'floating-quota-followed'
function readIds(key = storageKey): string[] | null {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(stored)
      ? [
          ...new Set(
            stored.filter((id): id is string => typeof id === 'string' && id.length <= 256),
          ),
        ]
      : null
  } catch {
    return null
  }
}
const selected = ref(readIds())
const orderKey = 'floating-quota-order'
const order = ref(readIds(orderKey) ?? [])
const dragging = ref('')
const orderFailed = ref(false)
const managing = ref(false)
function manageCompact(): void {
  emit('expand')
  managing.value = true
}
const { scroll, save } = useFloatingScroll()
const connections = computed(() => {
  const rank = new Map(order.value.map((id, index) => [id, index]))
  return [...(inventory.value?.connections ?? [])].sort(
    (a, b) => (rank.get(a.id) ?? order.value.length) - (rank.get(b.id) ?? order.value.length),
  )
})
const followed = computed(() =>
  connections.value.filter((row) => selected.value === null || selected.value.includes(row.id)),
)
function moveAccount(target: string | null, position: 'before' | 'after' | null): void {
  const source = dragging.value
  if (!source || !target || source === target || !position) return
  const ids = [...new Set([...order.value, ...connections.value.map((row) => row.id)])]
  const sourceIndex = ids.indexOf(source)
  if (sourceIndex < 0 || !ids.includes(target)) return
  ids.splice(sourceIndex, 1)
  ids.splice(ids.indexOf(target) + (position === 'after' ? 1 : 0), 0, source)
  if (ids.some((id, index) => id !== order.value[index])) order.value = ids
}
const { start: startDrag, stop: stopDrag } = useFloatingCardDrag({
  key: (card) => card.dataset.connection ?? '',
  cards: (card) => [
    ...(card
      .closest('.floating-quota-list, .floating-follow-list')
      ?.querySelectorAll<HTMLElement>('[data-connection]') ?? []),
  ],
  previewClass: 'floating-quota-drag-preview',
  draggingClass: 'floating-quota-account--dragging',
  onStart: (id) => {
    dragging.value = id
  },
  onOver: moveAccount,
  onEnd: () => {
    dragging.value = ''
    try {
      localStorage.setItem(orderKey, JSON.stringify(order.value))
      orderFailed.value = false
    } catch {
      orderFailed.value = true
    }
  },
})
watch(managing, (open) => {
  if (!open) stopDrag()
})
const missing = computed(() =>
  (selected.value ?? []).filter((id) => !connections.value.some((row) => row.id === id)),
)
const risks = computed(() =>
  Object.fromEntries(
    followed.value.map((row) => {
      const values = (snapshots.value[row.id]?.windows ?? [])
        .map(quotaRemainingPercent)
        .filter((value): value is number => value !== null)
      return [row.id, values.length ? Math.min(...values) : null]
    }),
  ),
)
const updated = computed(() => {
  const checked = followed.value.map((row) => snapshots.value[row.id]?.observedAt ?? 0)
  return Math.max(0, ...checked)
})
function providerName(row: TokenPlanConnection): string {
  const provider = TOKEN_PLAN_PROVIDER_BY_ID[row.providerId]
  return currentLang.value === 'zh' ? provider.nameZh : provider.nameEn
}
function riskText(id: string): string {
  const risk = risks.value[id]
  if (risk === null || risk === undefined || risk > 20) return ''
  if (risk <= 0) return label('Exhausted', '额度耗尽')
  if (risk <= 10) return label('Very low', '额度极低')
  return label('Low quota', '额度偏低')
}
function toggle(id: string): void {
  const ids = selected.value ?? connections.value.map((row) => row.id)
  selected.value = ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]
}
function issueText(row: TokenPlanConnection): string {
  const code = snapshots.value[row.id]?.errorCode
  if (code === 'region_restricted')
    return label(
      'The current region is restricted. Refresh has been stopped for safety.',
      '当前区域受限，为安全考虑，已停止刷新。',
    )
  if (code === 'region_unknown')
    return label(
      'Unable to confirm the current network region. Refresh has been stopped for safety.',
      '无法确认当前网络区域，为安全考虑，已停止刷新。',
    )
  if (code === 'expired' || code === 'invalid_credential' || row.state === 'expired')
    return label(
      'Sign in to the source Agent and complete one conversation, then refresh quota.',
      '请在原 Agent 中登录并完成一次对话后，再刷新额度。',
    )
  if (code === 'unsupported' || row.state === 'unsupported')
    return label('Quota lookup is not supported for this connection.', '此连接暂不支持额度查询。')
  if (code === 'permission_denied')
    return label('This connection cannot read account quota.', '该连接无读取账户额度的权限。')
  if (code === 'rate_limited')
    return label('Provider rate limit. Please retry later.', '厂商限制了查询频率，请稍后重试。')
  if (code)
    return label(
      'Quota refresh failed. Previous readings are retained.',
      '额度刷新失败，已保留上次读数。',
    )
  return ''
}
watch(selected, (value) => localStorage.setItem(storageKey, JSON.stringify(value)), { deep: true })
watch(
  risks,
  (values) =>
    emit(
      'attention',
      Object.values(values).some((value) => value !== null && value <= 20),
    ),
  { immediate: true },
)
</script>

<template>
  <section class="floating-pane" :aria-label="label('Quota monitor', '额度监测')">
    <FloatingQuotaSummary
      v-show="compact"
      :followed="followed"
      :snapshots="snapshots"
      :failed="loadFailed"
      :refreshed-at="lastRefreshAt"
      :busy="busy"
      @expand="emit('expand')"
      @manage="manageCompact"
    />
    <div
      v-show="!compact"
      ref="scroll"
      class="floating-scroll floating-quota-scroll"
      @scroll="save"
    >
      <div class="floating-row floating-quota-heading">
        <strong>{{ label('Remaining quota', '剩余额度') }}</strong>
        <span>{{ followed.length }} {{ label('followed accounts', '个关注账号') }}</span>
      </div>
      <p v-if="loadFailed" class="floating-error" role="alert">
        {{ label('Refresh failed. Retry below.', '刷新失败，请在下方重试。') }}
      </p>
      <p v-if="orderFailed" class="floating-error" role="alert">
        {{
          label('Could not save the order. Drag again to retry.', '顺序未能保存，请重新拖动重试。')
        }}
      </p>
      <TransitionGroup
        tag="div"
        name="floating-quota-reorder"
        class="floating-quota-list"
        :style="{ '--quota-reorder-duration': `${motion.reorder}ms` }"
      >
        <article
          v-for="row in followed"
          :key="row.id"
          class="floating-quota-account floating-card"
          :class="{ 'floating-quota-account--dragging': !managing && dragging === row.id }"
          :data-connection="row.id"
          :aria-busy="refreshing.has(row.id)"
          @pointerdown="startDrag"
        >
          <header class="floating-row" :title="label('Drag to reorder', '拖动调整顺序')">
            <div class="floating-quota-identity">
              <strong class="floating-quota-name">
                <VendorMark :provider="row.providerId" :size="14" />
                {{ providerName(row) }}
              </strong>
              <span v-if="snapshots[row.id]?.plan.tier" class="floating-quota-tier">
                <RollingText :text="snapshots[row.id].plan.tier!" />
              </span>
              <QuotaUpdatedAt
                class="floating-quota-updated"
                :observed-at="snapshots[row.id]?.observedAt"
              />
            </div>
            <span
              v-if="riskText(row.id)"
              class="floating-quota-risk"
              :class="{ critical: risks[row.id] !== null && risks[row.id]! <= 10 }"
            >
              {{ riskText(row.id) }}
            </span>
            <button
              class="floating-link"
              :aria-label="label('Open quota page', '打开额度页面')"
              @click="emit('open', 'quota')"
            >
              <DesignIcon name="floatingArrow" :size="16" />
            </button>
          </header>
          <div v-if="snapshots[row.id]?.windows.length" class="floating-quota-grid">
            <QuotaWindowTile
              v-for="usage in snapshots[row.id].windows"
              :key="usage.id"
              :usage="usage"
              compact
            />
          </div>
          <div v-else class="floating-empty">
            <strong>—</strong>
            <p>
              {{
                refreshing.has(row.id)
                  ? label('Loading quota…', '正在查询额度…')
                  : label('No verified quota returned', '尚未返回可确认的额度')
              }}
            </p>
          </div>
          <div v-if="issueText(row)" class="floating-quota-error" role="status">
            <span>{{ issueText(row) }}</span>
            <button
              class="floating-link"
              :disabled="refreshing.has(row.id)"
              @click="refreshConnection(row.id)"
            >
              {{ label('Retry', '重试') }}
            </button>
          </div>
        </article>
      </TransitionGroup>
      <p v-if="!followed.length" class="floating-empty">
        {{
          busy
            ? label('Discovering accounts…', '正在识别账号…')
            : connections.length
              ? label('Choose accounts to follow below.', '请在下方选择要关注的账号。')
              : label(
                  'No quota accounts detected. Sign in to a supported Agent and complete one conversation, then refresh quota.',
                  '尚未识别到额度账号，请在支持的 Agent 中登录并完成一次对话后，再刷新额度。',
                )
        }}
      </p>
      <div class="floating-row floating-quota-manage">
        <button class="floating-link" @click="managing = true">
          {{ label('Manage follows', '管理关注') }}
        </button>
        <button class="floating-link floating-all-quota" @click="emit('open', 'quota')">
          {{ label('All quota', '全部额度') }}
          <DesignIcon name="externalLink" :size="12" />
        </button>
      </div>
    </div>
    <footer v-show="!compact" class="floating-footer floating-quota-footer">
      <span>
        <QuotaUpdatedAt v-if="updated" :observed-at="updated" />
        <template v-else>{{ label('Waiting for data', '等待数据') }}</template>
      </span>
      <div class="floating-row">
        <QuotaRefreshInterval
          :model-value="refreshInterval"
          compact
          placement="top"
          @update:model-value="setRefreshInterval"
        />
        <NetworkRefreshButton
          floating
          :label="label('Refresh quota', '刷新额度')"
          :running="busy"
          @click="refreshAll()"
        />
      </div>
    </footer>
    <WorkspaceDialog
      :open="managing"
      :title="label('Followed accounts', '关注账号')"
      class="floating-follow-dialog"
      @close="managing = false"
    >
      <p class="floating-follow-hint">
        {{
          label(
            'Drag accounts to reorder. Preferences are saved on this device.',
            '拖动账号可调整顺序，关注偏好保存在当前设备。',
          )
        }}
      </p>
      <p v-if="orderFailed" class="floating-error" role="alert">
        {{
          label('Could not save the order. Drag again to retry.', '顺序未能保存，请重新拖动重试。')
        }}
      </p>
      <div class="floating-row">
        <button class="floating-link" @click="selected = null">
          {{ label('Follow all', '关注全部') }}
        </button>
        <button class="floating-link" @click="selected = []">{{ label('Clear', '清空') }}</button>
      </div>
      <TransitionGroup
        tag="div"
        name="floating-quota-reorder"
        class="floating-follow-list"
        :style="{ '--quota-reorder-duration': `${motion.reorder}ms` }"
      >
        <label
          v-for="row in connections"
          :key="row.id"
          class="floating-follow-choice"
          :class="{ 'floating-quota-account--dragging': managing && dragging === row.id }"
          :data-connection="row.id"
          :title="label('Drag to reorder', '拖动调整顺序')"
          @pointerdown="startDrag"
        >
          <input
            type="checkbox"
            :checked="selected === null || selected.includes(row.id)"
            @change="toggle(row.id)"
          />
          <span>
            <strong>{{ providerName(row) }}</strong>
            <small>{{ row.accountLabel || row.sources.join(' · ') }}</small>
          </span>
        </label>
      </TransitionGroup>
      <div v-for="id in missing" :key="id" class="floating-follow-choice">
        <span>
          {{ label('Connection no longer detected', '连接暂未识别') }}
          <small>{{ id }}</small>
        </span>
        <button class="floating-link" @click="toggle(id)">{{ label('Remove', '移除') }}</button>
      </div>
      <p v-if="!connections.length" class="floating-empty">
        {{ label('No accounts detected yet', '暂未识别到账号') }}
      </p>
    </WorkspaceDialog>
  </section>
</template>

<style scoped src="./floating-quota.css"></style>
