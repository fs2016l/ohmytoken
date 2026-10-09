<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { iconGroups, iconStackLayout, type IconGroup } from '../../utils/icon-stack-layout'
import { useI18n } from '../../i18n/useI18n'
import { formatTokens } from '../../utils/format'
import type { ChartTooltipData } from '../../utils/chart-tooltip'
import AgentMark from './AgentMark.vue'
import ModelMark from './ModelMark.vue'
import PointerTooltip from './PointerTooltip.vue'

const props = withDefaults(
  defineProps<{
    items: string[]
    kind: 'agents' | 'models'
    size?: number
    max?: number
    maxWidth?: number
    showAllOnHover?: boolean
    preserveItemOrder?: boolean
    modelTotals?: Record<string, number>
    agentTotals?: Record<string, number>
  }>(),
  {
    size: 16,
    max: 3,
    maxWidth: undefined,
    showAllOnHover: false,
    preserveItemOrder: false,
    modelTotals: undefined,
    agentTotals: undefined,
  },
)

const { label } = useI18n()
const tooltipId = useId()
const stackItems = computed(() => iconGroups(props.items, props.kind))
const layout = computed(() =>
  iconStackLayout(stackItems.value.length, props.size, props.max, props.maxWidth),
)
const visibleItems = computed(() => stackItems.value.slice(0, layout.value.visibleCount))
const activeIndex = ref<number | null>(null)
const hoveredItem = ref<IconGroup | null>(null)
const tooltipPoint = ref<{ x: number; y: number } | null>(null)
const tooltipContent = computed<ChartTooltipData | null>(() => {
  const group = hoveredItem.value
  const totals = props.kind === 'models' ? props.modelTotals : props.agentTotals
  if (!group) return null
  const tokensFor = (name: string): number =>
    totals?.[props.kind === 'agents' ? group.icon : name] ?? 0
  const names = props.preserveItemOrder
    ? group.names
    : [...group.names].sort((a, b) => tokensFor(b) - tokensFor(a) || a.localeCompare(b))
  const shown = names.slice(0, 16)
  return {
    title:
      props.kind === 'models'
        ? label('Model usage', '模型用量')
        : label('Agent usage', 'Agent 用量'),
    summary: totals
      ? {
          label: label('Total tokens', 'Token 总量'),
          value: formatTokens(names.reduce((sum, name) => sum + tokensFor(name), 0)),
        }
      : undefined,
    rows: shown.map((name) => ({
      label: name,
      value: totals ? formatTokens(tokensFor(name)) : '',
    })),
    note:
      names.length > shown.length
        ? label(
            `${names.length - shown.length} more models share this icon`,
            `另有 ${names.length - shown.length} 个模型共用此图标`,
          )
        : undefined,
  }
})
const stackElement = ref<HTMLElement | null>(null)
const allIconsElement = ref<HTMLElement | null>(null)
const allIconsOpen = ref(false)
const allIconsPositioned = ref(false)
const allIconsPosition = ref({
  left: 0,
  top: 0,
  arrowLeft: 0,
  gridMaxHeight: 220,
  above: false,
})
const itemLabel = (item: IconGroup): string => item.names.join(' · ')
const needsGrid = computed(
  () =>
    stackItems.value.length > visibleItems.value.length ||
    (props.showAllOnHover && stackItems.value.length > 1) ||
    (layout.value.bounded && layout.value.overlapping),
)
const gridColumns = computed(() => Math.min(5, stackItems.value.length))
const tileSize = computed(() => Math.max(26, props.size + 10))
const gridWidth = computed(
  () => gridColumns.value * tileSize.value + (gridColumns.value - 1) * 5 + 22,
)
const stackStyle = computed(() => {
  return {
    '--stack-card-size': `${layout.value.cardSize}px`,
    '--stack-rest-width': `${layout.value.restWidth}px`,
    '--stack-open-width': `${layout.value.openWidth}px`,
    '--stack-active-layer': visibleItems.value.length + 1,
    '--stack-lift': `-${Math.max(3, Math.round(props.size / 4))}px`,
  }
})
const cardStyle = (index: number) => ({
  '--stack-left': `${index * layout.value.restStep}px`,
  '--stack-open-left': `${index * layout.value.openStep}px`,
  '--stack-layer': visibleItems.value.length - index,
})

let closeTimer: number | undefined

function cancelClose(): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  closeTimer = undefined
}

function removePositionListeners(): void {
  window.removeEventListener('resize', positionAllIcons)
  window.removeEventListener('scroll', positionAllIcons, true)
  window.removeEventListener('blur', closeAllIcons)
}

function closeAllIcons(): void {
  cancelClose()
  allIconsOpen.value = false
  allIconsPositioned.value = false
  hideItemTooltip()
  removePositionListeners()
}

function hideItemTooltip(): void {
  hoveredItem.value = null
  tooltipPoint.value = null
}

function showItemTooltip(item: IconGroup, event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  hoveredItem.value = item
  tooltipPoint.value = { x: event.clientX, y: event.clientY }
}

