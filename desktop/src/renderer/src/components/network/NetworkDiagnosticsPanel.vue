<script setup lang="ts">
import { computed, ref } from 'vue'
import { DNS_PROBE_COUNT, type DnsObservation } from '../../../../shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import NetworkIpAddress from './NetworkIpAddress.vue'

const props = defineProps<{
  dns?: DnsObservation
  ip?: string | null
  hasRun: boolean
}>()
const { label, stateText, issueText, routeText, formatTime } = useNetworkLabels()
const expanded = ref(false)
const openFailed = ref(false)
const resolvers = computed(() => props.dns?.resolvers ?? [])
const visibleResolvers = computed(() =>
  expanded.value ? resolvers.value : resolvers.value.slice(0, 8),
)
const dnsStatus = computed(() => {
  if (props.dns?.issue && resolvers.value.length) return label('Partial observation', '部分观测')
  if (props.dns?.state !== 'done') return stateText(props.dns?.state)
  return resolvers.value.length
    ? label('Resolvers observed', '已观测到解析器')
    : label('No resolver observed', '未观测到解析器')
})
async function openSite(url: string): Promise<void> {
  openFailed.value = false
  try {
    await window.api.openExternal(url)
  } catch {
    openFailed.value = true
  }
}
function openScamalytics(): void {
  if (props.ip) void openSite(`https://scamalytics.com/ip/${encodeURIComponent(props.ip)}`)
}
</script>

<template>
  <section class="network-panel" aria-labelledby="network-dns-title">
    <div class="network-section-heading">
      <div>
        <h2 id="network-dns-title">{{ label('DNS exit observation', 'DNS 出口观测') }}</h2>
        <p>
          {{
            label(
              'Recursive resolvers observed by IPLeak during this check.',
              '由 IPLeak 记录本次探测实际经过的递归 DNS 解析器。',
            )
          }}
        </p>
      </div>
      <span class="network-tag">{{ dnsStatus }}</span>
    </div>
    <div class="network-dns-content">
      <div class="network-dns-summary">
        <span>
          {{ label('Resolvers', '解析器数量') }}
          <strong>{{ hasRun ? resolvers.length : '—' }}</strong>
        </span>
        <span>
          {{ label('Valid probes', '有效探测') }} {{ dns?.completedProbes ?? 0 }} /
          {{ DNS_PROBE_COUNT }}
        </span>
        <span v-if="dns?.observedAt">
          {{ formatTime(dns.observedAt) }} · {{ routeText(dns.route) }}
        </span>
      </div>
      <p v-if="dns?.issue" class="network-dns-issue">
        {{ issueText(dns.issue) }}
        <span v-if="dns.retryAt">
          · {{ label('Retry after', '此来源可重试于') }} {{ formatTime(dns.retryAt) }}
        </span>
      </p>
      <ul v-if="resolvers.length" class="network-dns-resolvers">
        <li v-for="resolver in visibleResolvers" :key="resolver.ip">
          <NetworkIpAddress :ip="resolver.ip" />
          <small>{{ label('Observed queries', '观测查询数') }} {{ resolver.hits }}</small>
        </li>
      </ul>
      <button
        v-if="resolvers.length > 8"
        type="button"
        class="network-source-link network-dns-expand"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{
          expanded
            ? label('Show fewer', '收起列表')
            : label(`Show all ${resolvers.length}`, `查看全部 ${resolvers.length} 个`)
        }}
      </button>
      <p v-if="!resolvers.length" class="network-dns-empty">
        {{
          !hasRun
            ? label(
                'Start a network check to observe DNS resolvers.',
                '开始体检后显示 DNS 解析器。',
              )
            : label(
                'No resolver data yet. An empty result does not establish that DNS is leak-free.',
                '暂无解析器数据；没有结果不代表没有 DNS 泄漏。',
              )
        }}
      </p>
    </div>
    <p class="network-panel-note">
      {{
        label(
          'This observes the app’s current network path. Multiple resolver IPs, or locations different from your exit, do not by themselves prove a DNS leak. Your browser may use different proxy or secure DNS settings.',
          '此项观测应用当前的网络路径。出现多个 DNS 地址，或 DNS 与出口地区不同，都不能单独证明泄漏；浏览器可能使用不同的代理或安全 DNS 设置。',
        )
      }}
    </p>
    <div class="network-browser-check">
      <div>
        <strong>{{ label('Browser leak check', '浏览器泄漏复核') }}</strong>
        <p>
          {{
            label(
              'Open IPLeak to check the browser’s DNS, IPv6 and WebRTC exposure.',
              '打开 IPLeak，检查浏览器的 DNS、IPv6 与 WebRTC 地址暴露情况。',
            )
          }}
        </p>
      </div>
      <button
        type="button"
        class="network-button secondary"
        @click="openSite('https://ipleak.net/#dnsleak')"
      >
        {{ label('Open IPLeak', '打开 IPLeak') }} ↗
      </button>
    </div>
    <div class="network-manual-tools">
      <article>
        <h3>Scamalytics</h3>
        <p>
          {{
            label(
              'Manually review this exit IP’s fraud score and proxy labels. Website results are not imported automatically.',
              '手动复核此出口 IP 的欺诈风险分与代理标签，网站结果不自动导入。',
            )
          }}
        </p>
        <button type="button" class="network-source-link" :disabled="!ip" @click="openScamalytics">
          {{ label('Look up this exit IP', '查询此出口 IP') }} ↗
        </button>
      </article>
      <article>
        <h3>Ping.pe</h3>
        <p>
          {{
            label(
              'Run Ping, MTR and BGP diagnostics from remote locations to a target. This measures a different path from your local AI requests.',
              '从多个地区对目标做 Ping、MTR 与 BGP 诊断；观测的是远端到目标的链路。',
            )
          }}
        </p>
        <button type="button" class="network-source-link" @click="openSite('https://ping.pe/')">
          {{ label('Open diagnostics', '打开诊断网站') }} ↗
        </button>
      </article>
    </div>
    <p v-if="openFailed" class="network-panel-note" role="alert">
      {{ label('Could not open the browser. Please try again.', '未能打开浏览器，请重试。') }}
    </p>
  </section>
</template>
