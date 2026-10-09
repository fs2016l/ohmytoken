<script setup lang="ts">
import { computed } from 'vue'
import SelectControl from './SelectControl.vue'
import { useI18n } from '../../i18n/useI18n'
import { formatNumber } from '../../utils/number-format'
const props = defineProps<{ page: number; pageSize: number; total: number; busy?: boolean }>()
const emit = defineEmits<{ 'update:page': [value: number]; 'update:pageSize': [value: number] }>()
const { label } = useI18n()
const count = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const pages = computed(() => {
  const values = new Set([1, count.value, props.page - 1, props.page, props.page + 1])
  return [...values].filter((p) => p >= 1 && p <= count.value).sort((a, b) => a - b)
})
function setSize(value: number): void {
  emit('update:pageSize', value)
  emit('update:page', 1)
}
</script>
<template>
  <div class="pagination-bar">
    <span>
      {{
        label(
          `${formatNumber(total, { decimals: 0 })} results`,
          `共 ${formatNumber(total, { decimals: 0 })} 条`,
        )
      }}
    </span>
    <div class="pagination-actions">
      <button
        type="button"
        :disabled="page <= 1 || busy"
        :aria-label="label('Previous page', '上一页')"
        @click="emit('update:page', page - 1)"
      >
        ‹
      </button>
      <template v-for="(value, index) in pages" :key="value">
        <span v-if="index > 0 && value - pages[index - 1]! > 1" class="pagination-gap">…</span>
        <button
          type="button"
          :class="{ selected: value === page }"
          :aria-current="value === page ? 'page' : undefined"
          :disabled="busy"
          @click="emit('update:page', value)"
        >
          {{ value }}
        </button>
      </template>
      <button
        type="button"
        :disabled="page >= count || busy"
        :aria-label="label('Next page', '下一页')"
        @click="emit('update:page', page + 1)"
      >
        ›
      </button>
    </div>
    <label class="pagination-size">
      {{ label('Per page', '每页') }}
      <SelectControl
        :model-value="pageSize"
        :disabled="busy"
        :label="label('Per page', '每页条数')"
        :options="
          [10, 20, 50, 100].map((value) => ({
            value,
            label: label(`${value}`, `${value} 条`),
          }))
        "
        compact
        placement="top"
        @update:model-value="setSize"
      />
    </label>
  </div>
</template>
<style scoped>
.pagination-bar {
  display: grid;
  grid-template-columns: minmax(max-content, 1fr) auto minmax(max-content, 1fr);
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface-low);
  color: var(--text-muted);
  font-size: 13px;
  border-radius: 0 0 12px 12px;
}
.pagination-actions,
.pagination-size {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pagination-size {
  justify-self: end;
  white-space: nowrap;
}
.pagination-actions {
  justify-content: center;
  flex-wrap: wrap;
}
.pagination-actions button {
  min-width: 28px;
  height: 28px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  background: transparent;
  font: inherit;
  cursor: pointer;
}
.pagination-actions button:hover:not(:disabled),
.pagination-actions button.selected {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
  border-color: var(--primary-border);
}
.pagination-actions button:disabled {
  opacity: 0.4;
  cursor: default;
}
.pagination-gap {
  padding: 0 2px;
}
</style>
