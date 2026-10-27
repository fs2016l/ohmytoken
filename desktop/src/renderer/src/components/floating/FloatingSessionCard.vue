<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useFloatingCardDrag } from '../../composables/useFloatingCardDrag'
import { getAgentName } from '../../config/agents'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/format'
import type { FloatingSessionItem } from '../../composables/useFloatingSessions'
import SessionCost from '../agent/SessionCost.vue'
import SessionTurns from '../agent/SessionTurns.vue'
import GenerationMetrics from '../agent/GenerationMetrics.vue'
import SessionTurnStatus from '../agent/SessionTurnStatus.vue'
import { hasTurnUsage } from '@shared/session-turn-view'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import TokenShare from '../base/TokenShare.vue'
import RollingText from '../base/RollingText.vue'
import AgentMark from '../base/AgentMark.vue'
import CopyText from '../base/CopyText.vue'
import FavoriteButton from '../base/FavoriteButton.vue'
import CollapseRegion from '../base/CollapseRegion.vue'

type DropPosition = 'before' | 'after'

const props = defineProps<{
  session: FloatingSessionItem
  pinned: boolean
  dragging?: boolean
  dropPosition?: DropPosition | null
  delta?: number
  now: number
  unavailable?: boolean
}>()

const emit = defineEmits<{
  dragStart: [key: string]
  dragOver: [targetKey: string | null, position: DropPosition | null]
  dragEnd: []
}>()

const { label } = useI18n()
const expanded = ref(false)
const detailsId = useId()

const encodedSessionKey = computed(() => encodeURIComponent(props.session.key))
const { start: startPointerDrag } = useFloatingCardDrag({
  enabled: () => props.pinned,
  key: (card) => decodeURIComponent(card.dataset.sessionDragKey ?? ''),
  cards: (card) => [
    ...(card
      .closest('.floating-session-list')
      ?.querySelectorAll<HTMLElement>('.session-card--pinned[data-session-drag-key]') ?? []),
  ],
  previewClass: 'session-card-drag-preview',
  draggingClass: 'session-card--dragging',
  onStart: (key) => emit('dragStart', key),
  onOver: (key, position) => emit('dragOver', key, position),
  onEnd: () => emit('dragEnd'),
})

const cacheTokens = computed(() => props.session.cacheReadTokens + props.session.cacheWriteTokens)

const displayTitle = computed(
  () =>
    props.session.title?.trim() ||
    `${label('Session', '会话')} ${props.session.rootSessionId.slice(0, 8)}`,
)

const models = computed(() => props.session.models.filter(Boolean))
const modelText = computed(() => {
  if (models.value.length === 0) return label('Unknown model', '未知模型')
  return `${models.value[0]}${models.value.length > 1 ? ` +${models.value.length - 1}` : ''}`
})
const allModels = computed(() => models.value.join(' · ') || label('Unknown model', '未知模型'))

const lastActivityAt = computed(() => {
  const value = props.session.endedAt || props.session.startedAt
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
})

const relativeActivity = computed(() => {
  if (!lastActivityAt.value) return '—'
  const elapsed = Math.max(0, props.now - lastActivityAt.value)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return label('just now', '刚刚')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return label(`${minutes}m ago`, `${minutes}分钟前`)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return label(`${hours}h ago`, `${hours}小时前`)
  return new Date(lastActivityAt.value).toLocaleDateString(label('en-US', 'zh-CN'), {
    month: 'numeric',
    day: 'numeric',
  })
})
</script>

