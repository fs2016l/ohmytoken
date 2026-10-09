<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { ModelVendor, UsageCostSummary } from '@shared/usage-cost'
import { useI18n } from '../../i18n/useI18n'
import SelectControl from '../base/SelectControl.vue'
import { useCostLabels } from '../../composables/useCostLabels'
import { useCostCurrency } from '../../composables/useCostCurrency'
import { sumMoneyInUsd } from '@shared/cost-currency'
import { formatTokens } from '../../utils/format'
import { formatNumber } from '../../utils/number-format'
import { agentNames } from '../../config/agents'
import PaginationBar from './PaginationBar.vue'
const props = defineProps<{
  from: string
  to: string
  revision: string
  scanning?: boolean
  pending?: boolean
}>()
const emit = defineEmits<{ recover: [] }>()
const { label } = useI18n()
const { vendorName, reasonLabel, costLabel, pricingPeriodLabel } = useCostLabels()
const { currency, exchange, exchangeLoading, refreshRates } = useCostCurrency()
const summary = ref<UsageCostSummary | null>(null)
const loading = ref(false)
const error = ref(false)
const expanded = ref(false)
const query = ref('')
const vendor = ref('')
const onlyUnpriced = ref(false)
const page = ref(1)
const pageSize = ref(10)
let request = 0
let recoveryRequested = false
let timer: ReturnType<typeof setTimeout> | undefined
async function refresh(): Promise<void> {
  if (props.pending) return
  const id = ++request
  loading.value = true
  error.value = false
  summary.value = null
  try {
    const result = await window.api.getUsageCostSummary({ from: props.from, to: props.to })
    if (id === request) {
      summary.value = result
      if (result.recoveryPending && !recoveryRequested) {
        recoveryRequested = true
        emit('recover')
      }
    }
  } catch {
    if (id === request) error.value = true
  } finally {
    if (id === request) loading.value = false
  }
}
watch(
  () => [props.from, props.to, props.revision, props.pending],
  () => {
    ++request
    summary.value = null
    loading.value = true
    clearTimeout(timer)
    if (props.pending) return
    timer = setTimeout(() => void refresh(), 200)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  clearTimeout(timer)
  ++request
})
const vendors = computed(() => [
  ...new Set(summary.value?.groups.map((row) => row.identity.vendor) ?? []),
])
const rows = computed(() =>
  (summary.value?.groups ?? []).filter((row) => {
    const search = query.value.trim().toLowerCase()
    return (
      (!vendor.value || row.identity.vendor === vendor.value) &&
      (!onlyUnpriced.value || row.status === 'unpriced') &&
      (!search ||
        [row.agent, agentNames[row.agent], row.model, vendorName(row.identity.vendor)].some(
          (value) => value?.toLowerCase().includes(search),
        ))
    )
  }),
)
const paged = computed(() =>
  rows.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
)
watch([query, vendor, onlyUnpriced, pageSize, summary], () => {
  page.value = 1
})
const coverage = computed(() =>
  summary.value?.totalTokens ? (100 * summary.value.pricedTokens) / summary.value.totalTokens : 0,
)
const usdTotal = computed(() =>
  summary.value?.totals.length
    ? sumMoneyInUsd(summary.value.totals, exchange.value.snapshot)
    : null,
)
function showSource(url: string): void {
  void window.api.openExternal(url)
}
</script>

