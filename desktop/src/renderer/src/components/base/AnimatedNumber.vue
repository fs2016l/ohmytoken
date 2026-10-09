<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatNumber, type NumberFormatOptions } from '../../utils/number-format'
import { useNumberMotion, type NumberMotionMode } from '../../composables/useNumberMotion'
const props = withDefaults(
  defineProps<{
    value: number | null | undefined
    format?: NumberFormatOptions
    replay?: boolean
    prefix?: string
    motion?: NumberMotionMode
  }>(),
  { replay: true, prefix: '', format: () => ({}), motion: 'auto' },
)
const { element, content, displayed, incoming, glyphs } = useNumberMotion(
  () => props.prefix + formatNumber(props.value, props.format),
  () => props.value,
  () => props.replay,
  () => props.motion,
)
const sizes = computed(() => [...new Set([displayed.value, incoming.value ?? displayed.value])])
const width = ref<number>()
let observer: ResizeObserver | undefined
function measure(): void {
  const candidates = element.value?.querySelectorAll<HTMLElement>('.number-size')
  if (candidates?.length)
    width.value = Math.max(...Array.from(candidates, (item) => item.getBoundingClientRect().width))
}
function observeSizes(): void {
  observer?.disconnect()
  element.value?.querySelectorAll('.number-size').forEach((item) => observer?.observe(item))
  measure()
}
watch(sizes, observeSizes, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(measure)
  observeSizes()
})
onUnmounted(() => observer?.disconnect())
const exact = computed(
  () => props.prefix + formatNumber(props.value, { ...props.format, compact: false }),
)
</script>
<template>
  <span
    ref="element"
    class="animated-number"
    :style="{ width: width === undefined ? undefined : `${width}px` }"
    :title="exact"
    :aria-label="exact"
  >
    <span
      v-for="size in sizes"
      :key="size"
      class="number-size"
      :class="{ 'number-with-leading': $slots.leading }"
      :data-text="size"
      aria-hidden="true"
    >
      <slot name="leading" />
    </span>
    <span
      class="number-value"
      :class="{ 'number-with-leading': $slots.leading }"
      aria-hidden="true"
    >
      <slot name="leading" />
      <span
        ref="content"
        class="number-content"
        :class="{ 'number-content--rolling': motion === 'digits' }"
      >
        <span v-if="glyphs" class="number-digits">
          <span
            v-for="(glyph, index) in glyphs"
            :key="index"
            class="number-glyph"
            :class="{ 'number-glyph--changing': glyph.changed }"
          >
            <span v-if="glyph.changed" class="number-glyph__outgoing">{{ glyph.previous }}</span>
            <span :class="{ 'number-glyph__incoming': glyph.changed }">{{ glyph.current }}</span>
          </span>
        </span>
        <template v-else-if="incoming !== null">
          <span class="number-outgoing">{{ displayed }}</span>
          <span class="number-incoming">{{ incoming }}</span>
        </template>
        <span v-else>{{ displayed }}</span>
      </span>
    </span>
  </span>
</template>
<style scoped>
.animated-number {
  display: inline-block;
  position: relative;
  white-space: nowrap;
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums;
}
.number-size {
  position: absolute;
  inset-inline-start: 0;
  top: 0;
  width: max-content;
  visibility: hidden;
  pointer-events: none;
  user-select: none;
}
.number-size::before {
  content: attr(data-text);
}
.number-with-leading {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: top;
}
.number-value {
  display: inline-flex;
  align-items: baseline;
}
.number-content {
  display: inline-grid;
  position: relative;
  line-height: max(1.2em, 1lh);
  vertical-align: baseline;
}
.number-content--rolling {
  clip-path: inset(0);
}
.number-content > span,
.number-glyph > span {
  grid-area: 1 / 1;
}
.number-digits {
  display: inline-flex;
}
.number-glyph {
  display: inline-grid;
  position: relative;
  overflow: hidden;
}
.number-incoming,
.number-glyph__incoming {
  opacity: 0;
}
</style>
