<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import DropdownChevron from './DropdownChevron.vue'
import SelectionPopover from './SelectionPopover.vue'
import SegmentedControl from './SegmentedControl.vue'
import AgentMark from './AgentMark.vue'
import ModelMark from './ModelMark.vue'
const props = defineProps<{
  label: string
  name?: string
  icon?: string
  optionKind?: 'agent' | 'model'
  options: { value: string; label: string }[]
  favoriteValues?: readonly string[]
}>()
const selected = defineModel<string[]>({ required: true })
const { label: text } = useI18n()
const name = computed(() => props.name || props.label)
const anchor = ref<HTMLButtonElement | null>(null)
const queryInput = ref<HTMLInputElement | null>(null)
const optionsList = ref<HTMLElement | null>(null)
const id = useId()
const open = ref(false)
const query = ref('')
const draft = ref<string[]>([])
const collection = ref<string | number>('all')
const available = computed(() => {
  if (props.favoriteValues === undefined || collection.value !== 'favorites') return props.options
  const favorites = new Set(props.favoriteValues)
  return props.options.filter((item) => favorites.has(item.value))
})
const filtered = computed(() =>
  available.value.filter((item) =>
    item.label.toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase()),
  ),
)
const selectedOptions = computed(() =>
  draft.value.map((value) => ({
    value,
    label: props.options.find((option) => option.value === value)?.label || value,
  })),
)
const selectionLabel = computed(() => (selected.value.length ? name.value : props.label))
const selectionTitle = computed(
  () =>
    selected.value
      .map((value) => props.options.find((option) => option.value === value)?.label || value)
      .join(' · ') || props.label,
)
function toggle(): void {
  if (open.value) {
    open.value = false
    return
  }
  draft.value = [...selected.value]
  query.value = ''
  collection.value = 'all'
  open.value = true
}
function choose(value: string): void {
  draft.value = draft.value.includes(value)
    ? draft.value.filter((item) => item !== value)
    : [...draft.value, value]
}
async function remove(value: string, event: MouseEvent): Promise<void> {
  const row = (event.currentTarget as HTMLElement).closest('.filter-selected-row')
  const next =
    row?.nextElementSibling?.querySelector<HTMLButtonElement>('button') ||
    row?.previousElementSibling?.querySelector<HTMLButtonElement>('button')
  draft.value = draft.value.filter((item) => item !== value)
  await nextTick()
  ;(next || queryInput.value)?.focus()
}
function close(apply = false): void {
  if (apply) selected.value = [...draft.value]
  open.value = false
  anchor.value?.focus()
}
// External navigation owns its new filters; an old draft must not overwrite them.
watch(
  selected,
  () => {
    open.value = false
  },
  { deep: true },
)
watch([collection, query], () => {
  void nextTick(() => optionsList.value?.scrollTo({ top: 0 }))
})
</script>
<template>
  <button
    ref="anchor"
    type="button"
    class="workspace-button filter-select"
    :class="{ 'filter-select--active': selected.length }"
    :aria-expanded="open"
    :aria-label="label"
    :aria-controls="id"
    :title="selectionTitle"
    aria-haspopup="dialog"
    @click="toggle"
  >
    <span v-if="icon" class="material-symbols-outlined" aria-hidden="true">{{ icon }}</span>
    <span class="filter-label">{{ selectionLabel }}</span>
    <span v-if="selected.length" class="filter-count">{{ selected.length }}</span>
    <DropdownChevron :open="open" />
  </button>
  <SelectionPopover
    :id="id"
    v-model="open"
    :anchor="anchor"
    :label="text(`Select ${name}`, `选择${name}`)"
    :width="440"
    :max-height="360"
    class="filter-menu"
    @opened="queryInput?.focus()"
  >
    <header class="filter-menu-header">
      <div>
        <b>{{ text(`Select ${name}`, `选择${name}`) }}</b>
        <button
          type="button"
          class="filter-remove"
          :aria-label="text('Close selector', '关闭选择器')"
          @click="close()"
        >
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <label class="filter-search">
        <span class="material-symbols-outlined" aria-hidden="true">search</span>
        <input
          ref="queryInput"
          v-model="query"
          type="search"
          :placeholder="text(`Search ${name}`, `搜索${name}`)"
          :aria-label="text('Filter options', '搜索选项')"
        />
      </label>
    </header>
    <div
      class="filter-columns"
      :class="{ 'filter-columns--collections': favoriteValues !== undefined }"
    >
      <section class="filter-available">
        <div v-if="favoriteValues !== undefined" class="filter-available-heading">
          <SegmentedControl
            v-model="collection"
            class="filter-collection"
            compact
            appearance="light"
            :label="text(`${name} collection`, `${name}范围`)"
            :options="[
              { value: 'all', label: props.label },
              { value: 'favorites', label: text('Favorites', '收藏夹') },
            ]"
          />
          <span
            class="filter-option-count"
            aria-live="polite"
            :aria-label="text('Available options', '可选项数量')"
          >
            {{ filtered.length }}
          </span>
        </div>
        <h3 v-else>
          {{ query ? text('Results', '搜索结果') : props.label }} · {{ filtered.length }}
        </h3>
        <div ref="optionsList" class="filter-options selection-list">
          <button
            v-for="option in filtered"
            :key="option.value"
            type="button"
            class="filter-option"
            role="checkbox"
            :aria-checked="draft.includes(option.value)"
            :title="option.label"
            @click="choose(option.value)"
          >
            <AgentMark
              v-if="optionKind === 'agent'"
              :agent="option.value"
              class="filter-option-icon"
            />
            <ModelMark
              v-else-if="optionKind === 'model'"
              :model="option.value"
              class="filter-option-icon"
            />
            <span
              v-else-if="icon"
              class="material-symbols-outlined filter-option-icon"
              aria-hidden="true"
            >
              {{ icon }}
            </span>
            <span class="filter-option-label">{{ option.label }}</span>
            <span class="material-symbols-outlined filter-check" aria-hidden="true">check</span>
          </button>
          <p v-if="!filtered.length">
            {{
              collection === 'favorites' && favoriteValues !== undefined && !query.trim()
                ? text('No favorites yet', '暂无收藏项目')
                : text('No matching options', '没有匹配的选项')
            }}
          </p>
        </div>
      </section>
      <section class="filter-selected">
        <h3>
          <span aria-live="polite">{{ text('Selected', '已选') }} · {{ draft.length }}</span>
          <small>{{ text('Added order', '添加顺序') }}</small>
        </h3>
        <ol class="filter-options filter-selected-list selection-list">
          <li
            v-for="option in selectedOptions"
            :key="option.value"
            class="filter-selected-row"
            :data-value="option.value"
            :title="option.label"
          >
            <AgentMark
              v-if="optionKind === 'agent'"
              :agent="option.value"
              class="filter-option-icon"
            />
            <ModelMark
              v-else-if="optionKind === 'model'"
              :model="option.value"
              class="filter-option-icon"
            />
            <span
              v-else-if="icon"
              class="material-symbols-outlined filter-option-icon"
              aria-hidden="true"
            >
              {{ icon }}
            </span>
            <span class="filter-option-label">{{ option.label }}</span>
            <button
              type="button"
              class="filter-remove"
              :aria-label="text(`Remove ${option.label}`, `移除 ${option.label}`)"
              @click="remove(option.value, $event)"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </li>
          <li v-if="!draft.length" class="filter-empty">{{ text('None selected', '尚未选择') }}</li>
        </ol>
      </section>
    </div>
    <footer class="filter-menu-footer">
      <button type="button" class="workspace-link" :disabled="!draft.length" @click="draft = []">
        {{ text('Clear selection', '清空已选') }}
      </button>
      <button type="button" class="workspace-button" @click="close()">
        {{ text('Cancel', '取消') }}
      </button>
      <button type="button" class="workspace-button workspace-button--primary" @click="close(true)">
        {{ text('Apply', '应用') }}
      </button>
    </footer>
  </SelectionPopover>
