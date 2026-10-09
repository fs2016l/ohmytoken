<script setup lang="ts">
import { computed } from 'vue'
import type { SessionSort } from '@shared/models'
const props = defineProps<{
  options: { key: SessionSort; label: string; heading?: string }[]
  sort: SessionSort
  direction: 'asc' | 'desc'
}>()
const emit = defineEmits<{ sort: [key: SessionSort] }>()
const active = computed(() => props.options.some((option) => option.key === props.sort))
</script>

<template>
  <th :aria-sort="active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'">
    <div class="workspace-sort" :class="{ 'workspace-sort--grouped': options.length > 1 }">
      <span v-if="options.length > 1" class="workspace-sort__heading" aria-hidden="true">
        <template v-for="(option, index) in options" :key="option.key">
          <span v-if="index" class="workspace-sort__separator">/</span>
          <span :class="{ sorted: sort === option.key }">
            {{ option.heading || option.label }}
            <span v-if="sort === option.key" class="workspace-sort__arrow">
              {{ direction === 'asc' ? '↑' : '↓' }}
            </span>
          </span>
        </template>
      </span>
      <span class="workspace-sort__controls">
        <button
          v-for="option in options"
          :key="option.key"
          type="button"
          :class="{ sorted: sort === option.key }"
          :aria-label="option.label"
          :aria-pressed="sort === option.key"
          :data-sort-key="option.key"
          @click="emit('sort', option.key)"
        >
          {{ option.label }}
          <span class="workspace-sort__arrow" aria-hidden="true">
            {{ sort === option.key ? (direction === 'asc' ? '↑' : '↓') : '↕' }}
          </span>
        </button>
      </span>
    </div>
  </th>
</template>

<style scoped>
.workspace-sort {
  position: relative;
  display: flex;
  align-items: center;
  min-height: 30px;
  white-space: nowrap;
}
.workspace-sort__heading,
.workspace-sort__controls {
  display: flex;
  align-items: center;
  gap: 4px;
}
.workspace-sort__controls button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.workspace-sort--grouped .workspace-sort__controls {
  position: absolute;
  inset: 0 auto 0 0;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
}
.workspace-sort--grouped:hover .workspace-sort__heading,
.workspace-sort--grouped:focus-within .workspace-sort__heading {
  visibility: hidden;
}
.workspace-sort--grouped:hover .workspace-sort__controls,
.workspace-sort--grouped:focus-within .workspace-sort__controls {
  opacity: 1;
  pointer-events: auto;
}
.workspace-sort--grouped button {
  padding-inline: 4px;
  margin-left: -4px;
  border-radius: 4px;
}
.workspace-sort--grouped button:hover,
.workspace-sort--grouped button:focus-visible {
  background: var(--primary-soft);
  color: var(--accent);
}
.workspace-sort .sorted {
  color: var(--accent);
}
.workspace-sort__arrow {
  opacity: 0.7;
}
.workspace-sort__separator {
  color: var(--text-soft);
}
</style>