function scheduleClose(): void {
  if (!allIconsOpen.value) return
  cancelClose()
  closeTimer = window.setTimeout(closeAllIcons, 140)
}

function positionAllIcons(): void {
  const anchor = stackElement.value?.getBoundingClientRect()
  const panel = allIconsElement.value
  if (!anchor || !panel) return
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
    closeAllIcons()
    return
  }
  const edge = 8
  const gap = 8
  const grid = panel.querySelector<HTMLElement>('.icon-stack__all-grid')
  const naturalHeight = Math.min(240, (grid?.scrollHeight ?? panel.offsetHeight - 20) + 20)
  const roomBelow = window.innerHeight - edge - anchor.bottom - gap
  const roomAbove = anchor.top - edge - gap
  const above = naturalHeight > roomBelow && roomAbove > roomBelow
  const gridMaxHeight = Math.max(26, Math.min(220, (above ? roomAbove : roomBelow) - 20))
  panel.style.setProperty('--stack-grid-max-height', `${gridMaxHeight}px`)
  const width = panel.offsetWidth
  const height = panel.offsetHeight
  const left = Math.max(edge, Math.min(anchor.left, window.innerWidth - width - edge))
  const top = above
    ? Math.max(edge, anchor.top - height - gap)
    : Math.min(anchor.bottom + gap, window.innerHeight - height - edge)
  const expandedWidth = layout.value.openWidth
  const arrowLeft = Math.max(12, Math.min(anchor.left + expandedWidth / 2 - left - 5, width - 22))
  allIconsPosition.value = { left, top, arrowLeft, gridMaxHeight, above }
  allIconsPositioned.value = true
}

async function openAllIcons(): Promise<void> {
  if (!needsGrid.value) return
  cancelClose()
  if (allIconsOpen.value) return
  allIconsPositioned.value = false
  allIconsOpen.value = true
  await nextTick()
  if (!allIconsOpen.value) return
  positionAllIcons()
  window.addEventListener('resize', positionAllIcons)
  window.addEventListener('scroll', positionAllIcons, true)
  window.addEventListener('blur', closeAllIcons)
}

function enterStack(event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  trackPointer(event)
  void openAllIcons()
}

function leaveStack(): void {
  activeIndex.value = null
  hideItemTooltip()
  scheduleClose()
}

function leaveAllIcons(): void {
  hideItemTooltip()
  scheduleClose()
}

watch(stackItems, async () => {
  hideItemTooltip()
  if (!allIconsOpen.value) return
  if (!needsGrid.value) {
    closeAllIcons()
    return
  }
  await nextTick()
  positionAllIcons()
})

onBeforeUnmount(closeAllIcons)

watch(needsGrid, (needed) => {
  if (!needed) closeAllIcons()
})

watch(layout, async () => {
  if (!allIconsOpen.value) return
  await nextTick()
  positionAllIcons()
})

function trackPointer(event: PointerEvent): void {
  if (event.pointerType === 'touch') return
  const target = document.elementFromPoint(event.clientX, event.clientY)
  const card = target?.closest<HTMLElement>('.icon-stack__card')
  if (card?.parentElement !== stackElement.value) {
    activeIndex.value = null
    if (stackItems.value.length === 1) showItemTooltip(stackItems.value[0], event)
    else hideItemTooltip()
    return
  }
  const index = Number(card.dataset.stackIndex)
  activeIndex.value = index
  const item = visibleItems.value[index]
  if (item) showItemTooltip(item, event)
}

defineExpose({
  enter: enterStack,
  move: trackPointer,
  leave: leaveStack,
  dismiss: closeAllIcons,
})
</script>

