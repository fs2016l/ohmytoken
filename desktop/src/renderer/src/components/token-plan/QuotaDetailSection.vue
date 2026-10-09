<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QuotaDetailSource } from '../../../../shared/quota-details'
import { useQuotaDetailLabels } from '../../composables/useQuotaDetailLabels'
import { useI18n } from '../../i18n/useI18n'
import SelectControl from '../base/SelectControl.vue'
const props = defineProps<{ source: QuotaDetailSource; loading: boolean }>()
const emit = defineEmits<{ more: [] }>()
const { label, currentLang } = useI18n()
const { name, note, format } = useQuotaDetailLabels()
const status = computed(() => {
  if (props.loading) return label('Updating', '查询中')
  if (['region_restricted', 'region_unknown'].includes(props.source.errorCode ?? ''))
    return label('Refresh paused', '已停止刷新')
  if (props.source.errorCode || props.source.status === 'error')
    return label('Update failed', '更新失败')
  return props.source.stale ? label('Previous result', '上次结果') : ''
})
function categoryName(value: string): string {
  return value === 'total'
    ? label('Usage summary', '用量汇总')
    : value.startsWith('pool:')
      ? `${label('Quota pool', '额度池')} ${value.slice(5)}`
      : name(value)
}
function rowLabel(value: string): string {
  return value.split(' · ').map(name).join(' · ')
}
const category = ref('all'),
  page = ref(1)
const categories = computed(() => [
  ...new Set(props.source.rows.map((row) => row.category).filter((v): v is string => Boolean(v))),
])
watch(
  () => props.source.id,
  () => {
    category.value = categories.value.includes('total') ? 'total' : 'all'
    page.value = 1
  },
  { immediate: true },
)
watch(category, () => {
  page.value = 1
})
const rows = computed(() =>
  props.source.rows.filter((row) => category.value === 'all' || row.category === category.value),
)
const visible = computed(() => rows.value.slice((page.value - 1) * 50, page.value * 50))
const columns = computed(() => [
  ...new Set(visible.value.flatMap((row) => row.metrics.map((m) => m.key))),
])
const pages = computed(() => Math.max(1, Math.ceil(rows.value.length / 50)))
watch(pages, (value) => {
  if (page.value > value) page.value = value
})
function date(value: number | null): string {
  return value
    ? new Date(value).toLocaleString(currentLang.value === 'zh' ? 'zh-CN' : 'en-US')
    : '—'
}
function time(value: string | null): string {
  return value?.includes('T') && Number.isFinite(Date.parse(value))
    ? date(Date.parse(value))
    : (value ?? '—')
}
</script>

<template>
  <section class="detail-section">
    <h3>
      {{ name(source.id) }}
      <small v-if="status">{{ status }}</small>
    </h3>
    <p class="source-meta">
      {{ label('Fetched', '获取时间') }} {{ date(source.observedAt) }}
      <span v-if="source.providerAsOf">
        · {{ label('Provider data as of', '厂商数据截至') }} {{ date(source.providerAsOf) }}
      </span>
      <span v-if="source.timeZone">
        · {{ label('Event times shown in your local time zone', '事件时间按本地时区显示') }}
      </span>
    </p>
    <p v-for="key in source.notes" :key="key" class="source-note">{{ note(key) }}</p>
    <p v-if="source.errorCode" role="status" class="source-error">{{ name(source.errorCode) }}</p>
    <div v-if="source.metrics.length" class="detail-metrics">
      <div v-for="(m, index) in source.metrics" :key="index">
        <span>{{ m.label ? `${name(m.key)} · ${m.label}` : name(m.key) }}</span>
        <strong>{{ format(m) }}</strong>
      </div>
    </div>
    <div v-if="categories.length > 1" class="detail-tools">
      <SelectControl
        v-model="category"
        :label="label('Breakdown', '明细分类')"
        :options="[
          { value: 'all', label: label('All categories', '全部分类') },
          ...categories.map((value) => ({ value, label: categoryName(value) })),
        ]"
        compact
      />
    </div>
    <div v-if="visible.length" class="detail-table-wrap">
      <table>
        <thead>
          <tr>
            <th>{{ label('Date / time', '日期／时间') }}</th>
            <th>{{ label('Category / item', '分类／项目') }}</th>
            <th v-for="key in columns" :key="key">{{ name(key) }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in visible" :key="row.id">
            <td>{{ time(row.time) }}</td>
            <td>
              {{
                row.label ? rowLabel(row.label) : row.category ? categoryName(row.category) : '—'
              }}
              <small v-if="row.category?.startsWith('pool:')">
                {{ categoryName(row.category) }}
              </small>
            </td>
            <td v-for="key in columns" :key="key">
              {{
                row.metrics.find((m) => m.key === key)
                  ? format(row.metrics.find((m) => m.key === key)!)
                  : '—'
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-else-if="!source.metrics.length && source.status === 'ok'">
      {{ label('No records returned for this range.', '接口未返回该范围的记录。') }}
    </p>
    <div v-if="source.rows.length" class="detail-tools">
      <span>
        {{ label('Loaded', '已加载') }} {{ source.rows.length }}
        {{ source.totalRows !== null ? `/ ${source.totalRows}` : '' }}
      </span>
      <template v-if="pages > 1">
        <button :disabled="page <= 1" @click="page--">{{ label('Previous', '上一页') }}</button>
        <span>{{ page }} / {{ pages }}</span>
        <button :disabled="page >= pages" @click="page++">{{ label('Next', '下一页') }}</button>
      </template>
      <button v-if="source.nextCursor" :disabled="loading || source.stale" @click="emit('more')">
        {{
          loading ? label('Loading…', '加载中…') : label('Load more from provider', '加载更多记录')
        }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.detail-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
h3 {
  margin: 0 0 8px;
  font-size: 16px;
}
small {
  display: inline-block;
  margin-left: 6px;
  color: var(--text-muted);
  font-weight: normal;
}
.source-meta,
.source-note {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.6;
  margin: 5px 0;
}
.source-error {
  color: var(--danger, #b45309);
  font-size: 13px;
}
.detail-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 16px 0;
}
.detail-metrics div {
  background: var(--surface-alt, var(--bg));
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
}
.detail-metrics span {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.detail-metrics strong {
  font-size: 16px;
  overflow-wrap: anywhere;
}
.detail-table-wrap {
  overflow-x: auto;
  margin-top: 10px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
th {
  color: var(--text-muted);
  font-weight: 500;
}
td:nth-child(2) {
  white-space: normal;
  min-width: 140px;
  max-width: 280px;
  overflow-wrap: anywhere;
}
.detail-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12px;
}
button,
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
