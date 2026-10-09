<script setup lang="ts">
import { computed } from 'vue'
import DropdownChevron from '../base/DropdownChevron.vue'
import {
  IP_QUALITY_SOURCES,
  type IpQualityResult,
  type IpRegistrationResult,
  type RiskFactor,
} from '../../../../shared/network-check'
import { assessIpOrigin, type IpOriginAssessment } from '../../../../shared/ip-origin'
import { useNetworkLabels } from '../../composables/useNetworkLabels'

const props = defineProps<{
  sources: IpQualityResult[]
  registration?: IpRegistrationResult
  hasRun: boolean
}>()
const { label, currentLang, stateText, issueText, typeText, riskText, formatTime } =
  useNetworkLabels()
const byId = computed(() => Object.fromEntries(props.sources.map((source) => [source.id, source])))
const origin = computed(() => assessIpOrigin(props.registration, props.sources))
const originChecking = computed(() =>
  [props.registration, ...props.sources].some(
    (row) => row && ['pending', 'checking'].includes(row.state),
  ),
)
const originText = computed(() => {
  if (!props.hasRun) return label('Waiting for a check', '等待开始体检')
  if (originChecking.value) return label('Checking…', '检测中…')
  return origin.value.status === 'native'
    ? label('Likely native', '疑似原生')
    : origin.value.status === 'cross_region'
      ? label('Different registration region', '疑似广播')
      : label('Undetermined', '无法判断')
})
const originReason = computed(() => {
  const reasons: Record<IpOriginAssessment['reason'], [string, string]> = {
    country_match: ['Registration and geolocation agree', '注册地区与定位地区一致'],
    country_mismatch: ['Registration and geolocation differ', '注册地区与定位地区不同'],
    registration_missing: ['Registration data unavailable', '缺少注册地区资料'],
    registration_conflict: ['Registration records disagree', '注册地区记录有分歧'],
    location_missing: ['Geolocation data unavailable', '缺少定位地区资料'],
    location_conflict: ['Geolocation sources disagree', '定位来源之间有分歧'],
  }
  return label(...reasons[origin.value.reason])
})
const factors: Array<{ key: RiskFactor; en: string; zh: string }> = [
  { key: 'proxy', en: 'Proxy', zh: '代理' },
  { key: 'tor', en: 'Tor', zh: 'Tor' },
  { key: 'vpn', en: 'VPN', zh: 'VPN' },
  { key: 'hosting', en: 'Hosting', zh: '服务器 / 机房' },
  { key: 'abuse', en: 'Abuse / attacks', zh: '滥用 / 攻击记录' },
  { key: 'robot', en: 'Bot / scraper', zh: '机器人 / 爬虫' },
  { key: 'compromised', en: 'Compromised', zh: '遭入侵' },
  { key: 'mobile', en: 'Mobile network', zh: '移动网络' },
]
const details: Array<{
  key: 'region' | 'city' | 'companyName' | 'timezone' | 'postalCode'
  en: string
  zh: string
}> = [
  { key: 'region', en: 'State / region', zh: '州 / 省' },
  { key: 'city', en: 'City', zh: '城市' },
  { key: 'companyName', en: 'Company', zh: '所属公司' },
  { key: 'timezone', en: 'Time zone', zh: '时区' },
  { key: 'postalCode', en: 'Postal code', zh: '邮政编码' },
]
function flag(id: string, key: RiskFactor): boolean | null {
  return byId.value[id]?.factors[key] ?? null
}
function sourceState(id: string): string {
  const result = byId.value[id]
  if (result?.issue) return issueText(result.issue)
  if (result?.state !== 'done') return stateText(result?.state)
  if (id === 'ip2location' && result.factors.proxy !== null)
    return label('Basic proxy data', '基础代理数据')
  const hasRisk =
    result.riskScore !== null ||
    result.usageType !== null ||
    result.companyType !== null ||
    Object.entries(result.factors).some(([key, value]) => key !== 'mobile' && value !== null)
  return hasRisk
    ? label('Risk data returned', '已返回风险数据')
    : label('Basic data only', '仅返回基础信息')
}
function formatDate(time: number | null | undefined): string {
  return time == null
    ? '—'
    : new Date(time).toLocaleString(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
        hour12: false,
      })
}
function openSource(url: string): void {
  void window.api.openExternal(url).catch(() => undefined)
}
</script>

