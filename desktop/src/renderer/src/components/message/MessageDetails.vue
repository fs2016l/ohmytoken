<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DesktopMessage, MessagePlacement } from '../../api/http/message'
import { useArticleContents } from '../../composables/useArticleContents'
import { openMessageLink } from '../../composables/useMessageDetails'
import { useI18n } from '../../i18n/useI18n'
import AnchoredPopover from '../base/AnchoredPopover.vue'
import DesignIcon from '../base/DesignIcon.vue'
import MarkdownContent from '../base/MarkdownContent.vue'
import PageSurface from '../base/PageSurface.vue'
import WorkspaceDialog from '../base/WorkspaceDialog.vue'
import ArticleContents from '../discovery/ArticleContents.vue'
import MessageImageCarousel from './MessageImageCarousel.vue'

const props = defineProps<{ message: DesktopMessage; placement: MessagePlacement }>()
const emit = defineEmits<{ close: [] }>()
const { currentLang, label } = useI18n()
const floating = computed(() => props.placement === 'floating')
const title = computed(() =>
  currentLang.value === 'en'
    ? props.message.titleEn || props.message.titleZh || ''
    : props.message.titleZh || props.message.titleEn || '',
)
const content = computed(() =>
  currentLang.value === 'en'
    ? props.message.contentEn || props.message.contentZh || ''
    : props.message.contentZh || props.message.contentEn || '',
)
const published = computed(() => {
  const value = props.message.pushedAt || props.message.updateTime || props.message.createTime
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat(currentLang.value === 'en' ? 'en-US' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
})
const category = computed(() => {
  if (props.message.level === 'important') return label('Important announcement', '重要公告')
  if (props.message.level === 'warning') return label('Service notice', '服务提醒')
  return label('Product announcement', '产品公告')
})
const surface = ref<InstanceType<typeof PageSurface> | null>(null)
const reading = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)
const { headings, activeId, viewport, jump, top } = useArticleContents(
  props.message.id,
  content,
  reading,
  () => surface.value?.scroller,
)
const hasContents = computed(() => !floating.value && headings.value.length > 1)
const sideContents = computed(() => hasContents.value && viewport.value.width >= 1320)
const contentsButton = ref<HTMLElement | null>(null)
const contentsOpen = ref(false)
const preview = ref<{ src: string; alt: string } | null>(null)
const originalSize = ref(false)
const openingMain = ref(false)
const issue = ref('')

function selectSection(id: string): void {
  contentsOpen.value = false
  jump(id)
}
function backToTop(): void {
  contentsOpen.value = false
  top()
}
function showImage(src: string, alt = title.value): void {
  originalSize.value = false
  preview.value = { src, alt }
}
function previewMarkdown(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return
  const image = event.target.closest('.message-image-button')?.querySelector('img')
  if (image) showImage(image.src, image.alt || title.value)
}
// Enhance only this reader's sanitized Markdown. Linked images keep their original action.
watch(
  [content, reading, currentLang],
  async () => {
    await nextTick()
    reading.value?.querySelectorAll('img').forEach((image) => {
      if (image.closest('a, button')) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'message-image-button'
      button.setAttribute(
        'aria-label',
        label(
          `Enlarge image: ${image.alt || title.value}`,
          `放大图片：${image.alt || title.value}`,
        ),
      )
      button.title = label('Click to enlarge', '点击图片放大')
      image.replaceWith(button)
      button.appendChild(image)
    })
  },
  { immediate: true, flush: 'post' },
)

async function openLink(url: string): Promise<void> {
  issue.value = ''
  try {
    await openMessageLink(props.message, props.placement, url)
  } catch {
    issue.value = label('Could not open the link. Please retry.', '链接打开失败，请重试。')
  }
}
async function openMain(): Promise<void> {
  if (openingMain.value) return
  openingMain.value = true
  issue.value = ''
  try {
    await window.api.openFloatingWorkspace({ announcementUid: props.message.messageUid })
  } catch {
    issue.value = label('Could not open the main window. Please retry.', '主窗口打开失败，请重试。')
  } finally {
    openingMain.value = false
  }
}
function escape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (preview.value || contentsOpen.value || document.querySelector('dialog[open]')) return
  event.preventDefault()
  emit('close')
}
onMounted(() => {
  void nextTick(() => heading.value?.focus({ preventScroll: true }))
  document.addEventListener('keydown', escape)
})
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
</script>