<template>
  <section class="panel cost-panel" :aria-busy="loading">
    <div class="cost-heading">
      <div>
        <h3>{{ label('Estimated cost & model vendors', '成本预估与模型厂商') }}</h3>
        <p>
          {{
            label(
              'Estimated at configured reference prices; not an invoice.',
              '按配置的参考价格估算用量价值，不代表实际账单。',
            )
          }}
        </p>
      </div>
      <div class="cost-actions">
        <SelectControl
          v-model="currency"
          :label="label('Display currency', '显示币种')"
          :options="[
            { value: 'USD', label: label('USD · US dollar', 'USD · 美元') },
            { value: 'CNY', label: label('CNY · Chinese yuan', 'CNY · 人民币') },
          ]"
        />
        <button
          type="button"
          class="detail-button"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          {{ expanded ? label('Hide details', '收起明细') : label('View breakdown', '查看明细') }}
          <span aria-hidden="true">{{ expanded ? '−' : '+' }}</span>
        </button>
      </div>
    </div>
    <div v-if="pending" class="cost-state" role="status">
      {{
        label('Estimates will appear after this scan finishes.', '本轮扫描完成后自动显示参考费用。')
      }}
    </div>
    <div v-else-if="loading" class="cost-state" role="status">
      {{ label('Calculating from individual usage records…', '正在按用量记录计算…') }}
    </div>
    <div v-else-if="error" class="cost-state" role="alert">
      {{ label('Could not load estimates.', '成本预估加载失败。') }}
      <button type="button" @click="refresh">{{ label('Retry', '重试') }}</button>
    </div>
    <div v-else-if="summary && !summary.totalRecords" class="cost-state" role="status">
      {{ label('No usage records in this range.', '当前范围暂无用量记录。') }}
    </div>
    <template v-else-if="summary">
      <div class="cost-cards">
        <div class="cost-total">
          <span class="caption">
            {{ label('Total API equivalent', 'API 参考总费用') }}
          </span>
          <strong v-if="usdTotal" :title="costLabel({ ...usdTotal, status: 'range' })">
            ≈ {{ costLabel({ ...usdTotal, status: 'range' }, true) }}
          </strong>
          <strong v-else>—</strong>
          <small v-if="summary.totals.length && !usdTotal">
            {{
              label(
                'A valid exchange rate is needed to combine all priced usage',
                '等待有效汇率后合并全部已计价用量',
              )
            }}
          </small>
          <small>
            {{
              label('Combined in USD · unpriced usage excluded', '统一折合 USD · 不含未计价记录')
            }}
          </small>
        </div>
        <div>
          <span class="caption">{{ label('Token coverage', 'Token 计价覆盖率') }}</span>
          <strong>
            {{ summary.totalTokens ? formatNumber(coverage, { percent: true }) : '—' }}
          </strong>
          <div
            class="coverage-track"
            role="progressbar"
            :aria-valuenow="coverage"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-label="label('Token pricing coverage', 'Token 计价覆盖率')"
          >
            <span :style="{ width: coverage + '%' }" />
          </div>
          <small>
            {{ formatTokens(summary.pricedTokens) }} /
            {{ formatTokens(summary.totalTokens) }} tokens
          </small>
        </div>
        <div>
          <span class="caption">{{ label('Unpriced records', '未计价记录') }}</span>
          <strong :title="formatNumber(summary.totalRecords - summary.pricedRecords)">
            {{ formatNumber(summary.totalRecords - summary.pricedRecords, { compact: true }) }}
          </strong>
          <small>
            {{ label('Missing price or billing evidence', '缺价格或计费依据，保留为未知') }}
          </small>
        </div>
        <div>
          <span class="caption">
            {{ label('Records with a known model vendor', '已识别模型厂商的记录') }}
          </span>
          <strong
            :title="`${formatNumber(summary.vendorRecords)} / ${formatNumber(summary.totalRecords)}`"
          >
            {{ formatNumber(summary.vendorRecords, { compact: true }) }}
            <em>/ {{ formatNumber(summary.totalRecords, { compact: true }) }}</em>
          </strong>
          <small>
            {{ label('Matched by model ID and name', '按模型 ID 与名称规则匹配') }}
          </small>
        </div>
      </div>
      <div class="exchange-note" role="status">
        <span v-if="exchange.snapshot">
          1 USD = {{ exchange.snapshot.rates.CNY.toFixed(6) }} CNY ·
          {{ exchange.snapshot.source === 'manual' ? label('Manual rate', '后台维护汇率') : 'ECB' }}
          · {{ label('Rate date', '汇率日期') }} {{ exchange.snapshot.asOf }}
          <span v-if="exchange.refreshFailed">
            · {{ label('Refresh failed; using the saved rate', '更新失败，沿用已保存汇率') }}
          </span>
        </span>
        <span v-else>
          {{
            exchangeLoading
              ? label('Fetching the reference exchange rate…', '正在获取参考汇率…')
              : label(
                  'Exchange rate unavailable; combined totals are pending',
                  '汇率暂不可用，暂不显示跨币种总额',
                )
          }}
        </span>
        <button type="button" :disabled="exchangeLoading" @click="refreshRates(true)">
          {{ exchangeLoading ? label('Updating…', '更新中…') : label('Refresh rate', '更新汇率') }}
        </button>
      </div>
      <p v-if="summary.recoveryPending" class="method-note" role="status">
        {{
          scanning
            ? label(
                'Recovering model and pricing evidence from original logs in the background…',
                '正在后台从原始日志补录模型和计价依据…',
              )
            : label(
                'Some historical evidence is still pending. Scan again to retry.',
                '部分历史依据尚未补录，可通过扫描重试。',
              )
        }}
      </p>
      <p v-else-if="summary.legacyRecords" class="method-note">
        {{ label('Original evidence is still missing for', '仍缺少原始依据的旧记录：') }}
        {{ summary.legacyRecords.toLocaleString() }}
        {{ label('records. Their stored usage has been preserved.', '条，已有用量仍完整保留。') }}
      </p>
      <div v-if="expanded" class="cost-details">
        <p class="method-note">
          {{
            label(
              'Model vendors follow the recorded model name. A family match alone does not supply a price. Standard API estimates exclude subscriptions, negotiated prices, taxes, tool charges and cache storage. Totals and details share one exchange rate; ranges reflect missing billing details.',
              '模型厂商按记录中的名称归属；识别出厂商不等于已匹配具体单价。标准 API 参考价不含订阅、协议价格、税费、工具费和缓存存储费。总额与明细使用同一份汇率，费用范围表示计费细节不足。',
            )
          }}
        </p>
        <div class="cost-filters">
          <input
            v-model="query"
            type="search"
            :aria-label="label('Search model, agent or vendor', '搜索模型、Agent 或厂商')"
            :placeholder="label('Search model, agent or vendor', '搜索模型、Agent 或厂商')"
          />
          <SelectControl
            v-model="vendor"
            :label="label('Model vendor', '模型厂商')"
            :options="[
              { value: '', label: label('All model vendors', '全部模型厂商') },
              ...vendors.map((value) => ({ value, label: vendorName(value as ModelVendor) })),
            ]"
          />
          <label>
            <input v-model="onlyUnpriced" type="checkbox" />
            {{ label('Unpriced only', '仅未计价') }}
          </label>
        </div>
        <div class="cost-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{{ label('Model / Agent', '模型 / Agent') }}</th>
                <th>{{ label('Model vendor', '模型厂商') }}</th>
                <th class="numeric">Token</th>
                <th class="numeric">{{ label('API equivalent', 'API 参考费用') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in paged" :key="index">
                <td>
                  <b class="model-id">{{ row.model }}</b>
                  <small>
                    {{ agentNames[row.agent] || row.agent }} ·
                    {{ formatNumber(row.records, { compact: true }) }}
                    {{ label('records', '条记录') }}
                  </small>
                </td>
                <td>
                  {{ vendorName(row.identity.vendor) }}
                  <small v-if="row.identity.vendorBasis === 'model-name'">
                    {{ label('From model name', '按模型名称识别') }}
                  </small>
                </td>
                <td class="numeric">{{ formatTokens(row.tokens) }}</td>
                <td class="numeric">
                  <b :class="{ 'priced-value': row.status !== 'unpriced' }" :title="costLabel(row)">
                    {{ row.status === 'unpriced' ? '' : '≈ ' }}{{ costLabel(row, true) }}
                  </b>
                  <small v-if="row.reason">{{ reasonLabel(row.reason) }}</small>
                  <small v-if="row.pricingPeriod">
                    {{ pricingPeriodLabel(row.pricingPeriod) }}
                  </small>
                  <button
                    v-if="row.source"
                    type="button"
                    class="source-button"
                    @click="showSource(row.source)"
                  >
                    {{ label('Reference price', '参考价格') }} ↗
                  </button>
                </td>
              </tr>
              <tr v-if="!paged.length">
                <td colspan="4" class="cost-state">
                  {{ label('No matching records', '暂无匹配记录') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <PaginationBar
          :page="page"
          :page-size="pageSize"
          :total="rows.length"
          @change-page="page = $event"
          @change-page-size="pageSize = $event"
        />
        <p class="catalog-note">
          {{ label('Reference price catalog date', '参考价格配置日期') }} {{ summary.checkedAt }} ·
          {{
            label(
              'New prices apply to future calculations. Existing estimates stay as recorded; run a full scan to recalculate them.',
              '新价格用于后续计算。已有费用保持原值；需要重算时可手动全量扫描。',
            )
          }}
        </p>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cost-panel {
  padding: 22px 24px;
  margin: 0 0 24px;
  overflow: hidden;
}
.cost-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
h3 {
  margin: 0 0 6px;
  color: var(--text);
  font-size: 17px;
}
p {
  margin: 0;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.7;
}
button,
input {
  font: inherit;
}
.detail-button {
  display: flex;
  align-items: center;
  gap: 14px;
  white-space: nowrap;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  background: var(--bg-base);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.cost-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  flex-wrap: wrap;
}
.exchange-note {
  display: flex;
  gap: 12px;
  align-items: baseline;
  flex-wrap: wrap;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1.7;
  margin-top: 16px;
}
.exchange-note button {
  border: 0;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  padding: 0;
}
.exchange-note button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.cost-cards {
  display: grid;
  grid-template-columns: 1.6fr 1fr 0.8fr 1.15fr;
  margin-top: 22px;
  gap: 24px;
}
.cost-cards > div {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.caption {
  color: var(--text-muted);
  font-size: 11px;
}
strong {
  font-family: var(--font-mono);
  font-weight: 600;
  color: var(--text);
  font-size: clamp(19px, 1.7vw, 25px);
  font-variant-numeric: tabular-nums;
}
.cost-total strong,
.priced-value {
  color: var(--primary);
}
small {
  display: block;
  color: var(--text-soft);
  font-size: 11px;
  line-height: 1.6;
  font-weight: normal;
  overflow-wrap: anywhere;
}
em {
  font-size: 12px;
  font-style: normal;
  color: var(--text-muted);
}
.coverage-track {
  height: 4px;
  border-radius: 4px;
  background: var(--bg-base);
  overflow: hidden;
  max-width: 170px;
}
.coverage-track span {
  display: block;
  height: 100%;
  background: var(--primary);
}
.cost-state {
  padding: 22px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
.cost-details {
  margin-top: 20px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.method-note {
  max-width: 1100px;
}
.cost-filters {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--text-muted);
}
.cost-filters > input {
  background: var(--bg-base);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 8px 10px;
}
.cost-filters > input {
  flex: 1;
  min-width: 190px;
}
.cost-filters label {
  display: flex;
  align-items: center;
  gap: 4px;
}
.cost-table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 700px;
  border-collapse: collapse;
  table-layout: fixed;
}
th,
td {
  padding: 12px 10px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  overflow-wrap: anywhere;
  color: var(--text-muted);
}
th {
  font-size: 11px;
  color: var(--text-soft);
  background: var(--bg-base);
}
th:first-child {
  width: 32%;
}
th:nth-child(2) {
  width: 18%;
}
th:nth-child(3) {
  width: 16%;
}
th:nth-child(4) {
  width: 34%;
}
b {
  font-weight: 500;
  color: var(--text);
}
.model-id {
  font-family: var(--font-mono);
}
.numeric {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.source-button {
  display: block;
  margin-left: auto;
  border: 0;
  background: transparent;
  padding: 4px 0 0;
  font-size: 11px;
  color: var(--primary);
  cursor: pointer;
}
.catalog-note {
  margin-top: 12px;
  font-size: 11px;
}
@media (max-width: 1150px) {
  .cost-cards {
    grid-template-columns: 1fr 1fr;
    row-gap: 20px;
  }
}
@media (max-width: 650px) {
  .cost-panel {
    padding: 18px 14px;
  }
  .cost-heading {
    flex-direction: column;
    gap: 12px;
  }
  .cost-cards {
    gap: 18px;
  }
}
</style>
