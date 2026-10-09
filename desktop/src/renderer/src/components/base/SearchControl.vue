<script setup lang="ts">
import { useI18n } from '../../i18n/useI18n'
const query = defineModel<string>({ required: true })
defineProps<{ placeholder: string }>()
const emit = defineEmits<{ search: [] }>()
const { label } = useI18n()
function clearSearch(): void {
  query.value = ''
  emit('search')
}
</script>
<template>
  <form class="search-control" role="search" @submit.prevent="emit('search')">
    <span class="material-symbols-outlined" aria-hidden="true">search</span>
    <input v-model="query" type="search" :placeholder="placeholder" :aria-label="placeholder" />
    <button
      v-if="query"
      type="button"
      class="search-clear"
      :aria-label="label('Clear search', '清除搜索')"
      @click="clearSearch"
    >
      ×
    </button>
    <button type="submit" class="search-submit">{{ label('Search', '搜索') }}</button>
  </form>
</template>
<style scoped>
.search-control {
  display: flex;
  align-items: center;
  height: 36px;
  width: 328px;
  min-width: 220px;
  border: 1px solid var(--border);
  background: var(--surface-low);
  border-radius: 8px;
  overflow: hidden;
}
.search-control:focus-within {
  border-color: var(--text-muted);
}
.material-symbols-outlined {
  margin-left: 12px;
  font-size: 16px;
  color: var(--text-muted);
}
input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  padding: 0 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
input::-webkit-search-cancel-button {
  appearance: none;
}
input::placeholder {
  color: var(--text-soft);
}
button {
  border: 0;
  cursor: pointer;
  height: 100%;
  font: inherit;
  font-size: 13px;
}
.search-clear {
  background: transparent;
  color: var(--text-soft);
  padding: 0 8px;
  font-size: 18px;
}
.search-submit {
  padding: 0 16px;
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.search-submit:hover {
  background: var(--primary-border);
}
</style>
