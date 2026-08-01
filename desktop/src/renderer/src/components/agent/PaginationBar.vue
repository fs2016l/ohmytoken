<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../i18n/useI18n'

interface Props {
  page: number
  pageSize: number
  total: number
  disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  changePage: [page: number]
  changePageSize: [pageSize: number]
}>()
const { label } = useI18n()
const pageSizeOptions = [10, 20, 50, 100]

const totalPages = computed(() => (props.total > 0 ? Math.ceil(props.total / props.pageSize) : 0))
const rangeStart = computed(() => (props.total > 0 ? (props.page - 1) * props.pageSize + 1 : 0))
const rangeEnd = computed(() => Math.min(props.total, props.page * props.pageSize))
const pageNumbers = computed(() => {
  const count = totalPages.value
  if (count <= 5) return Array.from({ length: count }, (_, index) => index + 1)
  let start = Math.max(1, props.page - 2)
  const end = Math.min(count, start + 4)
  start = Math.max(1, end - 4)
  return Array.from({ length: end - start + 1 }, (_, index) => start + index)
})

function goToPage(page: number): void {
  if (props.disabled || totalPages.value === 0) return
  const next = Math.min(Math.max(1, page), totalPages.value)
  if (next !== props.page) emit('changePage', next)
}

function changePageSize(event: Event): void {
  const value = Number((event.target as HTMLSelectElement).value)
  if (Number.isFinite(value) && value > 0) emit('changePageSize', value)
}
</script>

<template>
  <div v-if="total > 0" class="pagination-bar">
    <span class="pagination-summary">
      {{
        label(
          rangeStart + '-' + rangeEnd + ' of ' + total,
          '第 ' + rangeStart + '-' + rangeEnd + ' 条，共 ' + total + ' 条',
        )
      }}
    </span>
    <div class="pagination-controls">
      <button
        type="button"
        :disabled="disabled || page <= 1"
        :aria-label="label('First page', '第一页')"
        @click="goToPage(1)"
      >
        «
      </button>
      <button
        type="button"
        :disabled="disabled || page <= 1"
        :aria-label="label('Previous page', '上一页')"
        @click="goToPage(page - 1)"
      >
        ‹
      </button>
      <button
        v-for="pageNumber in pageNumbers"
        :key="pageNumber"
        type="button"
        :class="{ active: pageNumber === page }"
        :disabled="disabled"
        :aria-current="pageNumber === page ? 'page' : undefined"
        @click="goToPage(pageNumber)"
      >
        {{ pageNumber }}
      </button>
      <button
        type="button"
        :disabled="disabled || page >= totalPages"
        :aria-label="label('Next page', '下一页')"
        @click="goToPage(page + 1)"
      >
        ›
      </button>
      <button
        type="button"
        :disabled="disabled || page >= totalPages"
        :aria-label="label('Last page', '最后一页')"
        @click="goToPage(totalPages)"
      >
        »
      </button>
    </div>
    <label class="page-size-control">
      <span>{{ label('Per page', '每页') }}</span>
      <select :value="pageSize" :disabled="disabled" @change="changePageSize">
        <option v-for="option in pageSizeOptions" :key="option" :value="option">
          {{ option }}
        </option>
      </select>
    </label>
  </div>
</template>

<style scoped>
.pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding: 12px 20px 16px;
  color: var(--text-soft);
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.pagination-controls {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pagination-controls button {
  min-width: 30px;
  height: 30px;
  padding: 0 7px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.pagination-controls button:hover:not(:disabled),
.pagination-controls button.active {
  color: var(--primary-on);
  background: var(--primary);
  border-color: var(--primary);
}

.pagination-controls button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.page-size-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.page-size-control select {
  height: 30px;
  padding: 0 24px 0 8px;
  color: var(--text-muted);
  background: var(--bg-base);
  border: 1px solid var(--border);
  border-radius: 6px;
}

@media (max-width: 640px) {
  .pagination-bar {
    justify-content: center;
    padding-right: 12px;
    padding-left: 12px;
  }

  .pagination-summary {
    width: 100%;
    text-align: center;
  }
}
</style>
