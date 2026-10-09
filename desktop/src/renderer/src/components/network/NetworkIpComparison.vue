<script setup lang="ts">
import { computed, ref } from 'vue'
import { IP_QUALITY_SOURCES, type IpQualityResult } from '@shared/network-check'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
const props = defineProps<{ sources: IpQualityResult[] }>()
const { label, typeText, riskText, formatTime, issueText, stateText, countryText } =
  useNetworkLabels()
const byId = computed(() => Object.fromEntries(props.sources.map((source) => [source.id, source])))
const error = ref(false)
const rows = computed<Array<{ title: string; value: (source?: IpQualityResult) => string }>>(() => [
  {
    title: label('Country / region', '国家 / 地区'),
    value: (s) => (s?.countryCode ? countryText(s.countryCode) : (s?.country ?? '—')),
  },
  { title: label('City', '城市'), value: (s) => s?.city ?? '—' },
  { title: 'ASN', value: (s) => s?.asn ?? '—' },
  { title: label('Organization', '网络组织'), value: (s) => s?.organization ?? '—' },
  { title: label('IP type', 'IP 类型'), value: (s) => typeText(s?.usageType ?? s?.companyType) },
  {
    title: label('Risk score', '风险评分'),
    value: (s) => (s?.riskScore == null ? '—' : `${s.riskScore} · ${riskText(s.riskScore)}`),
  },
  {
    title: label('Proxy / VPN', '代理 / VPN'),
    value: (s) =>
      s?.factors.proxy == null && s?.factors.vpn == null
        ? '—'
        : `${s?.factors.proxy == null ? '—' : s.factors.proxy ? label('Yes', '是') : label('No', '否')} / ${s?.factors.vpn == null ? '—' : s.factors.vpn ? label('Yes', '是') : label('No', '否')}`,
  },
  {
    title: label('Checked at', '查询时间'),
    value: (s) => formatTime(s?.observedAt) + (s?.cached ? label(' · cached', ' · 缓存') : ''),
  },
])
async function open(url: string): Promise<void> {
  error.value = false
  try {
    await window.api.openExternal(url)
  } catch {
    error.value = true
  }
}
</script>
<template>
  <div class="network-comparison-scroll">
    <table class="network-comparison-table">
      <thead>
        <tr>
          <th>{{ label('Property', '属性') }}</th>
          <th v-for="source in IP_QUALITY_SOURCES" :key="source.id">
            <button type="button" class="workspace-link" @click="open(source.url)">
              {{ source.name }} ↗
            </button>
            <small v-if="byId[source.id]?.issue || byId[source.id]?.state !== 'done'">
              {{
                byId[source.id]?.issue
                  ? issueText(byId[source.id].issue)
                  : stateText(byId[source.id]?.state)
              }}
            </small>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.title">
          <th scope="row">{{ row.title }}</th>
          <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
            {{ row.value(byId[source.id]) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="network-report-note">
    {{
      label(
        'Sources may differ; unavailable fields show —. Each source scores independently; scores are not combined.',
        '不同来源可能存在差异；未提供的数据以 — 显示。各来源独立评分，不合并为统一分数。',
      )
    }}
  </p>
  <p v-if="error" class="workspace-error" role="alert">
    {{ label('Could not open the source. Please retry.', '未能打开来源，请重试。') }}
  </p>
</template>
<style scoped>
.network-comparison-scroll {
  overflow: auto;
  margin-top: 24px;
}
.network-comparison-table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
  min-width: 1000px;
  font-size: 14px;
  line-height: 22px;
  text-align: left;
}
th,
td {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
  vertical-align: middle;
}
thead {
  background: var(--surface);
}
th {
  font-weight: 400;
}
thead th,
thead .workspace-link {
  color: var(--text);
}
tbody th,
td {
  color: var(--text-muted);
}
th:first-child {
  width: 130px;
}
small {
  display: block;
  font-size: 11px;
  color: var(--text-soft);
}
tbody tr:nth-child(5) {
  background: var(--surface);
}
</style>