<template>
  <section class="network-panel" aria-labelledby="ip-quality-title">
    <div class="network-section-heading">
      <div>
        <h2 id="ip-quality-title">{{ label('IP quality', 'IP 质量') }}</h2>
        <p>
          {{
            label(
              'Compare the same exit IP across official sources.',
              '对照同一个出口 IP 的官方数据来源。',
            )
          }}
        </p>
      </div>
      <span class="network-tag">{{ label('No account or API key', '无需账号与 API Key') }}</span>
    </div>
    <div class="network-origin" :aria-label="label('IP origin reference', 'IP 原生属性参考')">
      <dl class="network-origin-fields">
        <div>
          <dt>{{ label('Native IP (reference)', '原生 IP（参考）') }}</dt>
          <dd>{{ originText }}</dd>
          <small v-if="hasRun && !originChecking">{{ originReason }}</small>
        </div>
        <div>
          <dt>{{ label('Registered region', '注册地区') }}</dt>
          <dd>{{ registration?.countries.join(' / ') || '—' }}</dd>
          <small>
            {{
              registration?.issue
                ? issueText(registration.issue)
                : registration?.registries.join(' / ') || 'RIR'
            }}
          </small>
        </div>
        <div>
          <dt>{{ label('Geolocated region', '定位地区') }}</dt>
          <dd>{{ origin.locatedCountries.join(' / ') || '—' }}</dd>
          <small>
            {{ label('Compared across the sources below', '对照下方各来源的定位结果') }}
          </small>
        </div>
      </dl>
      <p>
        {{
          label(
            'Region comparison is only a reference. It does not establish residential use, physical server location, cross-border routing or AI access.',
            '地区对照仅供参考，不证明住宅属性、实际机房位置、跨境路由或 AI 可用性。',
          )
        }}
      </p>
      <p class="network-origin-source">
        <button
          type="button"
          class="network-source-link"
          @click="openSource('https://stat.ripe.net/docs/data-api/api-endpoints/rir')"
        >
          {{
            label('Registration source: RIPE NCC / RIR statistics', '登记来源：RIPE NCC / RIR 统计')
          }}
          ↗
        </button>
        <span v-if="registration?.observedAt">
          {{ label('Queried', '查询于') }} {{ formatTime(registration.observedAt) }}
          <span v-if="registration.cached">
            · {{ label('Cached · up to 10 min', '缓存 · 最长 10 分钟') }}
          </span>
        </span>
      </p>
    </div>
    <div class="network-table-scroll">
      <table class="network-quality-table">
        <thead>
          <tr>
            <th scope="col">{{ label('Source / field', '来源 / 参数') }}</th>
            <th v-for="source in IP_QUALITY_SOURCES" :key="source.id" scope="col">
              <button type="button" class="network-source-link" @click="openSource(source.url)">
                {{ source.name }} ↗
              </button>
              <small :class="{ 'network-text-warning': byId[source.id]?.issue }">
                {{ sourceState(source.id) }}
              </small>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">{{ label('Region', '地区') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              {{ byId[source.id]?.country ?? '—' }}
            </td>
          </tr>
          <tr>
            <th scope="row">ASN</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              {{ byId[source.id]?.asn ?? '—' }}
            </td>
          </tr>
          <tr>
            <th scope="row">{{ label('Network operator', '网络运营商') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id" class="network-org-cell">
              {{ byId[source.id]?.organization ?? '—' }}
            </td>
          </tr>
          <tr v-for="detail in details" :key="detail.key">
            <th scope="row">{{ label(detail.en, detail.zh) }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              {{ byId[source.id]?.[detail.key] ?? '—' }}
            </td>
          </tr>
          <tr>
            <th scope="row">{{ label('Usage type', '使用类型') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              {{ typeText(byId[source.id]?.usageType) }}
            </td>
          </tr>
          <tr>
            <th scope="row">{{ label('Company type', '公司类型') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              {{ typeText(byId[source.id]?.companyType) }}
            </td>
          </tr>
          <tr class="network-score-row">
            <th scope="row">{{ label('Risk score', '风险评分') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              <template v-if="byId[source.id]?.riskScore != null">
                <strong>{{ byId[source.id].riskScore }}</strong>
                <span class="network-muted">/ 100 · {{ riskText(byId[source.id].riskScore) }}</span>
              </template>
              <span v-else class="network-muted">
                {{ hasRun ? label('Not provided', '未提供') : '—' }}
              </span>
            </td>
          </tr>
          <tr v-for="factor in factors" :key="factor.key">
            <th scope="row">{{ label(factor.en, factor.zh) }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id">
              <span
                v-if="flag(source.id, factor.key) !== null"
                class="network-flag"
                :class="
                  factor.key === 'mobile'
                    ? 'is-neutral'
                    : flag(source.id, factor.key)
                      ? 'is-positive'
                      : 'is-negative'
                "
              >
                {{ flag(source.id, factor.key) ? label('Yes', '是') : label('No', '否') }}
              </span>
              <span
                v-else
                class="network-muted"
                :title="currentLang === 'zh' ? source.noteZh : source.noteEn"
              >
                {{
                  byId[source.id]?.state === 'done'
                    ? source.riskData
                      ? label('Not provided', '未提供')
                      : label('Not included', '接口不提供')
                    : '—'
                }}
              </span>
              <small v-if="source.id === 'ip2location' && factor.key === 'proxy'">
                {{ label('Public proxies only · PUB', '仅公开代理 · PUB') }}
              </small>
            </td>
          </tr>
          <tr>
            <th scope="row">{{ label('Source updated', '来源数据更新') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id" class="network-muted">
              {{ formatDate(byId[source.id]?.sourceUpdatedAt) }}
            </td>
          </tr>
          <tr>
            <th scope="row">{{ label('Observed at', '查询时间') }}</th>
            <td v-for="source in IP_QUALITY_SOURCES" :key="source.id" class="network-muted">
              {{ formatTime(byId[source.id]?.observedAt) }}
              <small v-if="byId[source.id]?.cached">
                {{ label('Cached · up to 10 min', '缓存 · 最长 10 分钟') }}
              </small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="network-panel-note">
      {{
        label(
          'Basic APIs do not include all risk fields. “Not provided” and “—” are not “No”. Scores use each source’s own method and may differ; they are not averaged or treated as AI access scores.',
          '基础接口不提供全部风险字段。“未提供”和“—”不等于“否”。各来源评分方法不同，分数可能不同；不取平均值，也不作为 AI 可用性评分。',
        )
      }}
    </p>
    <p class="network-attribution">
      {{ label('OhMyToken uses', 'OhMyToken 使用') }}
      <button
        type="button"
        class="network-source-link"
        @click="openSource('https://www.ip2location.io')"
      >
        IP2Location.io
      </button>
      {{ label('IP geolocation web service.', 'IP 地理定位服务。') }}
    </p>
    <details class="network-source-details">
      <summary class="disclosure-summary">
        <DropdownChevron disclosure direction="right" />
        {{ label('Data coverage and scoring', '数据范围与评分说明') }}
      </summary>
      <p v-for="source in IP_QUALITY_SOURCES" :key="source.id">
        <strong>{{ source.name }}：</strong>
        {{ currentLang === 'zh' ? source.noteZh : source.noteEn }}
      </p>
      <p>
        {{
          label(
            'ProxyCheck’s bot row reflects its scraper signal. Scores 0–25 / 26–50 / 51–75 / 76–100 are displayed as low / moderate / high / very high. Mobile networks are not themselves a risk signal.',
            'ProxyCheck 的机器人行对应爬虫标记。评分按 0–25 / 26–50 / 51–75 / 76–100 分显示低 / 中等 / 高 / 很高。移动网络标记本身不代表风险。',
          )
        }}
      </p>
    </details>
  </section>
</template>