<template>
  <span
    v-if="visibleItems.length"
    ref="stackElement"
    class="icon-stack"
    :class="{
      'icon-stack--multiple': visibleItems.length > 1,
      'icon-stack--overlapping': layout.overlapping,
    }"
    role="img"
    :aria-label="stackItems.map(itemLabel).join(' · ')"
    :aria-describedby="tooltipContent ? tooltipId : undefined"
    :style="stackStyle"
    @pointerenter="enterStack"
    @pointermove="trackPointer"
    @pointerleave="leaveStack"
    @pointerdown="closeAllIcons"
    @dragstart.prevent
  >
    <span
      v-for="(item, index) in visibleItems"
      :key="`${item.icon}:${index}`"
      class="icon-stack__card"
      :class="{ 'icon-stack__card--active': activeIndex === index }"
      :data-stack-index="index"
      aria-hidden="true"
      :style="cardStyle(index)"
      @pointerenter="showItemTooltip(item, $event)"
    >
      <AgentMark v-if="kind === 'agents'" :agent="item.icon" :size="size" />
      <ModelMark v-else :model="item.icon" :size="size" />
    </span>
  </span>
  <Teleport to="body">
    <Transition name="icon-stack-pop">
      <div
        v-if="allIconsOpen"
        ref="allIconsElement"
        class="icon-stack__all"
        :class="{
          'icon-stack__all--positioned': allIconsPositioned,
          'icon-stack__all--above': allIconsPosition.above,
        }"
        :style="{
          left: `${allIconsPosition.left}px`,
          top: `${allIconsPosition.top}px`,
          '--stack-arrow-left': `${allIconsPosition.arrowLeft}px`,
          '--stack-grid-max-height': `${allIconsPosition.gridMaxHeight}px`,
        }"
        aria-hidden="true"
        @pointerenter="cancelClose"
        @pointerleave="leaveAllIcons"
        @dragstart.prevent
      >
        <span
          class="icon-stack__all-grid"
          :style="{
            gridTemplateColumns: `repeat(${gridColumns}, ${tileSize}px)`,
            width: `${gridWidth}px`,
          }"
        >
          <span
            v-for="(item, index) in stackItems"
            :key="`${item.icon}:${index}`"
            class="icon-stack__all-card"
            @pointerenter="showItemTooltip(item, $event)"
            @pointerleave="hideItemTooltip"
          >
            <AgentMark v-if="kind === 'agents'" :agent="item.icon" :size="Math.max(16, size)" />
            <ModelMark v-else :model="item.icon" :size="Math.max(16, size)" />
          </span>
        </span>
      </div>
    </Transition>
  </Teleport>
  <PointerTooltip
    :id="tooltipId"
    :content="tooltipContent"
    :point="tooltipPoint"
    :z-index="5001"
    @dismiss="hideItemTooltip"
  />
</template>

<style scoped>
.icon-stack {
  display: inline-block;
  position: relative;
  isolation: isolate;
  z-index: 1;
  flex: none;
  width: var(--stack-rest-width);
  height: var(--stack-card-size);
  vertical-align: middle;
  transition: width var(--motion-hover) var(--motion-ease);
}
.icon-stack--multiple:hover {
  z-index: 2;
  width: var(--stack-open-width);
}
.icon-stack__card {
  position: absolute;
  z-index: var(--stack-layer);
  top: 0;
  left: var(--stack-left);
  display: grid;
  place-items: center;
  width: var(--stack-card-size);
  height: var(--stack-card-size);
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 12%, transparent);
  transition:
    left var(--motion-hover) var(--motion-ease),
    transform var(--motion-hover) var(--motion-ease),
    box-shadow var(--motion-hover) var(--motion-ease);
}
.icon-stack--multiple:hover .icon-stack__card {
  left: var(--stack-open-left);
}
.icon-stack--multiple .icon-stack__card--active {
  z-index: var(--stack-active-layer);
  transform: translateY(var(--stack-lift)) rotate(6deg) scale(1.12);
  box-shadow:
    0 0 0 2px var(--primary-soft),
    0 5px 12px color-mix(in srgb, var(--primary) 27%, transparent);
}
.icon-stack__all {
  position: fixed;
  z-index: 5000;
  max-width: calc(100vw - 16px);
  overflow: visible;
  padding: 9px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 12px 30px color-mix(in srgb, var(--text) 20%, transparent);
  visibility: hidden;
  pointer-events: none;
}
.icon-stack__all::before {
  content: '';
  position: absolute;
  z-index: 1;
  top: -6px;
  left: var(--stack-arrow-left);
  box-sizing: border-box;
  width: 11px;
  height: 11px;
  border: 1px solid var(--border);
  border-right: 0;
  border-bottom: 0;
  background: var(--surface);
  transform: rotate(45deg);
  pointer-events: none;
}
.icon-stack__all--above::before {
  top: auto;
  bottom: -6px;
  border: 1px solid var(--border);
  border-top: 0;
  border-left: 0;
}
.icon-stack__all--positioned {
  visibility: visible;
  pointer-events: auto;
}
.icon-stack__all-grid {
  box-sizing: border-box;
  display: grid;
  gap: 5px;
  max-height: var(--stack-grid-max-height, 220px);
  padding: 4px 5px 6px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
.icon-stack__all-card {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-low);
  transition:
    transform var(--motion-hover) var(--motion-ease),
    box-shadow var(--motion-hover) var(--motion-ease);
}
.icon-stack__all-card:hover {
  z-index: 1;
  transform: translateY(-3px) rotate(6deg) scale(1.08);
  box-shadow: 0 5px 12px color-mix(in srgb, var(--primary) 24%, transparent);
}
.icon-stack-pop-enter-active,
.icon-stack-pop-leave-active {
  transition:
    opacity var(--motion-popover) var(--motion-ease),
    transform var(--motion-popover) var(--motion-ease);
}
.icon-stack-pop-enter-from,
.icon-stack-pop-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.96);
}
@media (prefers-reduced-motion: reduce) {
  .icon-stack,
  .icon-stack__card,
  .icon-stack__all-card,
  .icon-stack-pop-enter-active,
  .icon-stack-pop-leave-active {
    transition: none;
  }
}
</style>
