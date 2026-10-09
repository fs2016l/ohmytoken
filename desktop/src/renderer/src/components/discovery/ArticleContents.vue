<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import type { ArticleHeading } from '../../composables/useArticleContents'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { motion } from '../../config/motion'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{
  headings: ArticleHeading[]
  activeId: string
  title?: string
}>()
const emit = defineEmits<{ select: [id: string]; top: [] }>()
const { label } = useI18n()
const nav = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const indicator = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(nav)
let indicatorPosition: number | null = null
let animation: Animation | undefined
let resize: ResizeObserver | undefined

function measure(animate = false): void {
  const selected = list.value?.querySelector<HTMLElement>('[aria-current="location"]')
  const marker = indicator.value
  if (!selected || !marker || !selected.getClientRects().length) return
  const style = getComputedStyle(selected)
  const position =
    selected.offsetTop + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 - 3.5
  const origin = getComputedStyle(marker).transform
  animation?.cancel()
  const target = `translateY(${position}px)`
  marker.style.transform = target
  marker.style.opacity = '1'
  if (
    animate &&
    visible.value &&
    !reduced.value &&
    indicatorPosition !== null &&
    indicatorPosition !== position
  )
    animation = marker.animate([{ transform: origin }, { transform: target }], {
      duration: motion.detail,
      easing: motion.entranceEase,
    })
  indicatorPosition = position
}

watch(
  () => props.activeId,
  async () => {
    await nextTick()
    measure(true)
    const viewport = nav.value
    const selected = viewport?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!viewport || !selected) return
    const item = selected.getBoundingClientRect()
    const bounds = viewport.getBoundingClientRect()
    // Scroll only the outline, never the article, when the active section changes.
    const delta =
      item.top < bounds.top ? item.top - bounds.top : Math.max(0, item.bottom - bounds.bottom)
    if (delta)
      viewport.scrollTo({
        top: viewport.scrollTop + delta,
        behavior: reduced.value ? 'instant' : 'smooth',
      })
  },
  { immediate: true, flush: 'post' },
)
watch([visible, reduced, () => props.headings], () => void nextTick(() => measure()))
onMounted(() => {
  resize = new ResizeObserver(() => measure())
  if (list.value) resize.observe(list.value)
  measure()
})
onDeactivated(() => animation?.cancel())
onBeforeUnmount(() => {
  animation?.cancel()
  resize?.disconnect()
})
</script>

<template>
  <div class="article-contents">
    <h2>{{ title ?? label('On this page', '文章目录') }}</h2>
    <nav ref="nav" :aria-label="title ?? label('Article contents', '文章目录')">
      <div ref="list" class="article-contents-list">
        <span ref="indicator" class="article-contents-indicator" aria-hidden="true" />
        <button
          v-for="heading in headings"
          :key="heading.id"
          type="button"
          :class="{ 'is-subheading': heading.depth === 3 }"
          :aria-current="heading.id === activeId ? 'location' : undefined"
          @click="emit('select', heading.id)"
        >
          <span class="article-contents-label">{{ heading.title }}</span>
        </button>
      </div>
    </nav>
    <button type="button" class="article-contents-top" @click="emit('top')">
      <span aria-hidden="true">↑</span>
      {{ label('Back to top', '回到顶部') }}
    </button>
  </div>
</template>

<style scoped>
.article-contents {
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-height: inherit;
}
.article-contents h2 {
  margin: 0 0 16px;
  padding-left: 22px;
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
}
.article-contents nav {
  position: relative;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}
.article-contents-list {
  position: relative;
  padding: 0 0 0 5px;
}
.article-contents-indicator {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px var(--primary-soft);
  opacity: 0;
  pointer-events: none;
}
.article-contents nav button {
  position: relative;
  display: block;
  width: 100%;
  border: 0;
  border-left: 1px solid var(--border-strong);
  padding: 10px 8px 10px 16px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition:
    color var(--motion-detail) var(--motion-ease),
    background-color var(--motion-hover) var(--motion-ease),
    font-weight var(--motion-detail) var(--motion-ease);
}
.article-contents-label {
  display: block;
  transition: transform var(--motion-detail) var(--motion-ease);
}
.article-contents nav button::before {
  content: '';
  position: absolute;
  top: 18px;
  left: -3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--border-strong);
}
.article-contents nav button.is-subheading {
  padding-left: 28px;
  font-size: 12px;
}
.article-contents nav button.is-subheading::before {
  width: 3px;
  height: 3px;
  left: -2px;
}
.article-contents nav button:hover {
  color: var(--primary-soft-text);
  background: var(--primary-soft);
}
.article-contents nav button[aria-current='location'] {
  color: var(--accent);
  font-weight: 600;
}
.article-contents nav button[aria-current='location']::before {
  opacity: 0;
}
.article-contents nav button[aria-current='location'] .article-contents-label {
  transform: translateX(3px);
}
.article-contents-top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 18px 0 0 22px;
  padding: 14px 0 0;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text-soft);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: color var(--motion-hover) var(--motion-ease);
}
.article-contents-top:hover {
  color: var(--accent);
}
@media (prefers-reduced-motion: reduce) {
  .article-contents nav button,
  .article-contents-label,
  .article-contents-top {
    transition: none;
  }
  .article-contents nav button[aria-current='location'] .article-contents-label {
    transform: none;
  }
}
</style>
