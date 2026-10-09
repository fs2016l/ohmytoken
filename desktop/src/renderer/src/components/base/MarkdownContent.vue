<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { renderMarkdown } from '../../utils/markdown'
import { useI18n } from '../../i18n/useI18n'
import { motion } from '../../config/motion'

const props = defineProps<{
  content: string
  copyCode?: boolean
}>()

const emit = defineEmits<{
  link: [href: string]
}>()

const html = computed(() => renderMarkdown(props.content))
const root = ref<HTMLElement | null>(null)
const { label, currentLang } = useI18n()
let buttons = new WeakMap<Element, string>()
const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>()
let generation = 0
function cleanup(): void {
  generation++
  for (const [button, timer] of timers) {
    clearTimeout(timer)
    button.textContent = label('Copy', '复制')
  }
  timers.clear()
}
watch(
  [html, () => props.copyCode, currentLang],
  async () => {
    cleanup()
    await nextTick()
    buttons = new WeakMap()
    root.value?.querySelectorAll('.markdown-copy').forEach((button) => button.remove())
    if (!props.copyCode) return
    root.value?.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'markdown-copy'
      button.textContent = label('Copy', '复制')
      button.setAttribute('aria-label', label('Copy code', '复制代码'))
      buttons.set(button, code)
      pre.appendChild(button)
    })
  },
  { immediate: true, flush: 'post' },
)
onDeactivated(cleanup)
onBeforeUnmount(cleanup)
async function copy(button: HTMLButtonElement): Promise<void> {
  const value = buttons.get(button)
  if (value === undefined) return
  const current = generation
  clearTimeout(timers.get(button))
  try {
    await navigator.clipboard.writeText(value)
    if (current === generation) button.textContent = label('Copied', '已复制')
  } catch {
    if (current === generation) button.textContent = label('Retry', '重试')
  }
  if (current === generation)
    timers.set(
      button,
      setTimeout(() => {
        button.textContent = label('Copy', '复制')
        timers.delete(button)
      }, motion.copyFeedback),
    )
}

function handleClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const button = event.target.closest<HTMLButtonElement>('.markdown-copy')
  if (button && buttons.has(button)) {
    void copy(button)
    return
  }

  const anchor = event.target.closest('a')
  if (!anchor) return

  event.preventDefault()
  const href = anchor.getAttribute('href')?.trim()
  if (href && /^https?:\/\//i.test(href)) emit('link', href)
}
</script>

<template>
  <!-- html 已由 renderMarkdown 使用 DOMPurify 清洗。 -->
  <!-- eslint-disable vue/no-v-html -->
  <div
    ref="root"
    class="markdown-content"
    :class="{ 'markdown-content--copy': copyCode }"
    @click="handleClick"
    v-html="html"
  ></div>
  <!-- eslint-enable vue/no-v-html -->
</template>

<style scoped>
.markdown-content {
  min-width: 0;
  color: inherit;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  margin: 16px 0 8px;
  color: var(--text);
  font-weight: var(--weight-semibold);
  line-height: 1.4;
}

.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child),
.markdown-content :deep(h4:first-child) {
  margin-top: 0;
}

.markdown-content :deep(h1) {
  font-size: 20px;
}

.markdown-content :deep(h2) {
  font-size: 18px;
}

.markdown-content :deep(h3) {
  font-size: 16px;
}

.markdown-content :deep(h4) {
  font-size: 15px;
}

.markdown-content :deep(p) {
  margin: 0 0 12px;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0 0 12px;
  padding-left: 24px;
}

.markdown-content :deep(li) {
  margin: 4px 0;
}

.markdown-content :deep(code) {
  padding: 2px 6px;
  background: var(--surface-container);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 13px;
}

.markdown-content :deep(pre) {
  overflow-x: auto;
  margin: 0 0 12px;
  padding: 12px 16px;
  background: var(--surface-container);
  border-radius: 8px;
}

.markdown-content :deep(pre code) {
  padding: 0;
  background: transparent;
  font-weight: 400;
}
.markdown-content--copy :deep(pre) {
  position: relative;
  padding-right: 68px;
  background: var(--code-background);
  color: var(--code-foreground);
}
.markdown-content :deep(.markdown-copy) {
  position: absolute;
  right: 10px;
  top: 10px;
  padding: 3px;
  font: 12px/18px var(--font-sans);
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
}

.markdown-content :deep(blockquote) {
  margin: 0 0 12px;
  padding: 8px 16px;
  color: var(--text-soft);
  background: var(--surface-container);
  border-left: 3px solid var(--primary);
}

.markdown-content :deep(a) {
  color: var(--primary);
  text-decoration: none;
  cursor: pointer;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  margin: 8px 0;
  border-radius: 8px;
}

.markdown-content :deep(table) {
  display: block;
  overflow-x: auto;
  width: 100%;
  margin: 0 0 12px;
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  padding: 8px 12px;
  border: 1px solid var(--border);
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--surface-container);
  font-weight: var(--weight-semibold);
}

.markdown-content :deep(hr) {
  margin: 16px 0;
  border: 0;
  border-top: 1px solid var(--border);
}

.markdown-content :deep(strong) {
  color: var(--text);
  font-weight: var(--weight-semibold);
}
</style>