</template>
<style scoped>
.filter-select {
  width: 144px;
  padding: 0 12px;
  gap: 8px;
}
.filter-label {
  flex: 1;
  min-width: 0;
  text-overflow: ellipsis;
  overflow: hidden;
  text-align: left;
}
.filter-select--active {
  color: var(--accent);
  border-color: var(--primary-border);
}
.filter-count {
  flex: none;
  min-width: 18px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--primary-soft);
  font: 11px/18px var(--font-number);
}
.material-symbols-outlined {
  font-size: 16px;
  flex: none;
}
.filter-menu-header {
  padding: 10px 12px;
  flex: none;
}
.filter-menu-header > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.filter-menu-header b {
  font-size: 13px;
  font-weight: 500;
}
.filter-search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.filter-search:focus-within {
  border-color: var(--primary-border);
  box-shadow: 0 0 0 2px var(--primary-soft);
}
.filter-search input {
  min-width: 0;
  width: 100%;
  height: 28px;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: 13px/20px var(--font-sans);
}
.filter-search input::placeholder {
  color: var(--text-soft);
}
.filter-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
  padding: 0 12px;
}
.filter-columns > section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.filter-available {
  padding-right: 8px;
}
.filter-selected {
  padding-left: 8px;
  border-left: 1px solid var(--border);
}
.filter-available-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex: none;
}
.filter-collection :deep(.selection-option) {
  padding: 0 6px;
}
.filter-option-count {
  flex: none;
  color: var(--text-soft);
  font: 11px/20px var(--font-number);
}
.filter-columns--collections .filter-selected > h3 {
  min-height: var(--control-height-compact);
}
.filter-columns h3 {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 20px;
  font-weight: 500;
}
.filter-columns small {
  font-size: 11px;
  color: var(--text-soft);
  font-weight: 400;
}
.filter-options {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  margin: 0;
  padding: 0;
  list-style: none;
}
.filter-option,
.filter-selected-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  width: 100%;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font: 12px/18px var(--font-sans);
  text-align: left;
}
.filter-option {
  cursor: pointer;
}
.filter-option:hover {
  background: var(--bg-hover);
}
.filter-option[aria-checked='true'] {
  background: var(--primary-soft);
}
.filter-option-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.filter-option-icon {
  color: var(--text-muted);
}
.filter-check {
  color: var(--accent);
  visibility: hidden;
}
.filter-option[aria-checked='true'] .filter-check {
  visibility: visible;
}
.filter-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
}
.filter-remove:hover {
  background: var(--primary-soft);
  color: var(--primary-soft-text);
}
.filter-selected-row {
  padding-right: 0;
}
.filter-options p,
.filter-empty {
  padding: 8px 4px;
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}
.filter-menu-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  margin-top: 8px;
  flex: none;
}
.filter-menu-footer > .workspace-link {
  margin-right: auto;
  font-size: 12px;
}
.filter-menu-footer > .workspace-link:disabled {
  opacity: 0.45;
  cursor: default;
}
.filter-menu-footer > .workspace-button {
  height: var(--control-height-compact);
  padding: 0 10px;
  border-radius: var(--control-radius-compact);
  font-size: 12px;
}
</style>
