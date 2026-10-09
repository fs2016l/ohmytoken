<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue'
import {
  AI_NETWORK_SERVICES,
  DNS_PROBE_COUNT,
  type NetworkCheckSnapshot,
  type NetworkCheckTarget,
} from '@shared/network-check'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import SegmentedControl from '../base/SegmentedControl.vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import DesignIcon from '../base/DesignIcon.vue'
import NetworkServiceBrand from './NetworkServiceBrand.vue'
import NetworkRefreshButton from './NetworkRefreshButton.vue'
import NetworkEndpointDetails from './NetworkEndpointDetails.vue'
import NetworkIpComparison from './NetworkIpComparison.vue'
import NetworkIpAddress from './NetworkIpAddress.vue'
import NetworkDnsAssessment from './NetworkDnsAssessment.vue'
import IpQualityPanel from './IpQualityPanel.vue'
import { useNetworkReport } from '../../composables/useNetworkReport'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import { usePageState } from '../../composables/usePageState'
import { isNetworkPassed, maskedIp, networkSourceName } from '../../utils/network-display'
const props = defineProps<{
  target: string
  snapshot: NetworkCheckSnapshot | null
  busy: boolean
}>()
const emit = defineEmits<{ close: []; refresh: [target: NetworkCheckTarget] }>()
const { label, currentLang, formatTime, routeText, issueText, stateText, riskText, countryText } =
  useNetworkLabels()
const { location, risk, type, typeSources, sources } = useNetworkReport(toRef(props, 'snapshot'))
const state = usePageState('network-details', { tabs: {} as Record<string, string> })
const service = computed(() => AI_NETWORK_SERVICES.find((item) => item.id === props.target))
const title = computed(
  () =>
    service.value?.name ??
    (props.target === 'ip'
      ? label('IP source comparison', 'IP 来源对照')
      : label('DNS exit', 'DNS 出口')),
)
const opened = computed(() => Boolean(service.value || ['ip', 'dns'].includes(props.target)))
const tab = computed({
  get: () => state.tabs[props.target] ?? 'results',
  set: (value: string | number) => {
    state.tabs[props.target] = String(value)
  },
})
const tabs = computed(() => [
  {
    value: 'results',
    label:
      props.target === 'ip'
        ? label('Compare sources', '来源对照')
        : label('Access results', '访问结果'),
  },
  { value: 'evidence', label: label('Evidence', '检测依据') },
])
const results = computed(() =>
  Object.fromEntries((props.snapshot?.endpoints ?? []).map((row) => [row.id, row])),
)
const entries = computed(
  () => service.value?.endpoints.map((item) => results.value[item.id]).filter(Boolean) ?? [],
)
const passed = computed(() => entries.value.filter(isNetworkPassed).length)
const lastChecked = computed(
  () => Math.max(0, ...entries.value.map((item) => item.checkedAt ?? 0)) || null,
)
const checking = computed(
  () =>
    props.snapshot?.status === 'running' &&
    (props.snapshot.target === props.target ||
      !props.snapshot.target ||
      props.snapshot.target === 'all'),
)
const dnsLocations = computed(
  () =>
    new Map(props.snapshot?.dns.geolocation?.locations.map((location) => [location.ip, location])),
)
const dnsRevealed = ref(false),
  externalError = ref(false)
