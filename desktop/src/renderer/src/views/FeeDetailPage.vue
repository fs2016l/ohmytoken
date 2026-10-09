<script setup lang="ts">
import { computed, watch } from 'vue'
import type { UsageAnalytics } from '@shared/analytics'
import PageSurface from '../components/base/PageSurface.vue'
import AnimatedNumber from '../components/base/AnimatedNumber.vue'
import PaginationBar from '../components/base/PaginationBar.vue'
import ScrollRegion from '../components/base/ScrollRegion.vue'
import SearchControl from '../components/base/SearchControl.vue'
import { useI18n } from '../i18n/useI18n'
import { useAnalyticsContext } from '../composables/useAnalyticsContext'
import { usePageResource } from '../composables/usePageResource'
import { usePageState } from '../composables/usePageState'
import { useScanStatus } from '../composables/useScanStatus'
import { useCostLabels } from '../composables/useCostLabels'
import { getAgentName } from '../config/agents'
import { formatNumber } from '../utils/number-format'
const { label } = useI18n(),
  { state, filter, back } = useAnalyticsContext('fees'),
  scan = useScanStatus()
const { reasonLabel, pricingPeriodLabel } = useCostLabels()
const list = usePageState('fees-list', {
  query: '',
  submitted: '',
  page: 1,
  size: 10,
  unpriced: false as boolean,
})
const resource = usePageResource(
  () => [filter.value, scan.revision.value],
  () => window.api.getUsageAnalytics(filter.value),
  null as UsageAnalytics | null,
)
const summary = computed(() => resource.data.value?.summary.costSummary)
const currencies = computed(() =>
  (['USD', 'CNY'] as const).map((currency) => ({
    currency,
    total: summary.value?.totals.find((value) => value.currency === currency),
  })),
)
const coverage = computed(() =>
  summary.value?.totalTokens
    ? (summary.value.pricedTokens / summary.value.totalTokens) * 100
    : null,
)
const rows = computed(() =>
  (summary.value?.groups || []).filter(
    (row) =>
      (!list.unpriced || row.status === 'unpriced') &&
      (!list.submitted ||
        `${row.model} ${row.agent} ${getAgentName(row.agent)}`
          .toLocaleLowerCase()
          .includes(list.submitted.toLocaleLowerCase())),
  ),
)
const paged = computed(() => rows.value.slice((list.page - 1) * list.size, list.page * list.size))
watch(
  () => rows.value.length,
  (total) => {
    list.page = Math.min(list.page, Math.max(1, Math.ceil(total / list.size)))
  },
)
function search(): void {
  list.submitted = list.query.trim()
  list.page = 1
}
function showSource(url: string): void {
  if (/^https?:\/\//i.test(url)) void window.api.openExternal(url)
}
</script>
<template>
  <PageSurface page-key="fees" fixed class="fee-detail-page">
    <div class="fee-heading">
      <button type="button" class="workspace-button" @click="back">
        ← {{ label('Back', '返回') }}
      </button>
      <h1>{{ label('Cost estimate details', '费用估算明细') }}</h1>
      <span>{{ state.range.from || label('All dates', '全部日期') }} — {{ state.range.to }}</span>
    </div>
    <p v-if="resource.error.value" class="workspace-error" role="alert">
      {{ resource.error.value }}
      <button type="button" class="workspace-link" @click="resource.refresh()">
        {{ label('Retry', '重试') }}
      </button>
    </p>
    <section class="workspace-panel fee-summary" :aria-busy="resource.busy.value">
      <div v-for="item in currencies" :key="item.currency">
        <span>
          {{ item.currency }} ·
          {{
            item.currency === 'USD' ? label('US dollar', '美元') : label('Chinese yuan', '人民币')
          }}
        </span>
        <strong>
          <template v-if="item.total">
            ≈
            <AnimatedNumber :value="item.total.min" :format="{ currency: item.currency }" />
            <template v-if="item.total.max - item.total.min > 1e-10">
              —
              <AnimatedNumber :value="item.total.max" :format="{ currency: item.currency }" />
            </template>
          </template>
          <template v-else>—</template>
        </strong>
        <small>
          {{ label('Original currency, API reference estimate', '保留原币种，按 API 参考价估算') }}
        </small>
      </div>
      <div>
        <span>{{ label('Pricing coverage', '定价覆盖') }}</span>
        <strong><AnimatedNumber :value="coverage" :format="{ percent: true }" /></strong>
        <small>
          {{ formatNumber(summary?.pricedTokens, { compact: true }) }} /
          {{ formatNumber(resource.data.value?.summary.totalTokens, { compact: true }) }} tokens
        </small>
      </div>
    </section>
    <section class="workspace-table-frame fee-basis">
      <header>
        <h2>{{ label('Estimate basis', '估算依据') }}</h2>
        <SearchControl
          v-model="list.query"
          :placeholder="label('Search model or Agent', '搜索模型或 Agent')"
          @search="search"
        />
        <label>
          <input v-model="list.unpriced" type="checkbox" @change="list.page = 1" />
          {{ label('Unpriced only', '只看未计价') }}
        </label>
      </header>
      <ScrollRegion
        page-key="fees"
        region="basis"
        :label="label('Pricing evidence', '计价依据列表')"
      >
        <table class="workspace-table">
          <thead>
            <tr>
              <th>{{ label('Model / scope', '模型 / 范围') }}</th>
              <th>{{ label('Tokens', 'Token') }}</th>
              <th>{{ label('Estimate', '估算金额') }}</th>
              <th>{{ label('Basis and source', '口径与来源') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in paged" :key="`${row.agent}:${row.model}:${index}`">
              <td>
                <b>{{ row.model }}</b>
                <small>
                  {{ getAgentName(row.agent) }} · {{ formatNumber(row.records) }}
                  {{ label('records', '条记录') }}
                </small>
              </td>
              <td><AnimatedNumber :value="row.tokens" :format="{ compact: true }" /></td>
              <td>
                <template v-if="row.status !== 'unpriced' && row.currency">
                  ≈
                  <AnimatedNumber :value="row.min" :format="{ currency: row.currency }" />
                  <template
                    v-if="
                      row.max !== undefined && row.min !== undefined && row.max - row.min > 1e-10
                    "
                  >
                    –
                    <AnimatedNumber :value="row.max" :format="{ currency: row.currency }" />
                  </template>
                  <small>{{ row.currency }}</small>
                </template>
                <template v-else>
                  —
                  <small>{{ label('Unpriced', '未计价') }}</small>
                </template>
              </td>
              <td>
                <span>
                  {{
                    row.status === 'range'
                      ? label('Range estimate', '区间估算')
                      : row.status === 'estimated'
                        ? label('API reference estimate', 'API 参考估算')
                        : label('Price unavailable', '缺少适用定价')
                  }}
                </span>
                <small v-if="row.reason">{{ reasonLabel(row.reason) }}</small>
                <small v-if="row.pricingEffectiveFrom || row.pricingPeriod">
                  {{ pricingPeriodLabel(row.pricingPeriod) }} · {{ row.pricingEffectiveFrom }}
                </small>
                <button
                  v-if="row.source && /^https?:\/\//i.test(row.source)"
                  type="button"
                  class="workspace-link"
                  @click="showSource(row.source)"
                >
                  {{ row.priceCard || label('Pricing source', '定价来源') }} ↗
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!paged.length" class="workspace-empty">
          {{
            resource.busy.value
              ? label('Loading…', '正在加载…')
              : label('No pricing evidence in this selection', '当前筛选范围暂无计价依据')
          }}
        </div>
      </ScrollRegion>
      <PaginationBar v-model:page="list.page" v-model:page-size="list.size" :total="rows.length" />
    </section>
    <section class="fee-explanation">
      <h2>{{ label('About this estimate', '关于费用估算') }}</h2>
      <p>
        {{
          label(
            'API equivalent estimates are not provider invoices. They use the recorded token categories, request size and applicable historical reference prices. Unpriced records still count toward usage.',
            '这些金额表示 API 等价估算，不代表服务商账单。估算依据为记录中的 Token 分类、请求规模和适用的历史参考价格，未计价记录仍计入用量。',
          )
        }}
      </p>
      <p>
        {{
          label(
            'The page keeps each original currency separate. Component ranges use the same price candidates; their independent bounds may not add up to the overall range.',
            '本页按原币种分别汇总。分项区间使用同一组候选价格；各项独立取到的上下限不一定能相加为总额区间。',
          )
        }}
      </p>
    </section>
  </PageSurface>
</template>
<style scoped>
.fee-heading {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 64px;
  margin-bottom: 24px;
  flex-shrink: 0;
}
.fee-heading h1 {
  margin: 0;
  font-size: 28px;
  font-weight: 500;
}
.fee-heading > span {
  font-size: 12px;
  color: var(--text-soft);
}
.fee-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  padding: 24px;
  border-color: var(--border);
  margin-bottom: 24px;
  min-height: 136px;
  flex-shrink: 0;
}
.fee-summary > div > span {
  font-size: 12px;
  color: var(--text-soft);
}
.fee-summary strong {
  display: block;
  font-size: 30px;
  font-weight: 600;
  margin: 10px 0;
  white-space: normal;
}
.fee-summary small {
  font-size: 11px;
  color: var(--text-soft);
}
.fee-basis {
  flex: 1;
  min-height: 0;
  margin-bottom: 24px;
}
.fee-basis header {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
}
.fee-basis h2 {
  margin: 0 auto 0 0;
  font-size: 16px;
  font-weight: 500;
}
.fee-basis header > label {
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fee-basis table {
  min-width: 800px;
  table-layout: fixed;
}
.fee-basis th:first-child {
  width: 23%;
}
.fee-basis th:nth-child(2) {
  width: 14%;
}
.fee-basis th:nth-child(3) {
  width: 24%;
}
.fee-basis td {
  height: 76px;
  font-size: 13px;
}
.fee-basis td b {
  font-weight: 400;
  overflow-wrap: anywhere;
}
.fee-basis td small {
  display: block;
  font-size: 11px;
  color: var(--text-soft);
  margin-top: 4px;
}
.fee-explanation {
  padding: 20px 24px;
  background: var(--primary-soft);
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.7;
  flex-shrink: 0;
}
.fee-explanation h2 {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  margin: 0 0 8px;
}
.fee-explanation p {
  margin: 4px 0;
}
</style>
