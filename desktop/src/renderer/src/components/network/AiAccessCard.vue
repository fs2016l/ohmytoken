<script setup lang="ts">
import { computed } from 'vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import type {
  AiEndpointResult,
  AiNetworkService,
  AiProbeEvidence,
} from '../../../../shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import NetworkIpAddress from './NetworkIpAddress.vue'

const props = defineProps<{
  service: AiNetworkService
  results: Record<string, AiEndpointResult>
}>()
const {
  label,
  currentLang,
  stateText,
  accessText,
  reasonText,
  issueText,
  routeText,
  formatTime,
  countryText,
} = useNetworkLabels()
const entries = computed(() =>
  props.service.endpoints.map((endpoint) => ({ endpoint, result: props.results[endpoint.id] })),
)
function probeName(kind: AiProbeEvidence['kind']): string {
  const names: Record<AiProbeEvidence['kind'], [string, string]> = {
    entry: ['Service entry', '服务入口'],
    preflight: ['Anonymous configuration precheck', '匿名配置预检'],
    region_trace: ['Domain region observation', '域名地区观测'],
    page_region: ['Page region signal', '页面地区线索'],
  }
  return label(...names[kind])
}
function openPolicy(url: string): void {
  void window.api.openExternal(url).catch(() => undefined)
}
</script>

<template>
  <article class="network-ai-card">
    <header>
      <span class="network-provider-mark" aria-hidden="true">{{ service.mark }}</span>
      <div>
        <h3>{{ service.name }}</h3>
        <span class="network-muted">
          {{ label('Network & regional access', '网络与地区访问') }}
        </span>
      </div>
    </header>
    <div class="network-endpoints">
      <div v-for="{ endpoint, result } in entries" :key="endpoint.id" class="network-endpoint">
        <div class="network-endpoint-heading">
          <span>
            {{
              endpoint.kind === 'api'
                ? 'API'
                : endpoint.kind === 'studio'
                  ? 'AI Studio'
                  : label('Website', '网页')
            }}
          </span>
          <span
            class="network-status"
            :class="
              'is-' + (result?.state === 'done' ? result.status : (result?.state ?? 'pending'))
            "
          >
            {{ result?.state === 'done' ? accessText(result.status) : stateText(result?.state) }}
          </span>
        </div>
        <p v-if="result?.reason || result?.issue">
          {{ result.issue ? issueText(result.issue) : reasonText(result.reason) }}
        </p>
        <div v-if="result?.region" class="network-region">
          <span>{{ countryText(result.region.country) }} · {{ result.region.country }}</span>
          <strong :class="'is-' + result.region.status">
            {{
              result.region.status === 'supported'
                ? label('Region supported', '地区支持')
                : result.region.status === 'conditional'
                  ? label('Additional conditions', '附带支持条件')
                  : label('Not listed', '未列入支持范围')
            }}
          </strong>
        </div>
        <p v-if="result?.requiresAuth" class="network-account-note">
          {{
            endpoint.kind === 'api'
              ? label(
                  'API use requires a valid key; account and model permissions were not tested.',
                  '使用 API 仍需有效 Key，账号与模型权限未测试。',
                )
              : label(
                  'Sign-in is required to use this entry; account permissions were not tested.',
                  '使用此入口仍需登录，账号权限未测试。',
                )
          }}
        </p>
        <p v-if="result?.retryAt" class="network-account-note">
          {{ label('Retry this entry after', '该入口可重试时间') }} {{ formatTime(result.retryAt) }}
        </p>
        <details v-if="result?.checkedAt" class="network-evidence">
          <summary class="disclosure-summary">
            <DropdownChevron disclosure direction="right" />
            {{ label('View evidence', '查看检测依据') }}
            <span v-if="result.httpStatus">HTTP {{ result.httpStatus }}</span>
            <span>{{ result.evidence.length }} {{ label('observations', '项观测') }}</span>
          </summary>
          <dl>
            <div>
              <dt>{{ label('Entry', '检测入口') }}</dt>
              <dd>{{ endpoint.url }}</dd>
            </div>
            <div>
              <dt>{{ label('Destination', '响应地址') }}</dt>
              <dd>{{ result.destination || '—' }}</dd>
            </div>
            <div>
              <dt>{{ label('Proxy decision', '代理判定') }}</dt>
              <dd>{{ routeText(result.route) }}</dd>
            </div>
            <div>
              <dt>{{ label('Checked at', '检测时间') }}</dt>
              <dd>{{ formatTime(result.checkedAt) }}</dd>
            </div>
            <template v-if="result.region">
              <div>
                <dt>{{ label('Region evidence', '地区依据') }}</dt>
                <dd>
                  {{
                    result.region.source === 'edge'
                      ? label(
                          'Observed by this domain’s CDN; checked against official coverage.',
                          '目标域名 CDN 观测地区，对照官方支持范围。',
                        )
                      : label(
                          'Region in page initialization data; assessed against official coverage.',
                          '页面初始化数据中的地区线索，对照官方支持范围。',
                        )
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ label('Official coverage', '官方范围') }}</dt>
                <dd>
                  <button
                    type="button"
                    class="network-source-link"
                    @click="openPolicy(result.region.policyUrl)"
                  >
                    {{ label('View source', '查看来源') }} ↗
                  </button>
                  · {{ label('Reviewed', '复核于') }} {{ result.region.reviewedAt }}
                </dd>
              </div>
              <div v-if="result.region.status === 'conditional'">
                <dt>{{ label('Conditions', '适用条件') }}</dt>
                <dd>
                  {{
                    label(
                      'Official coverage includes account or subregion conditions. See the source for details.',
                      '官方范围包含账号或子地区条件，详情见来源说明。',
                    )
                  }}
                </dd>
              </div>
            </template>
          </dl>
          <ol class="network-probes">
            <li v-for="(item, index) in result.evidence" :key="item.kind + index">
              <strong>{{ probeName(item.kind) }}</strong>
              <span>
                {{
                  item.issue
                    ? issueText(item.issue)
                    : item.country
                      ? countryText(item.country)
                      : accessText(item.status)
                }}
                · HTTP {{ item.httpStatus ?? '—' }} · {{ item.elapsedMs }} ms ·
                {{ formatTime(item.checkedAt) }}
              </span>
              <code>{{ item.destination }}</code>
              <NetworkIpAddress v-if="item.observedIp" :ip="item.observedIp" />
            </li>
          </ol>
        </details>
      </div>
    </div>
    <p class="network-support-note">
      <strong>{{ label('Coverage', '支持说明') }}</strong>
      {{ currentLang === 'zh' ? service.descriptionZh : service.descriptionEn }}
    </p>
  </article>
</template>