watch([() => props.target, () => props.snapshot?.runId], () => {
  dnsRevealed.value = false
  externalError.value = false
})
async function open(url: string): Promise<void> {
  externalError.value = false
  try {
    await window.api.openExternal(url)
  } catch {
    externalError.value = true
  }
}
</script>
<template>
  <WorkspaceDialog
    :open="opened"
    :title="title"
    :drawer="Boolean(service)"
    class="network-detail-dialog"
    :class="{
      'network-detail-dialog--service': service,
      'network-detail-dialog--ip': target === 'ip',
    }"
    :style="{ '--dialog-width': service ? '416px' : target === 'ip' ? '1180px' : '820px' }"
    @close="emit('close')"
  >
    <template #heading>
      <div class="network-dialog-heading">
        <NetworkServiceBrand v-if="service" :service="service.id" :size="40" />
        <DesignIcon v-else-if="target === 'dns'" name="networkDns" :size="32" />
        <div>
          <h2>{{ title }}</h2>
          <p>
            {{
              service
                ? label('Network access details', '网络访问详情')
                : target === 'dns'
                  ? label('This network observation', '本次网络解析结果')
                  : location
            }}
          </p>
        </div>
      </div>
    </template>
    <template #actions>
      <NetworkRefreshButton
        :label="label('Retest', '重新检测')"
        :running="checking"
        :disabled="busy"
        :text="!service"
        @click="emit('refresh', target as NetworkCheckTarget)"
      />
    </template>
    <template v-if="service">
      <div class="network-service-summary">
        <h3>
          {{
            checking
              ? label('Checking service entries…', '正在检测服务入口…')
              : passed === service.endpoints.length
                ? label(
                    `${passed} entries passed the network check`,
                    `${passed} 个入口通过网络检测`,
                  )
                : label(
                    `${passed} / ${service.endpoints.length} entries passed`,
                    `${passed} / ${service.endpoints.length} 个入口通过预检`,
                  )
          }}
        </h3>
        <p>
          {{
            label(
              'Current observations; sign-in and model access remain separate.',
              '当前观测结果，登录和模型调用权限另行验证。',
            )
          }}
        </p>
      </div>
      <dl class="network-detail-metrics">
        <div>
          <dt>{{ label('Entries', '检测入口') }}</dt>
          <dd><AnimatedNumber :value="service.endpoints.length" :format="{ decimals: 0 }" /></dd>
        </div>
        <div>
          <dt>{{ label('Proxy path', '连接方式') }}</dt>
          <dd class="network-detail-route">
            {{
              new Set(entries.map((item) => item.route)).size > 1
                ? label('See each entry', '按入口查看')
                : routeText(entries[0]?.route)
            }}
          </dd>
        </div>
        <div>
          <dt>{{ label('Last checked', '最近检测') }}</dt>
          <dd>{{ formatTime(lastChecked) }}</dd>
        </div>
      </dl>
      <SegmentedControl
        v-model="tab"
        :options="tabs"
        :label="label('Service detail view', '服务详情视图')"
        appearance="light"
      />
      <NetworkEndpointDetails
        :service="service"
        :results="results"
        :evidence="tab === 'evidence'"
      />
      <p class="network-report-note">
        {{ currentLang === 'zh' ? service.descriptionZh : service.descriptionEn }}
      </p>
      <button
        v-if="tab !== 'evidence'"
        type="button"
        class="workspace-link network-evidence-toggle"
        @click="tab = 'evidence'"
      >
        {{ label('View evidence', '查看检测依据') }}
        <span>
          {{ entries.reduce((sum, item) => sum + item.evidence.length, 0) }}
          {{ label('observations', '条记录') }}
        </span>
      </button>
    </template>
    <template v-else-if="target === 'ip'">
      <NetworkIpAddress :ip="snapshot?.exit.ip" />
      <div class="network-ip-conclusions">
        <div>
          <span>{{ label('IP type', 'IP 类型') }}</span>
          <strong>{{ type }}</strong>
          <small>{{ typeSources }}</small>
        </div>
        <div>
          <span>{{ label('Risk score', '风险评分') }}</span>
          <strong>
            <AnimatedNumber :value="risk.primary?.riskScore" :format="{ decimals: 1 }" />
            <em>/ 100</em>
          </strong>
          <small>
            {{ networkSourceName(risk.primary?.id) }} · {{ riskText(risk.primary?.riskScore) }}
          </small>
        </div>
        <div>
          <span>{{ label('Other source', '另一来源') }}</span>
          <strong>
            <AnimatedNumber :value="risk.other?.riskScore" :format="{ decimals: 1 }" />
            <em>/ 100</em>
          </strong>
          <small>
            {{ networkSourceName(risk.other?.id) }} · {{ riskText(risk.other?.riskScore) }}
          </small>
        </div>
      </div>
      <SegmentedControl
        v-model="tab"
        :options="tabs"
        :label="label('IP detail view', 'IP 详情视图')"
        appearance="light"
      />
      <NetworkIpComparison v-if="tab !== 'evidence'" :sources="sources" />
      <IpQualityPanel
        v-else
        :sources="sources"
        :registration="snapshot?.registration"
        :has-run="Boolean(snapshot?.runId)"
      />
      <div class="network-manual-review">
        <span>{{ label('Manual cross-check', '手动复核') }}</span>
        <button
          type="button"
          class="workspace-link"
          :disabled="!snapshot?.exit.ip"
          @click="open(`https://scamalytics.com/ip/${encodeURIComponent(snapshot?.exit.ip ?? '')}`)"
        >
          Scamalytics ↗
        </button>
        <button type="button" class="workspace-link" @click="open('https://ping.pe/')">
          Ping.pe ↗
        </button>
      </div>
    </template>
    <template v-else-if="target === 'dns'">
      <NetworkDnsAssessment
        :dns="snapshot?.dns"
        :checking="checking && snapshot?.target === 'dns'"
      />
      <div class="network-dns-detail-summary">
        <span>
          <AnimatedNumber
            :value="snapshot?.dns.observedAt != null ? snapshot.dns.resolvers.length : null"
            :format="{ decimals: 1 }"
          />
          {{ label('resolvers', '个解析器') }}
        </span>
        <div>
          {{ snapshot?.dns.completedProbes ?? 0 }} / {{ DNS_PROBE_COUNT }}
          {{ label('probes complete', '轮检测完成') }}
          <small>
            {{ label('Observation', '解析观测') }} IPLeak ·
            {{ label('Location', '地区信息') }} IPQuery
          </small>
        </div>
      </div>
      <p class="network-report-note">
        <DesignIcon name="networkInfo" :size="16" />
        {{
          label(
            'Repeated observations of the same resolver are counted together.',
            '同一解析器在多轮检测中出现时，会累计命中次数。',
          )
        }}
      </p>
      <p v-if="snapshot?.dns.issue" class="workspace-error">
        {{ issueText(snapshot.dns.issue) }}
        <span v-if="snapshot.dns.retryAt">
          · {{ label('Retry after', '可重试于') }} {{ formatTime(snapshot.dns.retryAt) }}
        </span>
      </p>
      <table class="network-dns-table">
        <thead>
          <tr>
            <th>{{ label('No.', '序号') }}</th>
            <th>
              <span>{{ label('Resolver IP', '解析器 IP') }}</span>
              <button
                type="button"
                class="workspace-link"
                :aria-pressed="dnsRevealed"
                @click="dnsRevealed = !dnsRevealed"
              >
                <DesignIcon name="networkEye" :size="16" />
                {{ dnsRevealed ? label('Hide IP', '隐藏 IP') : label('Show IP', '显示 IP') }}
              </button>
            </th>
            <th>{{ label('Country / region', '国家 / 地区') }}</th>
            <th>{{ label('Provider / ASN', '运营商 / ASN') }}</th>
            <th>{{ label('Hits', '命中次数') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(resolver, index) in snapshot?.dns.resolvers" :key="resolver.ip">
            <td>{{ String(index + 1).padStart(2, '0') }}</td>
            <td class="network-resolver-ip">
              {{ dnsRevealed ? resolver.ip : maskedIp(resolver.ip) }}
            </td>
            <td>
              {{
                dnsLocations.get(resolver.ip)?.countryCode
                  ? countryText(dnsLocations.get(resolver.ip)!.countryCode!)
                  : label('Unknown', '未知')
              }}
            </td>
            <td class="network-resolver-provider">
              {{ dnsLocations.get(resolver.ip)?.organization ?? '—' }}
              <small>{{ dnsLocations.get(resolver.ip)?.asn }}</small>
            </td>
            <td>{{ resolver.hits }} {{ label('hits', '次') }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="!snapshot?.dns.resolvers.length" class="network-empty">
        {{ stateText(snapshot?.dns.state) }} ·
        {{ label('No resolvers observed yet.', '暂无解析器数据。') }}
      </p>
      <div class="network-dns-detail-footer">
        <p>
          {{
            label(
              'A DNS leak means queries bypass the intended VPN or proxy path. Neither resolver count nor matching countries proves this. Public DNS may resolve across regions and IP locations may be inaccurate. Check whether the provider is expected; your browser may use a different path.',
              'DNS 泄漏指解析请求绕过预期的 VPN 或代理路径。解析器数量、国家一致都不能证明是否泄漏；公共 DNS 可能跨地区解析，IP 定位也可能有偏差。请核对运营商是否符合预期，并在浏览器中复核其网络路径。',
            )
          }}
        </p>
        <div>
          <span>
            {{ label('Last checked', '最近检测') }} {{ formatTime(snapshot?.dns.observedAt) }} ·
            {{ routeText(snapshot?.dns.route) }}
          </span>
          <button type="button" class="workspace-link" @click="open('https://ipleak.net/#dnsleak')">
            {{ label('Browser cross-check', '浏览器泄漏复核') }} ↗
          </button>
        </div>
      </div>
    </template>
    <p v-if="externalError" class="workspace-error" role="alert">
      {{ label('Could not open the browser. Please retry.', '未能打开浏览器，请重试。') }}
    </p>
  </WorkspaceDialog>
</template>
<style src="../../styles/network-details.css"></style>
