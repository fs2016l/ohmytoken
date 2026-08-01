<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import { agentColors, agentNames } from '../../config/agents'
import { formatTokens } from '../../utils/format'
import PaginationBar from './PaginationBar.vue'
import type { ModelFilter } from '../../composables/useAgentStats'
import type { ModelStats } from '@shared/models'

interface Props {
  models: ModelStats[]
  modelFilter: ModelFilter
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:modelFilter': [value: ModelFilter]
  openAgent: [agent: string]
}>()

const { tr } = useI18n()
const page = ref(1)
const pageSize = ref(20)
const pagedModels = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return props.models.slice(start, start + pageSize.value)
})

watch(
  () => props.modelFilter,
  () => {
    page.value = 1
  },
)
watch(
  () => props.models.length,
  (total) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize.value))
    if (page.value > totalPages) page.value = totalPages
  },
)

function changePageSize(value: number): void {
  pageSize.value = value
  page.value = 1
}

function modelAgents(model: ModelStats): string[] {
  return Object.keys(model.agentTokens || {})
}
</script>

<template>
  <section class="panel table-panel">
    <div class="table-tools">
      <div>
        <h3>{{ tr('modelDetailsTitle') }}</h3>
        <p>{{ tr('modelDetailsSubtitle') }}</p>
      </div>
      <div class="table-actions">
        <div class="filter-chips">
          <button
            :class="{ active: modelFilter === 'all' }"
            type="button"
            @click="emit('update:modelFilter', 'all')"
          >
            {{ tr('all') }}
          </button>
          <button
            :class="{ active: modelFilter === 'with-data' }"
            type="button"
            @click="emit('update:modelFilter', 'with-data')"
          >
            {{ tr('withData') }}
          </button>
        </div>
      </div>
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>{{ tr('model') }}</th>
            <th>{{ tr('agents') }}</th>
            <th class="right">{{ tr('totalTokensCol') }}</th>
            <th class="right">{{ tr('inputTokens') }}</th>
            <th class="right">{{ tr('outputTokens') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="model in pagedModels"
            :key="model.model"
            :class="{ muted: model.totalTokens === 0 }"
          >
            <td class="model-name">
              {{ model.model }}
              <span v-if="model.totalTokens === 0" class="no-data-tag">{{ tr('noData') }}</span>
            </td>
            <td>
              <button
                v-for="agent in modelAgents(model)"
                :key="agent"
                class="agent-badge"
                :style="{
                  color: agentColors[agent] || '#cbc3d7',
                  borderColor: (agentColors[agent] || '#cbc3d7') + '66',
                  backgroundColor: (agentColors[agent] || '#cbc3d7') + '18',
                }"
                type="button"
                @click="emit('openAgent', agent)"
              >
                {{ agentNames[agent] || agent }}
              </button>
            </td>
            <td class="right token-total">{{ formatTokens(model.totalTokens) }}</td>
            <td class="right">{{ formatTokens(model.inputTokens) }}</td>
            <td class="right">{{ formatTokens(model.outputTokens) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <PaginationBar
      :page="page"
      :page-size="pageSize"
      :total="models.length"
      @change-page="page = $event"
      @change-page-size="changePageSize"
    />
  </section>
</template>

<style scoped>
.panel {
  min-width: 0;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
}

.table-panel {
  padding: 0;
  overflow: hidden;
}

.table-tools {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid var(--border);
}

.table-tools h3 {
  margin: 0;
  color: var(--text);
  font-size: 24px;
  line-height: 32px;
  font-weight: var(--weight-semibold);
}

.table-tools p {
  margin: 0;
  color: var(--text-soft);
  font-size: 12px;
  line-height: 18px;
}

.table-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.filter-chips {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.filter-chips button {
  min-height: 30px;
  padding: 0 10px;
  color: var(--text-muted);
  background: transparent;
  border: 0;
  border-radius: 6px;
}

.filter-chips button.active {
  color: var(--primary-on);
  background: var(--primary);
  font-weight: var(--weight-semibold);
}

.table-wrapper {
  overflow-x: auto;
}

.table-wrapper::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.table-wrapper::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 999px;
}

.table-wrapper table {
  table-layout: fixed;
  width: 100%;
}

.table-wrapper th,
.table-wrapper td {
  width: 20%;
}

table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

th {
  padding: 12px 16px;
  color: var(--text-soft);
  background: var(--bg-base);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-sans);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  text-align: left;
  text-transform: uppercase;
}

td {
  padding: 12px 16px;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}

tbody tr:hover td {
  background: var(--surface-container);
}

.right {
  text-align: right;
}

.token-total {
  color: var(--primary);
}

.model-name {
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: var(--weight-semibold);
}

.muted {
  opacity: 0.56;
}

.no-data-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 2px 6px;
  color: var(--text-soft);
  background: rgba(149, 142, 160, 0.12);
  border-radius: 4px;
  font-family: var(--font-sans);
  font-size: var(--type-caption);
}

.agent-badge {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  margin: 2px 4px 2px 0;
  padding: 0 8px;
  border: 1px solid;
  border-radius: 6px;
  font-size: 12px;
  background: transparent;
}

.agent-badge:hover {
  filter: brightness(1.18);
}

@media (max-width: 820px) {
  .table-tools,
  .table-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
