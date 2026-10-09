<script setup lang="ts">
import { computed } from 'vue'
import {
  AI_NETWORK_SERVICES,
  DNS_PROBE_COUNT,
  IP_QUALITY_SOURCES,
  type NetworkMode,
  type NetworkCheckTarget,
} from '@shared/network-check'
import PageSurface from '../components/base/PageSurface.vue'
import UpdatedAt from '../components/base/UpdatedAt.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import SelectControl from '../components/base/SelectControl.vue'
import AnimatedNumber from '../components/base/AnimatedNumber.vue'
import RollingText from '../components/base/RollingText.vue'
import IdentityMotion from '../components/base/IdentityMotion.vue'
import DesignIcon from '../components/base/DesignIcon.vue'
import NetworkServiceCard from '../components/network/NetworkServiceCard.vue'
import NetworkIpAddress from '../components/network/NetworkIpAddress.vue'
import NetworkRiskGauge from '../components/network/NetworkRiskGauge.vue'
import NetworkDetails from '../components/network/NetworkDetails.vue'
import NetworkDnsAssessment from '../components/network/NetworkDnsAssessment.vue'
import NetworkCheckControl from '../components/network/NetworkCheckControl.vue'
import { useNetworkCheck } from '../composables/useNetworkCheck'
import { useNetworkReport } from '../composables/useNetworkReport'
import { useNetworkLabels } from '../composables/useNetworkLabels'
import { usePageState } from '../composables/usePageState'
import { networkNeedsAttention, networkSourceName, maskedIp } from '../utils/network-display'
import globe from '../assets/design/network-globe.png'
import '../styles/network-check.css'
import '../styles/network-report.css'
const { snapshot, updatedAt, initializing, requesting, running, error, now, start, cancel } =
  useNetworkCheck()
