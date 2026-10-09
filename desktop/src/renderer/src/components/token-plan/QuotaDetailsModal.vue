<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import type { TokenPlanConnection } from '../../../../shared/token-plan'
import type { QuotaDetails, QuotaDetailSource } from '../../../../shared/quota-details'
import { useBodyScrollLock } from '../../composables/useBodyScrollLock'
import { useI18n } from '../../i18n/useI18n'
import QuotaDetailSection from './QuotaDetailSection.vue'
const props = defineProps<{ connection: TokenPlanConnection }>()
const emit = defineEmits<{ close: [] }>()
const { label } = useI18n()
useBodyScrollLock(() => true)
const day = (offset: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const start = ref(day(-6)),
  end = ref(day(0))
const data = ref<QuotaDetails | null>(null),
  loading = ref(false),
  error = ref(''),
  more = ref('')
const dialog = ref<HTMLElement | null>(null)
let generation = 0
const previousFocus =
  typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
async function load(force = false): Promise<void> {
  const seq = ++generation
  const from = start.value,
    to = end.value
  if (!from || !to || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
    error.value = label('Choose a range of up to 31 days.', '请选择最多 31 天的日期范围。')
    return
  }
  loading.value = true
  error.value = ''
  more.value = ''
  if (data.value?.startDate !== from || data.value?.endDate !== to) data.value = null
  try {
    const result = await window.api.tokenPlanDetailsQuery(props.connection.id, {
      startDate: from,
      endDate: to,
      force,
    })
    if (seq === generation) data.value = result
  } catch {
    if (seq === generation)
      error.value = label(
        'Could not read account details. Detect the connection again or retry.',
        '暂时无法读取详情，请重新检测连接或稍后重试。',
      )
  } finally {
    if (seq === generation) loading.value = false
  }
}
function preset(days: number): void {
  start.value = day(1 - days)
  end.value = day(0)
  void load()
}
async function loadMore(source: QuotaDetailSource): Promise<void> {
  if (!data.value || !source.nextCursor || more.value) return
  const seq = generation,
    current = data.value
  more.value = source.id
  error.value = ''
  try {
    const result = await window.api.tokenPlanDetailsQuery(props.connection.id, {
      startDate: current.startDate,
      endDate: current.endDate,
      source: source.id,
      cursor: source.nextCursor,
    })
    if (seq !== generation) return
    const next = result.sources[0]
    if (next.errorCode) {
      error.value = label(
        'The next page could not be loaded. Existing records are retained.',
        '下一页加载失败，已保留当前记录。',
      )
      return
    }
    const ids = new Set(source.rows.map((row) => row.id))
    const index = current.sources.findIndex((row) => row.id === source.id)
    current.sources[index] = {
      ...next,
      rows: [...source.rows, ...next.rows.filter((row) => !ids.has(row.id))],
    }
  } catch {
    if (seq === generation) error.value = label('Could not load the next page.', '下一页加载失败。')
  } finally {
    if (seq === generation) more.value = ''
  }
}
function keydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
  if (event.key !== 'Tab' || !dialog.value) return
  const nodes = [
    ...dialog.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, select, [tabindex="0"]',
    ),
  ]
  const first = nodes[0],
    last = nodes.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
onMounted(() => {
  dialog.value?.focus()
  document.addEventListener('keydown', keydown)
  void load()
})
onUnmounted(() => {
  generation++
  document.removeEventListener('keydown', keydown)
  previousFocus?.focus()
})
</script>

<template>
  <div class="quota-detail-overlay" @click.self="emit('close')">
    <div
      ref="dialog"
      class="quota-detail-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-detail-title"
      tabindex="-1"
    >
      <header>
        <div>
          <h2 id="quota-detail-title">{{ label('Account usage details', '账户用量详情') }}</h2>
          <p>
            {{ connection.accountLabel || connection.providerId }} ·
            {{ connection.sources.join(' · ') }}
          </p>
        </div>
        <button :aria-label="label('Close', '关闭')" @click="emit('close')">×</button>
      </header>
      <div class="detail-range">
        <button :disabled="loading" @click="preset(7)">{{ label('7 days', '近 7 天') }}</button>
        <button :disabled="loading" @click="preset(30)">{{ label('30 days', '近 30 天') }}</button>
        <input v-model="start" type="date" :aria-label="label('Start date', '开始日期')" />
        <span>—</span>
        <input v-model="end" type="date" :aria-label="label('End date', '结束日期')" />
        <button :disabled="loading" @click="load(true)">
          {{ label('Query / refresh', '查询／刷新') }}
        </button>
      </div>
      <p v-if="loading" role="status">{{ label('Reading provider data…', '正在读取厂商数据…') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <QuotaDetailSection
        v-for="source in data?.sources ?? []"
        :key="source.id"
        :source="source"
        :loading="more === source.id"
        @more="loadMore(source)"
      />
    </div>
  </div>
</template>

<style scoped>
.quota-detail-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #11182766;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.quota-detail-dialog {
  width: min(1180px, 100%);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 18px;
  padding: 24px;
  box-shadow: 0 20px 80px #0003;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}
h2 {
  margin: 0;
  font-size: 20px;
}
header p {
  color: var(--text-muted);
  font-size: 12px;
}
header button {
  font-size: 24px;
}
.detail-range {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
button,
input {
  padding: 8px 12px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 8px;
}
button {
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
}
@media (max-width: 700px) {
  .quota-detail-overlay {
    padding: 8px;
  }
  .quota-detail-dialog {
    padding: 16px;
    max-height: calc(100vh - 16px);
  }
}
</style>
