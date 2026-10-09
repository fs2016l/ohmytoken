<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import type { UsageAnalytics } from '@shared/analytics'
import PageSurface from '../components/base/PageSurface.vue'
import AnimatedNumber from '../components/base/AnimatedNumber.vue'
import IdentityMotion from '../components/base/IdentityMotion.vue'
import SessionListPanel from '../components/agent/SessionListPanel.vue'
import { useI18n } from '../i18n/useI18n'
import { useAnalyticsContext } from '../composables/useAnalyticsContext'
import { usePageResource } from '../composables/usePageResource'
import { useScanStatus } from '../composables/useScanStatus'
import { getAgentName } from '../config/agents'
const { label } = useI18n(),
  model = String(useRoute().params.id),
  pageKey = `model:${model}`
const { state, filter, back } = useAnalyticsContext(pageKey),
  scan = useScanStatus()
const scope = computed(() => ({ ...filter.value, model }))
const resource = usePageResource(
  () => [scope.value, scan.revision.value],
  async () => {
    const [modelData, total] = await Promise.all([
      window.api.getUsageAnalytics(scope.value),
      window.api.getUsageAnalytics(filter.value),
    ])
    return { modelData, total: total.summary.totalTokens }
  },
  { modelData: null as UsageAnalytics | null, total: 0 },
)
const data = computed(() => resource.data.value.modelData)
const columns = computed(() => [
  { key: 'inputTokens' as const, name: label('Input', '输入') },
  { key: 'outputTokens' as const, name: label('Output', '输出') },
  { key: 'cache' as const, name: label('Cache', '缓存') },
  { key: 'reasoningTokens' as const, name: label('Reasoning', '推理') },
  { key: 'totalTokens' as const, name: label('Total tokens', '总词元数') },
])
</script>
<template>
  <PageSurface :page-key="pageKey" fixed class="model-detail-page">
    <IdentityMotion :identity="model">
      <div class="detail-heading">
        <button type="button" class="workspace-button" @click="back">
          ← {{ label('Back', '返回') }}
        </button>
        <h1>{{ model }}</h1>
        <span>
          {{ state.range.from || label('All dates', '全部日期') }}
          <template v-if="state.range.to">— {{ state.range.to }}</template>
        </span>
      </div>
    </IdentityMotion>
    <p v-if="resource.error.value" class="workspace-error" role="alert">
      {{ resource.error.value }}
      <button type="button" class="workspace-link" @click="resource.refresh()">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <section class="workspace-panel model-overview" :aria-busy="resource.busy.value">
      <div>
        <span>{{ label('Total tokens', '总词元数') }}</span>
        <strong>
          <AnimatedNumber :value="data?.summary.totalTokens" :format="{ compact: true }" />
        </strong>
      </div>
      <div>
        <span>{{ label('Share of selected period', '占区间总量') }}</span>
        <strong>
          <AnimatedNumber
            :value="
              data
                ? resource.data.value.total
                  ? (data.summary.totalTokens / resource.data.value.total) * 100
                  : 0
                : null
            "
            :format="{ percent: true }"
          />
        </strong>
      </div>
      <div>
        <span>Agent</span>
        <strong class="model-agent-names">
          {{ data?.agents.map((agent) => getAgentName(agent.id)).join(' · ') || '—' }}
        </strong>
      </div>
    </section>
    <section class="workspace-panel model-composition">
      <h2>{{ label('Token composition', 'Token 组成') }}</h2>
      <div class="model-token-scroll">
        <table class="workspace-table">
          <thead>
            <tr>
              <th>{{ label('Model', '模型') }}</th>
              <th
                v-for="column in columns"
                :key="column.key"
                :class="{ cache: column.key === 'cache' }"
              >
                {{ column.name }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{{ model }}</td>
              <td
                v-for="column in columns"
                :key="column.key"
                :class="{ cache: column.key === 'cache' }"
              >
                <AnimatedNumber
                  :value="
                    data
                      ? column.key === 'cache'
                        ? data.summary.cacheReadTokens + data.summary.cacheWriteTokens
                        : data.summary[column.key]
                      : null
                  "
                  :format="{ compact: true }"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <SessionListPanel :filter="scope" :page-key="pageKey" />
  </PageSurface>
</template>
<style scoped>
.detail-heading {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  margin-bottom: 24px;
}
.detail-heading h1 {
  font-size: 28px;
  font-weight: 500;
  margin: 0;
  overflow-wrap: anywhere;
}
.detail-heading > span {
  font-size: 12px;
  color: var(--text-soft);
}
.model-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  border-color: var(--border);
  padding: 24px;
  margin-bottom: 24px;
  min-height: 112px;
  flex-shrink: 0;
}
.model-overview > div > span {
  font-size: 12px;
  color: var(--text-soft);
}
.model-overview strong {
  display: block;
  margin-top: 8px;
  font-size: 30px;
  font-weight: 600;
}
.model-agent-names {
  font-size: 24px !important;
  overflow-wrap: anywhere;
}
.model-composition {
  border-color: var(--border);
  margin-bottom: 24px;
  min-height: 208px;
  flex-shrink: 0;
}
.model-composition h2 {
  margin-bottom: 16px;
}
.model-token-scroll {
  overflow-x: auto;
}
.model-composition table {
  min-width: 720px;
  table-layout: fixed;
}
.model-composition th:first-child,
.model-composition td:first-child {
  width: 40%;
  text-align: left;
  overflow-wrap: anywhere;
}
.model-composition th,
.model-composition td {
  text-align: center;
  background: transparent;
  border: 0;
}
.model-composition .cache {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
  border-radius: 6px;
}
.model-detail-page :deep(.recent-session-panel) {
  flex: 1;
  min-height: 0;
  max-height: none;
}
</style>