const { label, stateText, issueText, riskText } = useNetworkLabels()
const { location, risk, type, typeSources } = useNetworkReport(snapshot)
const state = usePageState('network-check', { mode: 'system', filter: 'all', detail: '' })
if (!['system', 'direct'].includes(state.mode)) state.mode = 'system'
const hasRun = computed(() => Boolean(snapshot.value?.runId))
const busy = computed(() => initializing.value || requesting.value || running.value)
const results = computed(() =>
  Object.fromEntries((snapshot.value?.endpoints ?? []).map((result) => [result.id, result])),
)
const attention = computed(
  () =>
    AI_NETWORK_SERVICES.flatMap((service) => service.endpoints).filter((endpoint) =>
      networkNeedsAttention(results.value[endpoint.id]),
    ).length,
)
const visible = computed(() =>
  AI_NETWORK_SERVICES.filter(
    (service) =>
      state.filter !== 'attention' ||
      service.endpoints.some((endpoint) => networkNeedsAttention(results.value[endpoint.id])),
  ),
)
const elapsed = computed(() =>
  !snapshot.value?.startedAt
    ? 0
    : Math.max(
        0,
        Math.round(((snapshot.value.finishedAt ?? now.value) - snapshot.value.startedAt) / 1000),
      ),
)
const endpointCount = AI_NETWORK_SERVICES.reduce(
  (sum, service) => sum + service.endpoints.length,
  0,
)
const filters = computed(() => [
  { value: 'all', label: label('All', '全部') },
  { value: 'attention', label: label('Needs attention', '需关注') },
])
function run(target: NetworkCheckTarget = 'all'): void {
  void start(state.mode as NetworkMode, target)
}
function targetRunning(target: NetworkCheckTarget): boolean {
  return (
    running.value &&
    (snapshot.value?.target === target ||
      !snapshot.value?.target ||
      snapshot.value.target === 'all')
  )
}
const connectionNotice = computed(() =>
  state.mode === 'direct'
    ? label('System VPN/TUN routing may still apply.', '系统 VPN / TUN 路由仍可能生效。')
    : label(
        'Checks contact the named services directly from this device.',
        '本机直接请求所标注服务，不经过我们的服务器。',
      ),
)
const pageError = computed(() =>
  error.value
    ? label('Could not start the check. Please retry.', '未能开始体检，请重试。')
    : snapshot.value?.issue && snapshot.value.issue !== 'cancelled'
      ? issueText(snapshot.value.issue)
      : '',
)
</script>
<template>
  <PageSurface page-key="network-check" class="network-report">
    <header class="network-report-heading">
      <div>
        <h1>{{ label('Network check', '网络体检') }}</h1>
        <p class="network-report-meta">
          <span>
            {{ label('Understand access conditions on this network', '了解当前网络的访问条件') }}
          </span>
          <UpdatedAt :timestamp="updatedAt" />
        </p>
      </div>
      <div class="network-report-actions">
        <SelectControl
          v-model="state.mode"
          :disabled="busy"
          :label="label('Connection mode', '检测连接')"
          :min-menu-width="160"
          :options="[
            { value: 'system', label: label('System proxy', '系统代理') },
            { value: 'direct', label: label('No app proxy', '应用层直连') },
          ]"
        />
        <NetworkCheckControl
          :snapshot="snapshot"
          :busy="busy"
          :error="pageError"
          :elapsed="elapsed"
          @start="run()"
          @cancel="cancel"
        />
      </div>
    </header>
    <p v-if="pageError" class="workspace-error" role="alert">{{ pageError }}</p>
    <div class="network-report-grid">
      <div class="network-report-main">
        <section
          class="network-report-hero network-report-panel"
          :aria-label="label('Check overview', '体检概览')"
        >
          <div class="network-hero-copy">
            <p class="network-hero-eyebrow">
              NETWORK CHECK
              <span>/</span>
              {{
                running
                  ? label('Checking', '检测中')
                  : hasRun
                    ? label('Results', '检测结果')
                    : label('Ready', '准备就绪')
              }}
            </p>
            <h2>
              <RollingText
                wrap
                :text="
                  running
                    ? label('Checking your network', '正在进行体检')
                    : snapshot?.status === 'cancelled'
                      ? label('Check stopped', '体检已停止')
                      : hasRun
                        ? label('Check complete', '体检已完成')
                        : label('Check your network', '开始网络体检')
                "
              />
            </h2>
            <p class="network-hero-outcome" :class="{ attention: attention > 0 }">
              <RollingText
                wrap
                :text="
                  !hasRun
                    ? label('See how AI services respond', '查看 AI 服务访问条件')
                    : running
                      ? label('Results are arriving', '检测结果逐项返回')
                      : attention
                        ? label('Some entries need attention', '部分入口需关注')
                        : snapshot?.status === 'cancelled'
                          ? label('Partial results retained', '已保留部分结果')
                          : label('Review each observed entry', '查看各入口检测结果')
                "
              />
            </p>
            <p class="network-hero-progress" role="status">
              {{
                hasRun
                  ? `${snapshot?.completed} / ${snapshot?.total} ${label('checks', '项')} · ${elapsed} ${label('seconds', '秒')}`
                  : label('On this device · no sign-in required', '本机检测 · 无需登录')
              }}
              <span v-if="snapshot?.target && snapshot.target !== 'all'">
                · {{ label('Targeted recheck', '局部重测') }}
              </span>
            </p>
            <div class="network-hero-metrics">
              <div>
                <AnimatedNumber :value="AI_NETWORK_SERVICES.length" :format="{ decimals: 1 }" />
                <span>{{ label('AI services', '个 AI 服务') }}</span>
              </div>
              <div>
                <AnimatedNumber :value="endpointCount" :format="{ decimals: 1 }" />
                <span>{{ label('Service entries', '个检测入口') }}</span>
              </div>
            </div>
          </div>
          <IdentityMotion class="network-hero-art" identity="network-globe">
            <img :src="globe" width="300" height="236" alt="" />
            <div class="network-hero-location">
              <span>{{ maskedIp(snapshot?.exit.ip) }}</span>
              <span>{{ location }}</span>
            </div>
          </IdentityMotion>
        </section>
        <section
          class="network-report-panel network-services"
          :aria-label="label('AI service access', 'AI 服务访问')"
        >
          <header>
            <h2>{{ label('AI service access', 'AI 服务访问') }}</h2>
            <SegmentedControl
              v-model="state.filter"
              :options="filters"
              :label="label('Filter access results', '筛选访问结果')"
              appearance="light"
            />
          </header>
          <div class="network-service-grid">
            <NetworkServiceCard
              v-for="service in visible"
              :key="service.id"
              :service="service"
              :results="results"
              :running="targetRunning(service.id)"
              :disabled="busy"
              @open="state.detail = service.id"
              @refresh="run(service.id)"
            />
          </div>
          <p v-if="!visible.length" class="network-empty">
            {{ label('No matching results yet.', '暂无符合条件的检测结果。') }}
          </p>
          <p class="network-report-note">
            <DesignIcon name="networkInfo" :size="16" />
            {{
              label(
                'Network conditions only; account and model permissions are not verified.',
                '仅检测网络条件，账号与模型权限未验证。',
              )
            }}
          </p>
        </section>
      </div>
      <aside class="network-report-side">
        <section class="network-report-panel network-exit-card">
          <h2>{{ label('Exit information', '出口信息') }}</h2>
          <div class="network-exit-location">
            <DesignIcon name="networkPin" :size="28" />
            <div>
              <strong>{{ location }}</strong>
              <NetworkIpAddress :ip="snapshot?.exit.ip" />
            </div>
          </div>
          <p v-if="snapshot?.exit.issue" class="network-report-note">
            {{ issueText(snapshot.exit.issue) }}
          </p>
          <div class="network-exit-type">
            <span>{{ label('IP type', 'IP 类型') }}</span>
            <strong>
              <DesignIcon name="networkServer" :size="20" />
              {{ type }}
            </strong>
          </div>
          <p class="network-report-note">{{ label('Source', '来源') }}: {{ typeSources }}</p>
          <div class="network-exit-ipv6">
            <span>IPv6</span>
            <NetworkIpAddress v-if="snapshot?.ipv6.ip" :ip="snapshot.ipv6.ip" />
            <span v-else :class="{ 'network-text-warning': snapshot?.ipv6.issue }">
              {{
                snapshot?.ipv6.issue
                  ? issueText(snapshot.ipv6.issue)
                  : stateText(snapshot?.ipv6.state)
              }}
            </span>
          </div>
          <p class="network-report-note">
            {{
              label(
                'Lookup service observation; AI service exits may differ.',
                '查询来源观测出口，AI 服务可能使用不同出口。',
              )
            }}
          </p>
        </section>
        <section class="network-report-panel network-risk-card">
          <h2>{{ label('IP quality', 'IP 质量') }}</h2>
          <NetworkRiskGauge
            :value="risk.primary?.riskScore"
            :source="networkSourceName(risk.primary?.id)"
          />
          <p v-if="risk.other" class="network-secondary-risk">
            <span>{{ networkSourceName(risk.other.id) }}</span>
            <span>{{ risk.other.riskScore }} / 100 · {{ riskText(risk.other.riskScore) }}</span>
          </p>
          <button
            type="button"
            class="workspace-link network-detail-link"
            @click="state.detail = 'ip'"
          >
            {{
              label(
                `Compare ${IP_QUALITY_SOURCES.length} sources`,
                `查看 ${IP_QUALITY_SOURCES.length} 个来源`,
              )
            }}
            <DesignIcon name="networkArrow" :size="16" />
          </button>
        </section>
        <section class="network-report-panel network-dns-card">
          <h2>
            <DesignIcon name="networkDns" :size="20" />
            {{ label('DNS exit', 'DNS 出口') }}
          </h2>
          <div class="network-dns-top">
            <span>
              <AnimatedNumber
                :value="snapshot?.dns.observedAt != null ? snapshot.dns.resolvers.length : null"
                :format="{ decimals: 1 }"
              />
              {{ label('resolvers', '个解析器') }}
            </span>
            <small>
              {{ snapshot?.dns.completedProbes ?? 0 }} / {{ DNS_PROBE_COUNT }}
              {{ label('probes', '轮检测') }}
            </small>
          </div>
          <NetworkDnsAssessment
            :dns="snapshot?.dns"
            :checking="running && snapshot?.target === 'dns'"
            compact
          />
          <p v-if="snapshot?.dns.issue" class="network-report-note">
            {{ issueText(snapshot.dns.issue) }}
          </p>
          <button
            type="button"
            class="workspace-link network-detail-link"
            @click="state.detail = 'dns'"
          >
            {{ label('View all', '查看全部') }}
            <DesignIcon name="networkArrow" :size="16" />
          </button>
        </section>
        <footer class="network-report-footer">
          <span :title="connectionNotice">
            {{ connectionNotice }}
          </span>
          <button type="button" class="workspace-link" @click="state.detail = 'ip'">
            {{ label('Sources and evidence', '来源与检测依据') }}
          </button>
          <button type="button" class="workspace-link" @click="state.detail = 'dns'">
            {{ label('Browser cross-check', '浏览器泄漏复核') }}
          </button>
        </footer>
      </aside>
    </div>
    <NetworkDetails
      :target="state.detail"
      :snapshot="snapshot"
      :busy="busy"
      @close="state.detail = ''"
      @refresh="run"
    />
  </PageSurface>
</template>