<template>
  <article
    class="session-card floating-card"
    :class="{
      'session-card--pinned': pinned,
      'session-card--dragging': dragging,
      'session-card--expanded': expanded,
      'session-card--drop-before': dropPosition === 'before',
      'session-card--drop-after': dropPosition === 'after',
    }"
    :data-session-drag-key="encodedSessionKey"
    @pointerdown="startPointerDrag"
  >
    <div class="floating-session-summary">
      <button
        class="session-title"
        type="button"
        :title="displayTitle"
        :aria-expanded="expanded"
        :aria-controls="detailsId"
        @click="expanded = !expanded"
      >
        <RollingText :text="displayTitle" />
      </button>
      <AnimatedNumber
        :value="hasTurnUsage(session) ? session.totalTokens : null"
        :format="{ compact: true }"
        :replay="false"
      />
      <FavoriteButton
        class="session-favorite"
        :target="{ type: 'session', agent: session.agent, id: session.rootSessionId }"
      />
      <div class="session-metadata">
        <span class="session-meta" :title="`${getAgentName(session.agent)} · ${allModels}`">
          <AgentMark :agent="session.agent" :size="12" />
          <span class="session-agent">{{ getAgentName(session.agent) }}</span>
          <span class="session-meta-divider" aria-hidden="true">|</span>
          <RollingText :text="modelText" :title="allModels" />
        </span>
        <span class="session-status">
          <SessionTurnStatus
            v-if="session.turnScope === 'latest'"
            :status="session.latestTurn?.status"
          />
          <span class="session-activity">{{ relativeActivity }}</span>
          <span v-if="session.turnScope !== 'latest' && delta && delta > 0" class="session-delta">
            +{{ formatTokens(delta) }}
          </span>
        </span>
      </div>
    </div>
    <GenerationMetrics
      class="floating-generation"
      :sample="session.latestGeneration"
      :turn-first-token="session.latestTurnFirstToken"
      :agent="session.agent"
      :token-delta="delta"
      :motion-available="!unavailable && !dragging"
      floating
    />
    <CollapseRegion :id="detailsId" :open="expanded">
      <div class="session-expanded">
        <p v-if="unavailable" class="session-stale">
          {{
            label(
              'Not found in the latest scan. Showing the last saved reading.',
              '本轮暂未读到该会话，显示上次保存的读数。',
            )
          }}
        </p>
        <p v-if="models.length > 1" class="session-models">
          <span>{{ label('Models', '模型') }}</span>
          <span>{{ allModels }}</span>
        </p>
        <p v-if="!hasTurnUsage(session)" class="session-stale">
          {{ label('No usage recorded for this turn yet.', '尚未读到这一轮的用量记录') }}
        </p>
        <div v-else class="token-grid">
          <div class="token-cell">
            <span>{{ label('Input', '输入') }}</span>
            <strong>
              <span>{{ formatTokens(session.inputTokens) }}</span>
              <TokenShare :usage="session" bucket="input" plain />
            </strong>
          </div>
          <div class="token-cell">
            <span>{{ label('Output', '输出') }}</span>
            <strong>
              <span>{{ formatTokens(session.outputTokens) }}</span>
              <TokenShare :usage="session" bucket="output" plain />
            </strong>
          </div>
          <div class="token-cell">
            <span>{{ label('Cache', '缓存') }}</span>
            <strong>
              <span>{{ formatTokens(cacheTokens) }}</span>
              <TokenShare :usage="session" bucket="cache" plain />
            </strong>
          </div>
          <div class="token-cell">
            <span>{{ label('Reasoning', '推理') }}</span>
            <strong>
              <span>{{ formatTokens(session.reasoningTokens) }}</span>
              <TokenShare :usage="session" bucket="reasoning" plain />
            </strong>
          </div>
        </div>
        <SessionCost class="session-cost-section" :summary="session.costSummary" />
        <div class="session-footer">
          <SessionTurns :turns="session.turns" />
          <span>
            {{
              session.apiCallCountComplete === false
                ? label('Call count not provided', '调用次数未提供')
                : session.apiCallCount + ' ' + label('calls', '次调用')
            }}
          </span>
          <span>{{ session.childCount }} {{ label('child sessions', '个子会话') }}</span>
        </div>
        <div class="session-id" :title="session.rootSessionId">
          <span aria-hidden="true">ID</span>
          <CopyText
            :value="session.rootSessionId"
            :label="label('Copy session ID', '复制会话 ID')"
          />
        </div>
      </div>
    </CollapseRegion>
  </article>
</template>
<style scoped src="./floating-session.css"></style>
<style scoped>
.floating-generation {
  margin-top: 6px;
}
</style>
