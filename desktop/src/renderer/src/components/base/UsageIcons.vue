<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import IconStack from './IconStack.vue'
import { iconGroups, iconStackLayout } from '../../utils/icon-stack-layout'
import { useI18n } from '../../i18n/useI18n'

const props = withDefaults(
  defineProps<{
    items: string[]
    kind: 'agents' | 'models'
    totals?: Record<string, number>
    maxWidth?: number
  }>(),
  { maxWidth: 144, totals: undefined },
)
const { label } = useI18n()
const row = ref<HTMLElement | null>(null)
const stack = ref<InstanceType<typeof IconStack> | null>(null)
const width = ref(props.maxWidth)
const items = computed(() => [...new Set(props.items.filter((item) => item && item !== '—'))])
const groups = computed(() => iconGroups(items.value, props.kind))
const singleLabel = computed(() => (groups.value.length === 1 ? groups.value[0].names[0] : ''))
const countLabel = computed(() =>
  props.kind === 'agents'
    ? label(`${items.value.length} Agents`, `${items.value.length} 个 Agent`)
    : label(`${items.value.length} models`, `${items.value.length} 个模型`),
)
const stripWidth = computed(() => Math.min(96, width.value))
const showCount = computed(
  () =>
    items.value.length >
    iconStackLayout(groups.value.length, 16, items.value.length, stripWidth.value).visibleCount,
)
const iconWidth = computed(() =>
  Math.min(
    stripWidth.value,
    Math.max(
      18,
      width.value -
        (showCount.value ? Math.max(18, String(items.value.length).length * 7 + 10) + 6 : 0),
    ),
  ),
)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!row.value) return
  observer = new ResizeObserver(([entry]) => {
    width.value = entry.contentRect.width
  })
  observer.observe(row.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <span
    ref="row"
    class="usage-icons"
    :style="{ maxWidth: `${maxWidth}px` }"
    @pointerenter="stack?.enter($event)"
    @pointermove="stack?.move($event)"
    @pointerleave="stack?.leave()"
    @pointerdown="stack?.dismiss()"
  >
    <template v-if="groups.length">
      <IconStack
        ref="stack"
        :kind="kind"
        :items="items"
        :max="items.length"
        :max-width="iconWidth"
        show-all-on-hover
        preserve-item-order
        :agent-totals="kind === 'agents' ? totals : undefined"
        :model-totals="kind === 'models' ? totals : undefined"
      />
      <span v-if="singleLabel" class="usage-icon-name">
        {{ singleLabel }}
      </span>
      <span v-if="showCount" class="usage-icon-count" :aria-label="countLabel">
        {{ items.length }}
      </span>
    </template>
    <span v-else class="usage-icon-empty">—</span>
  </span>
</template>

<style scoped>
.usage-icons {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 22px;
  text-align: left;
  font-size: 11px;
  line-height: 18px;
}
.usage-icon-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.usage-icon-count {
  flex: none;
  min-width: 16px;
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-low);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  line-height: 16px;
  text-align: center;
}
.usage-icon-empty {
  color: var(--text-soft);
}
</style>