<template>
  <section
    class="message-reader"
    :class="{ 'message-reader--floating': floating }"
    :aria-label="label('Announcement details', '公告详情')"
  >
    <PageSurface
      ref="surface"
      class="article-detail-surface message-reader-surface"
      :page-key="floating ? undefined : `announcement:${message.id}`"
      :style="{ '--article-viewport-height': `${viewport.height}px` }"
    >
      <div
        class="article-toolbar message-reader-toolbar"
        :class="{ 'article-toolbar--titled': !floating }"
      >
        <template v-if="floating">
          <button type="button" class="message-reader-back" @click="emit('close')">
            <DesignIcon name="settingsBack" :size="14" />
            {{ label('Back to monitor', '返回监测') }}
          </button>
          <span class="message-reader-caption">{{ label('Announcement', '公告') }}</span>
        </template>
        <template v-else>
          <div>
            <button
              v-if="hasContents && !sideContents"
              ref="contentsButton"
              type="button"
              class="workspace-button article-contents-toggle"
              :aria-expanded="contentsOpen"
              aria-haspopup="dialog"
              @click="contentsOpen = !contentsOpen"
            >
              <DesignIcon name="capabilityBook" :size="16" />
              {{ label('Contents', '目录') }}
            </button>
          </div>
          <span class="article-toolbar-title" :title="title">{{ title }}</span>
          <button
            type="button"
            class="workspace-button message-reader-close"
            :aria-label="label('Close announcement', '关闭公告')"
            @click="emit('close')"
          >
            <DesignIcon name="floatingClose" :size="16" />
            {{ label('Close', '关闭') }}
          </button>
        </template>
      </div>
      <div class="article-reading-layout">
        <aside v-if="sideContents" class="article-toc">
          <ArticleContents
            class="article-toc-centered"
            :title="label('Contents', '目录')"
            :headings="headings"
            :active-id="activeId"
            @select="selectSection"
            @top="backToTop"
          />
        </aside>
        <article class="article-reading-card">
          <header class="article-detail-title">
            <span
              class="message-reader-category"
              :class="`message-reader-category--${message.level}`"
            >
              {{ category }}
            </span>
            <h1 ref="heading" tabindex="-1">{{ title }}</h1>
            <div class="article-detail-meta">
              <time v-if="published">{{ published }}</time>
              <span v-if="published" aria-hidden="true">·</span>
              <span>Oh My Token</span>
            </div>
          </header>
          <MessageImageCarousel
            v-if="message.images.length"
            class="message-reader-gallery"
            :images="message.images"
            :title="title"
            :paused="!!preview"
            @open="openLink"
            @preview="showImage"
          />
          <div ref="reading" class="article-reading" @click="previewMarkdown">
            <MarkdownContent :content="content" copy-code @link="openLink" />
          </div>
          <p v-if="issue && !floating" class="message-reader-error" role="alert">{{ issue }}</p>
        </article>
      </div>
    </PageSurface>
    <footer v-if="floating" class="message-reader-footer">
      <p v-if="issue" class="message-reader-error" role="alert">{{ issue }}</p>
      <button type="button" class="workspace-button" :disabled="openingMain" @click="openMain">
        <DesignIcon name="externalLink" :size="16" />
        {{
          openingMain
            ? label('Opening…', '正在打开…')
            : label('View in main window', '在主窗口查看')
        }}
      </button>
    </footer>
    <AnchoredPopover
      v-model="contentsOpen"
      :anchor="contentsButton"
      :label="label('Contents', '目录')"
    >
      <ArticleContents
        class="article-contents-popover"
        :title="label('Contents', '目录')"
        :headings="headings"
        :active-id="activeId"
        @select="selectSection"
        @top="backToTop"
      />
    </AnchoredPopover>
    <WorkspaceDialog
      :open="!!preview"
      :title="label('Image preview', '图片预览')"
      wide
      class="message-image-preview"
      @close="preview = null"
    >
      <template #actions>
        <button
          type="button"
          class="workspace-button"
          :aria-pressed="originalSize"
          @click="originalSize = !originalSize"
        >
          {{ originalSize ? label('Fit', '适合窗口') : label('Original size', '原始尺寸') }}
        </button>
      </template>
      <img
        v-if="preview"
        :src="preview.src"
        :alt="preview.alt"
        :class="{ 'is-original': originalSize }"
      />
    </WorkspaceDialog>
  </section>
</template>

<style scoped src="../../styles/article-detail.css"></style>
<style scoped src="../../styles/message-details.css"></style>
