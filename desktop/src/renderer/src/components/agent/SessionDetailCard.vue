<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { TokenUsageSession, TokenUsageUserSession } from '@shared/models'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import AnimatedCost from '../base/AnimatedCost.vue'
import TokenBreakdown from '../base/TokenBreakdown.vue'
import RollingText from '../base/RollingText.vue'
import UsageIdentity from './UsageIdentity.vue'
import GenerationMetrics from './GenerationMetrics.vue'
import { useI18n } from '../../i18n/useI18n'
import { sessionIdentity } from '../../utils/usage-identity'
import { displayTimestamp } from '../../utils/date-range'
import { sessionChildren } from '../../utils/session-display'
import { motion } from '../../config/motion'
const props = defineProps<{
  session: TokenUsageSession | null
  projectName?: string
  sources?: TokenUsageSession[]
}>()
const { label } = useI18n()
const projectLabel = computed(
  () =>
    props.projectName ||
    props.session?.projectPath?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ||
    label('Unassigned project', '未归属项目'),
)
const copied = ref(false)
const copyError = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined
const children = computed(() =>
  props.session && 'children' in props.session
    ? sessionChildren((props.session as TokenUsageUserSession).children).length
    : 0,
)
const identity = computed(() =>
  props.session ? sessionIdentity(props.session, props.sources) : null,
)
const title = computed(() =>
  props.session?.parentSessionId
    ? props.session.subAgentName || label('Child session', '子会话')
    : props.session?.title?.split(/\r?\n/, 1)[0].trim() || label('Untitled session', '未命名会话'),
)
async function copy(): Promise<void> {
  if (!props.session) return
  const id = props.session.sessionId
  try {
    await navigator.clipboard.writeText(id)
    if (props.session?.sessionId !== id) return
    copied.value = true
    copyError.value = false
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, motion.copyFeedback)
  } catch {
    copyError.value = true
  }
}
watch(
  () => [props.session?.agent, props.session?.sessionId],
  () => {
    copied.value = false
    copyError.value = false
    clearTimeout(copyTimer)
  },
)
onBeforeUnmount(() => clearTimeout(copyTimer))
</script>
<template>
  <section
    v-if="session"
    class="session-detail workspace-panel usage-detail-card"
    :aria-label="label('Session details', '会话详情')"
  >
    <div>
      <h2 :title="title"><RollingText :text="title" /></h2>
      <p class="detail-context">
        <span :title="projectLabel"><RollingText :text="projectLabel" /></span>
      </p>
    </div>
    <span class="detail-caption">{{ label('Tokens in range', '本次用量') }}</span>
    <AnimatedNumber class="detail-hero" :value="session.totalTokens" :format="{ compact: true }" />
    <div class="detail-cost">
      <span>{{ label('Est. cost', '预估花费') }}</span>
      <strong><AnimatedCost :summary="session.costSummary" :note="false" /></strong>
    </div>
    <div class="detail-metrics">
      <div>
        <span>{{ label('API calls', 'API 调用') }}</span>
        <strong
          :title="
            session.apiCallCountComplete === false
              ? label('Known calls; source is incomplete', '已知调用数，来源记录不完整')
              : ''
          "
        >
          <AnimatedNumber
            :prefix="session.apiCallCountComplete === false ? '≥' : ''"
            :value="session.apiCallCount"
            :format="{ compact: true }"
          />
        </strong>
      </div>
      <div>
        <span>{{ label('Turns', '对话次数') }}</span>
        <strong
          :title="
            !session.turns?.complete
              ? label('The source cannot provide a complete turn count', '来源无法提供完整对话次数')
              : ''
          "
        >
          <AnimatedNumber
            :prefix="session.turns && !session.turns.complete && session.turns.count ? '≥' : ''"
            :value="session.turns?.complete || session.turns?.count ? session.turns.count : null"
            :format="{ compact: true }"
          />
        </strong>
      </div>
      <div>
        <span>{{ label('Child sessions', '子会话') }}</span>
        <strong>
          <AnimatedNumber
            :value="session.parentSessionId ? null : children"
            :format="{ compact: true }"
          />
        </strong>
      </div>
    </div>
    <div class="detail-generation">
      <h3>
        {{
          session.latestTurnFirstToken || session.agent === 'codex'
            ? label('Latest generation metrics', '最近生成指标')
            : session.latestGeneration?.speedKind === 'response-estimate'
              ? label('Latest response · average estimate', '最近响应 · 均速估算')
              : label('Latest completed call', '最近已完成调用')
        }}
      </h3>
      <GenerationMetrics
        :sample="session.latestGeneration"
        :turn-first-token="session.latestTurnFirstToken"
        :agent="session.agent"
        detail
      />
    </div>
    <div v-if="identity" class="detail-participation">
      <h3>{{ label('Agent / model', 'Agent / 模型') }}</h3>
      <UsageIdentity v-bind="identity" labelled />
    </div>
    <h3>{{ label('Token breakdown', 'Token 构成') }}</h3>
    <TokenBreakdown :usage="session" />
    <dl class="detail-meta">
      <div>
        <dt>{{ label('Started', '开始') }}</dt>
        <dd>{{ displayTimestamp(session.startedAt) }}</dd>
      </div>
      <div>
        <dt>{{ label('Ended', '结束') }}</dt>
        <dd>{{ displayTimestamp(session.endedAt) }}</dd>
      </div>
      <div>
        <dt>{{ label('Session ID', '会话 ID') }}</dt>
        <dd class="detail-id">
          <span :title="session.sessionId">{{ session.sessionId }}</span>
          <button
            type="button"
            class="copy-id"
            :class="{ 'copy-id--copied': copied }"
            :aria-label="label('Copy session ID', '复制会话 ID')"
            :title="copied ? label('Copied', '已复制') : label('Copy session ID', '复制会话 ID')"
            @click="copy"
          >
            <span class="material-symbols-outlined" aria-hidden="true">
              {{ copied ? 'check' : 'content_copy' }}
            </span>
          </button>
        </dd>
      </div>
    </dl>
    <span class="copy-feedback" role="status" :class="{ 'copy-error': copyError }">
      {{
        copyError
          ? label('Copy failed. Try again.', '复制失败，请重试')
          : copied
            ? label('Session ID copied', '已复制会话 ID')
            : '\u00a0'
      }}
    </span>
  </section>
  <section v-else class="workspace-panel workspace-empty session-detail-empty">
    {{ label('Select a session to view its details', '选择会话查看详情') }}
  </section>
</template>
<style src="./workspace-detail.css" />
<style scoped>
.session-detail-empty {
  min-height: 240px;
  font-size: 13px;
}
</style>
