<script setup lang="ts">
import { computed } from 'vue'
import type { DnsObservation } from '@shared/network-check'
import { assessDns } from '@shared/dns-assessment'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
import NetworkIpAddress from './NetworkIpAddress.vue'

const props = defineProps<{ dns?: DnsObservation | null; compact?: boolean; checking?: boolean }>()
const { label, countryText, issueText, formatTime } = useNetworkLabels()
const assessment = computed(() => assessDns(props.dns))
const status = computed(() => (props.checking ? 'checking' : assessment.value.status))
const title = computed(() => {
  switch (status.value) {
    case 'pending':
      return label('Leak check pending', '泄漏检查待检测')
    case 'checking':
      return label('Checking DNS regions…', '正在核对 DNS 地区…')
    case 'review':
      return label('Possible DNS leak', 'DNS可能泄露')
    case 'consistent':
      return label('No region mismatch observed', '未见地区异常')
    default:
      return label('Insufficient data to assess', '信息不足，无法判断')
  }
})
const explanation = computed(() => {
  if (props.checking)
    return label('Collecting resolver and exit locations.', '正在获取解析器和公网出口地区。')
  switch (assessment.value.reason) {
    case 'not_checked':
      return label(
        'Compare DNS resolver regions with your public exit.',
        '对比 DNS 解析器与公网出口地区，提示需要复核的情况。',
      )
    case 'checking':
      return label('Collecting resolver and exit locations.', '正在获取解析器和公网出口地区。')
    case 'region_mismatch':
      if (props.compact)
        return label(
          'Public DNS can span regions; review the provider.',
          '公共 DNS 可能跨地区，需结合服务商复核。',
        )
      return label(
        'DNS and exit regions differ. Check your DNS and proxy settings; public DNS can also resolve across regions.',
        'DNS 与出口地区不同，请核对 DNS 和代理设置；公共 DNS 也可能跨地区解析。',
      )
    case 'matching_regions':
      if (props.compact)
        return label(
          'Matching regions do not rule out a DNS leak.',
          '地区一致，仍不能排除 DNS 泄漏。',
        )
      return label(
        'DNS and exit regions match. This does not rule out a DNS leak.',
        'DNS 与出口地区一致，但不能据此排除 DNS 泄漏。',
      )
    case 'no_resolvers':
      return label(
        'No resolvers observed. No results do not mean no leak.',
        '未获得解析器数据，没有结果不代表没有泄漏。',
      )
    case 'incomplete':
      return label(
        'The check is incomplete. Retry before assessing the result.',
        '检测未完成，请重测后再判断。',
      )
    case 'missing_location':
      return label(
        'Some resolver regions are unknown. A complete comparison is unavailable.',
        '部分解析器地区未知，暂时无法完整对比。',
      )
    case 'exit_unavailable':
      return label(
        'The exit region for this DNS check is unavailable.',
        '未获得本轮 DNS 检测的公网出口地区，暂时无法对比。',
      )
    default:
      return label(
        'Resolver location lookup is unavailable. Retry to compare regions.',
        '解析器地区查询暂不可用，请重试后对比。',
      )
  }
})
</script>

<template>
  <div
    class="network-dns-assessment"
    :class="{ 'network-dns-assessment--compact': compact }"
    :data-status="status"
    :aria-label="label('DNS leak check', 'DNS 泄漏检查')"
    role="status"
  >
    <strong>{{ title }}</strong>
    <p>{{ explanation }}</p>
    <template v-if="!compact && dns?.geolocation?.exit">
      <div class="network-dns-baseline">
        <span>{{ label('Exit used for this comparison', '本次对比出口') }}</span>
        <NetworkIpAddress :ip="dns.geolocation.exit.ip" />
        <span>
          {{
            assessment.exitCountry
              ? countryText(assessment.exitCountry)
              : label('Unknown region', '地区未知')
          }}
        </span>
      </div>
      <p>
        {{ label('DNS regions', 'DNS 地区') }}:
        {{ assessment.resolverCountries.map(countryText).join(' / ') || '—' }}
        · {{ assessment.locatedResolvers }} / {{ dns.resolvers.length }}
        {{ label('located', '已定位') }}
      </p>
      <p v-if="dns.geolocation.issue">
        {{ issueText(dns.geolocation.issue) }}
        <span v-if="dns.geolocation.retryAt">
          · {{ label('Retry after', '可重试于') }} {{ formatTime(dns.geolocation.retryAt) }}
        </span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.network-dns-assessment {
  margin: 12px 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--surface);
  font-size: 12px;
  line-height: 20px;
  color: var(--text-soft);
}
.network-dns-assessment strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.network-dns-assessment[data-status='review'] strong {
  color: var(--warning);
}
.network-dns-assessment[data-status='consistent'] strong {
  color: var(--accent);
}
.network-dns-assessment p {
  margin: 4px 0 0;
}
.network-dns-assessment--compact {
  padding: 0;
  background: transparent;
  margin: 8px 0;
}
.network-dns-baseline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  margin-top: 8px;
}
</style>
