<script setup lang="ts">
import type { AiEndpointResult, AiNetworkService, AiProbeEvidence } from '@shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import NetworkConnectionStatus from './NetworkConnectionStatus.vue'
import NetworkIpAddress from './NetworkIpAddress.vue'
import { ref } from 'vue'
defineProps<{
  service: AiNetworkService
  results: Record<string, AiEndpointResult>
  evidence: boolean
}>()
const { label, reasonText, issueText, routeText, countryText, formatTime, accessText } =
  useNetworkLabels()
const openError = ref(false)
function probeName(kind: AiProbeEvidence['kind']): string {
  const names = {
    entry: ['Service entry', '服务入口'],
    preflight: ['Anonymous precheck', '匿名配置预检'],
    region_trace: ['Domain region observation', '域名地区观测'],
    page_region: ['Page region signal', '页面地区线索'],
  } as const
  return label(names[kind][0], names[kind][1])
}
async function openSource(url: string): Promise<void> {
  openError.value = false
  try {
    await window.api.openExternal(url)
  } catch {
    openError.value = true
  }
}
</script>
<template>
  <div class="network-endpoint-details">
    <section v-for="endpoint in service.endpoints" :key="endpoint.id" class="network-entry-detail">
      <header>
        <h3>
          {{
            endpoint.kind === 'api'
              ? 'API'
              : endpoint.kind === 'studio'
                ? 'AI Studio'
                : label('Web', '网页')
          }}
        </h3>
        <NetworkConnectionStatus :result="results[endpoint.id]" />
      </header>
      <p class="network-entry-url">{{ endpoint.url }}</p>
      <template v-if="!evidence">
        <p class="network-entry-response">
          <span v-if="results[endpoint.id]?.httpStatus">
            HTTP {{ results[endpoint.id].httpStatus }} ·
          </span>
          {{
            results[endpoint.id]?.issue
              ? issueText(results[endpoint.id].issue)
              : reasonText(results[endpoint.id]?.reason) ||
                label('Start a check to see the response.', '开始检测后显示响应。')
          }}
        </p>
        <p v-if="results[endpoint.id]?.region" class="network-entry-region">
          {{ countryText(results[endpoint.id].region!.country) }} ·
          {{
            results[endpoint.id].region!.status === 'supported'
              ? label('Listed region', '地区在支持范围')
              : results[endpoint.id].region!.status === 'conditional'
                ? label('Additional conditions apply', '附带支持条件')
                : label('Outside listed regions', '未在公开支持范围')
          }}
        </p>
        <p v-if="results[endpoint.id]?.requiresAuth" class="network-entry-auth">
          {{
            endpoint.kind === 'api'
              ? label(
                  'A valid API key is still required. Account and model permissions were not tested.',
                  '使用仍需有效 API Key，账号与模型权限未验证。',
                )
              : label(
                  'Sign-in is still required. Account permissions were not tested.',
                  '使用此入口仍需登录，账号权限未验证。',
                )
          }}
        </p>
        <p v-if="results[endpoint.id]?.retryAt" class="network-entry-response">
          {{ label('Retry after', '可重试于') }} {{ formatTime(results[endpoint.id].retryAt) }}
        </p>
      </template>
      <template v-else>
        <dl class="network-evidence-fields">
          <div>
            <dt>{{ label('Destination', '响应地址') }}</dt>
            <dd>{{ results[endpoint.id]?.destination || '—' }}</dd>
          </div>
          <div>
            <dt>{{ label('Proxy path', '代理路径') }}</dt>
            <dd>{{ routeText(results[endpoint.id]?.route) }}</dd>
          </div>
          <div>
            <dt>{{ label('Checked at', '检测时间') }}</dt>
            <dd>{{ formatTime(results[endpoint.id]?.checkedAt) }}</dd>
          </div>
          <div>
            <dt>{{ label('Elapsed', '耗时') }}</dt>
            <dd>{{ results[endpoint.id]?.elapsedMs ?? '—' }} ms</dd>
          </div>
          <div v-if="results[endpoint.id]?.region">
            <dt>{{ label('Region evidence', '地区依据') }}</dt>
            <dd>
              {{
                results[endpoint.id].region!.source === 'edge'
                  ? label('Target domain CDN observation', '目标域名 CDN 观测地区')
                  : label('Page initialization data', '页面初始化地区线索')
              }}
            </dd>
          </div>
          <div v-if="results[endpoint.id]?.region">
            <dt>{{ label('Official coverage', '官方范围') }}</dt>
            <dd>
              <button
                type="button"
                class="workspace-link"
                @click="openSource(results[endpoint.id].region!.policyUrl)"
              >
                {{ label('View source', '查看来源') }} ↗
              </button>
              <br />
              {{ label('Reviewed', '复核于') }} {{ results[endpoint.id].region!.reviewedAt }}
            </dd>
          </div>
        </dl>
        <ol class="network-evidence-list">
          <li v-for="(item, index) in results[endpoint.id]?.evidence" :key="item.kind + index">
            <strong>{{ probeName(item.kind) }}</strong>
            <span>
              {{
                item.issue
                  ? issueText(item.issue)
                  : item.country
                    ? countryText(item.country)
                    : accessText(item.status)
              }}
            </span>
            <small>
              HTTP {{ item.httpStatus ?? '—' }} · {{ item.elapsedMs }} ms ·
              {{ formatTime(item.checkedAt) }}
            </small>
            <code>{{ item.destination }}</code>
            <NetworkIpAddress v-if="item.observedIp" :ip="item.observedIp" />
          </li>
        </ol>
      </template>
    </section>
    <p v-if="openError" class="workspace-error" role="alert">
      {{ label('Could not open the browser. Retry the link.', '未能打开浏览器，请重试链接。') }}
    </p>
  </div>
</template>
<style scoped>
.network-entry-detail {
  padding: 20px 0;
  border-bottom: 1px solid var(--border);
}
.network-entry-detail header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
h3 {
  font-size: 14px;
  line-height: 22px;
  font-weight: 500;
  margin: 0;
}
p {
  font-size: 12px;
  line-height: 20px;
  margin: 8px 0 0;
}
.network-entry-url {
  color: var(--text-soft);
  overflow-wrap: anywhere;
}
.network-entry-auth {
  padding: 10px;
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-muted);
}
.network-entry-region,
.network-entry-response {
  color: var(--text-muted);
}
.network-evidence-fields {
  margin: 12px 0;
  font-size: 12px;
  line-height: 20px;
}
.network-evidence-fields > div {
  display: grid;
  grid-template-columns: 85px minmax(0, 1fr);
  gap: 12px;
  padding: 5px 0;
}
dt {
  color: var(--text-soft);
}
dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.network-evidence-list {
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.network-evidence-list li {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-radius: 6px;
  background: var(--surface);
  font-size: 12px;
  line-height: 20px;
}
.network-evidence-list small {
  color: var(--text-soft);
}
.network-evidence-list code {
  white-space: normal;
  overflow-wrap: anywhere;
  font-size: 11px;
}
.network-evidence-list :deep(.network-ip) {
  font-size: 12px;
}
</style>
