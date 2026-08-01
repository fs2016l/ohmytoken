<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from '../i18n/useI18n'
import { useBodyScrollLock } from '../composables/useBodyScrollLock'
import { getInsightDetail, getInsightsPage, type InsightDetail, type InsightItem } from '../api'
import PageIntro from '../components/base/PageIntro.vue'
import MarkdownContent from '../components/base/MarkdownContent.vue'
import { REMOTE_DATA_ERROR_COPY } from '../config/remote-data-error'

const { currentLang, label } = useI18n()

// ─── State ────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE_DESKTOP = 9
const ITEMS_PER_PAGE_TABLET = 6
const ITEMS_PER_PAGE_MOBILE = 3

// 这里只保留服务器返回的当前页，不再一次性缓存全部信息差。
const pageInsights = ref<InsightItem[]>([])
const loading = ref(false)
const loadError = ref('')
const currentPage = ref(1)
const searchQuery = ref('')
// 输入框与已提交关键词分离：输入本身不会触发搜索请求。
const activeKeyword = ref('')
const selectedInsight = ref<InsightItem | null>(null)
const selectedInsightDetail = ref<InsightDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const showModal = ref(false)
useBodyScrollLock(showModal)
const itemsPerPage = ref(ITEMS_PER_PAGE_DESKTOP)
const modalImageLoaded = ref(false)
const showImagePreview = ref(false)
const totalPages = ref(1)
const detailCache = new Map<number, InsightDetail>()
let latestDetailRequestId = 0
let detailAbortController: AbortController | null = null
let latestRequestId = 0

// ─── 加载信息差数据 ─────────────────────────────────────────────────────────────

async function loadInsights(page: number = currentPage.value): Promise<void> {
  const requestId = ++latestRequestId
  loading.value = true
  loadError.value = ''

  try {
    const res = await getInsightsPage({
      pageNum: page,
      pageSize: itemsPerPage.value,
      keyword: activeKeyword.value || undefined,
    })

    if (requestId !== latestRequestId) return

    if (res.data.code !== 200) {
      loadError.value = res.data.msg || '加载失败'
      return
    }

    const result = res.data.data
    const serverPages = Number(result.pages) || 0

    // 数据删除后刷新末页时，自动回到当前最后一页。
    if (serverPages > 0 && page > serverPages) {
      currentPage.value = serverPages
      await loadInsights(serverPages)
      return
    }

    pageInsights.value = result.list || []
    totalPages.value = Math.max(1, serverPages)
    currentPage.value = Math.min(Math.max(1, Number(result.pageNum) || page), totalPages.value)
  } catch (e: unknown) {
    if (requestId !== latestRequestId) return
    console.error('加载信息差列表失败', e)
    loadError.value = e instanceof Error ? e.message : '网络错误，请稍后重试'
  } finally {
    if (requestId === latestRequestId) loading.value = false
  }
}

// ─── Computed ─────────────────────────────────────────────────────────────────

// 无搜索时置顶项使用大卡片；搜索时即使命中置顶项，也按普通搜索结果展示。
const paginatedInsights = computed(() => {
  if (activeKeyword.value) return pageInsights.value
  return pageInsights.value.filter((item) => !item.isTop)
})

const pageNumbers = computed(() => {
  const total = totalPages.value
  const current = currentPage.value
  const pages: (number | 'ellipsis')[] = []

  if (total <= 7) {
    for (let i = 1; i <= total; i++) pages.push(i)
  } else {
    pages.push(1)
    if (current > 3) pages.push('ellipsis')
    for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i)
    if (current < total - 2) pages.push('ellipsis')
    pages.push(total)
  }

  return pages
})

const topInsight = computed(() => {
  if (activeKeyword.value || currentPage.value !== 1) return null
  return pageInsights.value.find((item) => item.isTop) || null
})

// ─── Methods ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  if (currentLang.value === 'zh') {
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function formatShortDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  if (currentLang.value === 'zh') {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function relativeDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))

  if (currentLang.value === 'zh') {
    if (diffDays === 0) return '今天'
    if (diffDays === 1) return '昨天'
    if (diffDays === 2) return '前天'
    if (diffDays < 7) return `${diffDays}天前`
    return formatShortDate(dateStr)
  }
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`
  return formatShortDate(dateStr)
}

function getTitle(item: InsightItem): string {
  return currentLang.value === 'zh' ? item.titleZh : item.titleEn
}

function getSummary(item: InsightItem): string {
  return currentLang.value === 'zh' ? item.summaryZh : item.summaryEn
}

function getContent(item: InsightDetail): string {
  return currentLang.value === 'zh' ? item.contentZh : item.contentEn
}

function openMarkdownLink(href: string): void {
  void window.api.openExternal(href)
}

function getTagLabel(tag: { en: string; zh: string }): string {
  return currentLang.value === 'zh' ? tag.zh : tag.en
}

async function submitSearch(): Promise<void> {
  const keyword = searchQuery.value.trim()
  searchQuery.value = keyword
  activeKeyword.value = keyword
  currentPage.value = 1
  await loadInsights(1)
}

async function clearSearch(): Promise<void> {
  searchQuery.value = ''
  if (!activeKeyword.value) return
  activeKeyword.value = ''
  currentPage.value = 1
  await loadInsights(1)
}

async function goToPage(page: number): Promise<void> {
  if (loading.value || page < 1 || page > totalPages.value || page === currentPage.value) return
  currentPage.value = page
  await loadInsights(page)
  if (loadError.value) return
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function loadSelectedInsightDetail(item: InsightItem, force = false): Promise<void> {
  const requestId = ++latestDetailRequestId
  detailAbortController?.abort()
  detailAbortController = null

  if (!force) {
    const cached = detailCache.get(item.id)
    if (cached) {
      selectedInsightDetail.value = cached
      detailLoading.value = false
      detailError.value = ''
      return
    }
  }

  const controller = new AbortController()
  detailAbortController = controller
  selectedInsightDetail.value = null
  detailLoading.value = true
  detailError.value = ''

  try {
    const res = await getInsightDetail(item.id, controller.signal)
    if (
      requestId !== latestDetailRequestId ||
      controller.signal.aborted ||
      selectedInsight.value?.id !== item.id
    ) {
      return
    }

    if (res.data.code !== 200 || !res.data.data) {
      detailError.value =
        res.data.msg || label('Failed to load details. Please try again.', '正文加载失败，请重试')
      return
    }

    const detail: InsightDetail = {
      id: Number(res.data.data.id),
      contentZh: res.data.data.contentZh || '',
      contentEn: res.data.data.contentEn || '',
    }
    if (detail.id !== item.id) {
      detailError.value = label(
        'The returned detail does not match this item.',
        '返回的正文与当前信息不匹配，请重试',
      )
      return
    }

    detailCache.set(item.id, detail)
    selectedInsightDetail.value = detail
  } catch (error: unknown) {
    if (controller.signal.aborted || requestId !== latestDetailRequestId) return
    console.error('加载信息差正文失败', error)
    detailError.value = label(
      'Failed to load details. Please try again.',
      '正文加载失败，请稍后重试',
    )
  } finally {
    if (requestId === latestDetailRequestId) {
      detailLoading.value = false
      if (detailAbortController === controller) detailAbortController = null
    }
  }
}

function openModal(item: InsightItem) {
  selectedInsight.value = item
  selectedInsightDetail.value = null
  detailError.value = ''
  showModal.value = true
  modalImageLoaded.value = false
  showImagePreview.value = false
  void loadSelectedInsightDetail(item)
}

function retryInsightDetail(): void {
  if (selectedInsight.value) void loadSelectedInsightDetail(selectedInsight.value, true)
}

function closeModal() {
  latestDetailRequestId += 1
  detailAbortController?.abort()
  detailAbortController = null
  detailLoading.value = false
  showImagePreview.value = false
  showModal.value = false
}

onUnmounted(() => {
  latestRequestId += 1
  latestDetailRequestId += 1
  detailAbortController?.abort()
  window.removeEventListener('resize', handleResize)
  window.removeEventListener('keydown', handleKeydown)
})

function getImageUrl(item: InsightItem): string {
  const raw = item.imageUrl?.trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.toString() : ''
  } catch {
    return ''
  }
}

function getImageStyle(item: InsightItem): Record<string, string> {
  const url = getImageUrl(item)
  return url ? { '--insight-image': `url(${JSON.stringify(url)})` } : {}
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (showImagePreview.value) {
    showImagePreview.value = false
    return
  }
  if (showModal.value) closeModal()
}

function updateItemsPerPage(): boolean {
  const w = window.innerWidth
  let nextPageSize = ITEMS_PER_PAGE_DESKTOP

  if (w < 640) {
    nextPageSize = ITEMS_PER_PAGE_MOBILE
  } else if (w < 1024) {
    nextPageSize = ITEMS_PER_PAGE_TABLET
  }

  if (itemsPerPage.value === nextPageSize) return false
  itemsPerPage.value = nextPageSize
  return true
}

function handleResize(): void {
  if (!updateItemsPerPage()) return
  currentPage.value = 1
  void loadInsights(1)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(async () => {
  updateItemsPerPage()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeydown)
  // 从ohmytokencom加载信息差数据；失败时不注入假数据，由错误态 UI 提示用户刷新
  await loadInsights(1)
})
</script>

<template>
  <div class="insight-page">
    <!-- Page Header -->
    <PageIntro
      class="insight-intro"
      icon="insights"
      :eyebrow="label('CURATED DAILY', '每日精选')"
      :title="label('AI Insights', 'AI 信息差')"
      :subtitle="
        label(
          'Curated model releases, research breakthroughs, and industry updates.',
          '精选模型发布、研究突破与行业动态，快速掌握重要变化。',
        )
      "
    />

    <!-- Search & Filter Bar -->
    <div class="filter-bar catalog-toolbar">
      <div class="search-wrapper catalog-search">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          v-model="searchQuery"
          type="text"
          maxlength="100"
          :placeholder="
            label(
              'Search titles, tags, summaries, sources...',
              '搜索标题、标签、摘要、来源、备注...',
            )
          "
          class="search-input"
          @keyup.enter="submitSearch"
        />
        <button
          v-if="searchQuery"
          class="clear-btn"
          type="button"
          :aria-label="label('Clear search', '清空搜索')"
          @click="clearSearch"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <button
        class="btn-primary insight-search-btn"
        type="button"
        :disabled="loading"
        @click="submitSearch"
      >
        <span class="material-symbols-outlined">search</span>
        <span>{{ label('Search', '搜索') }}</span>
      </button>
      <button
        class="insight-refresh-btn catalog-refresh"
        type="button"
        :disabled="loading"
        @click="loadInsights()"
      >
        <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
        <span>{{ label('Refresh', '刷新') }}</span>
      </button>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>{{ label('Loading...', '正在加载...') }}</p>
    </div>

    <!-- Error state: 服务不可达，提供刷新按钮，绝不展示虚假数据 -->
    <div v-else-if="loadError" class="error-state">
      <div class="error-icon">
        <span class="material-symbols-outlined">cloud_off</span>
      </div>
      <h3>
        {{ label(REMOTE_DATA_ERROR_COPY.title.en, REMOTE_DATA_ERROR_COPY.title.zh) }}
      </h3>
      <p>
        {{ label(REMOTE_DATA_ERROR_COPY.description.en, REMOTE_DATA_ERROR_COPY.description.zh) }}
      </p>
      <button class="retry-btn" type="button" :disabled="loading" @click="loadInsights()">
        <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
        <span>
          {{ label(REMOTE_DATA_ERROR_COPY.action.en, REMOTE_DATA_ERROR_COPY.action.zh) }}
        </span>
      </button>
    </div>

    <!-- No results -->
    <div v-else-if="pageInsights.length === 0" class="empty-state">
      <span class="material-symbols-outlined empty-icon">search_off</span>
      <h3>{{ label('No content yet', '暂无内容') }}</h3>
      <p>{{ label('Try adjusting your search.', '请尝试调整搜索词。') }}</p>
    </div>

    <!-- Featured Insight Card -->
    <template v-if="topInsight">
      <article class="featured-card" @click="topInsight && openModal(topInsight)">
        <div
          class="featured-image-wrapper insight-image-surface"
          :style="getImageStyle(topInsight!)"
        >
          <img
            v-if="getImageUrl(topInsight!)"
            :src="getImageUrl(topInsight!)"
            :alt="getTitle(topInsight!)"
            class="featured-image"
            loading="eager"
          />
          <div v-else class="insight-image-placeholder">
            <span class="material-symbols-outlined">article</span>
          </div>
          <div class="featured-image-overlay"></div>
          <div class="featured-badge">
            <span class="material-symbols-outlined filled-icon">bolt</span>
            {{ label('Latest', '最新') }}
          </div>
        </div>
        <div class="featured-content">
          <div class="card-meta">
            <span class="date-text">
              <span class="material-symbols-outlined">schedule</span>
              {{ relativeDate(topInsight!.date) }}
            </span>
          </div>
          <h2>{{ getTitle(topInsight!) }}</h2>
          <p class="featured-summary">{{ getSummary(topInsight!) }}</p>
          <div class="card-tags">
            <span v-for="tag in topInsight!.tags" :key="tag.en" class="tag-chip">
              #{{ getTagLabel(tag) }}
            </span>
          </div>
        </div>
      </article>
    </template>

    <!-- Insight Grid -->
    <div v-if="paginatedInsights.length > 0" class="insight-grid">
      <article
        v-for="item in paginatedInsights"
        :key="item.id"
        class="insight-card"
        @click="openModal(item)"
      >
        <div class="card-image-wrapper insight-image-surface" :style="getImageStyle(item)">
          <img
            v-if="getImageUrl(item)"
            :src="getImageUrl(item)"
            :alt="getTitle(item)"
            class="card-image"
            loading="lazy"
          />
          <div v-else class="insight-image-placeholder">
            <span class="material-symbols-outlined">article</span>
          </div>
        </div>
        <div class="card-body">
          <div class="card-date-row">
            <span class="date-pill">
              <span class="material-symbols-outlined">calendar_today</span>
              {{ formatShortDate(item.date) }}
            </span>
          </div>
          <h3 class="card-title">{{ getTitle(item) }}</h3>
          <p class="card-summary">{{ getSummary(item) }}</p>
          <div class="card-footer">
            <div class="card-tags-sm">
              <span v-for="tag in item.tags.slice(0, 2)" :key="tag.en" class="tag-sm">
                #{{ getTagLabel(tag) }}
              </span>
            </div>
            <span class="read-more">
              {{ label('Read', '阅读') }}
              <span class="material-symbols-outlined">arrow_forward</span>
            </span>
          </div>
        </div>
      </article>
    </div>

    <!-- Pagination -->
    <nav v-if="totalPages > 1" class="pagination" aria-label="Pagination">
      <button
        class="page-btn prev"
        :disabled="loading || currentPage === 1"
        @click="goToPage(currentPage - 1)"
      >
        <span class="material-symbols-outlined">chevron_left</span>
        {{ label('Prev', '上一页') }}
      </button>

      <div class="page-numbers">
        <template v-for="(p, i) in pageNumbers" :key="i">
          <span v-if="p === 'ellipsis'" class="page-ellipsis">&hellip;</span>
          <button
            v-else
            class="page-num"
            :class="{ active: currentPage === p }"
            :disabled="loading"
            @click="goToPage(p as number)"
          >
            {{ p }}
          </button>
        </template>
      </div>

      <button
        class="page-btn next"
        :disabled="loading || currentPage === totalPages"
        @click="goToPage(currentPage + 1)"
      >
        {{ label('Next', '下一页') }}
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </nav>

    <!-- Insight Detail Modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showModal && selectedInsight" class="modal-overlay" @click.self="closeModal">
          <div
            class="modal-container"
            role="dialog"
            aria-modal="true"
            :aria-label="getTitle(selectedInsight)"
          >
            <button class="modal-close" type="button" aria-label="Close" @click="closeModal">
              <span class="material-symbols-outlined">close</span>
            </button>

            <button
              v-if="getImageUrl(selectedInsight)"
              class="modal-hero-image-wrapper insight-image-surface"
              type="button"
              :style="getImageStyle(selectedInsight)"
              :aria-label="label('View full image', '查看完整图片')"
              @click="showImagePreview = true"
            >
              <div v-if="!modalImageLoaded" class="modal-image-skeleton"></div>
              <img
                :src="getImageUrl(selectedInsight)"
                :alt="getTitle(selectedInsight)"
                class="modal-hero-image"
                :class="{ loaded: modalImageLoaded }"
                @load="modalImageLoaded = true"
              />
              <div class="modal-hero-overlay"></div>
              <span class="modal-image-zoom-hint">
                <span class="material-symbols-outlined">zoom_in</span>
                {{ label('View full image', '查看原图') }}
              </span>
            </button>

            <div class="modal-content">
              <div class="modal-meta">
                <span class="date-text">
                  <span class="material-symbols-outlined">calendar_today</span>
                  {{ formatDate(selectedInsight.date) }}
                </span>
                <span class="source-text">
                  <span class="material-symbols-outlined">source</span>
                  {{ selectedInsight.source }}
                </span>
              </div>

              <h2 class="modal-title">{{ getTitle(selectedInsight) }}</h2>

              <div class="modal-tags">
                <span v-for="tag in selectedInsight.tags" :key="tag.en" class="tag-chip">
                  #{{ getTagLabel(tag) }}
                </span>
              </div>

              <div class="modal-body">
                <p class="modal-summary">{{ getSummary(selectedInsight) }}</p>
                <div
                  v-if="detailLoading"
                  class="modal-detail-state"
                  role="status"
                  aria-live="polite"
                >
                  <span class="material-symbols-outlined spinning">progress_activity</span>
                  <span>{{ label('Loading details…', '正在加载正文…') }}</span>
                </div>
                <div
                  v-else-if="detailError"
                  class="modal-detail-state modal-detail-state--error"
                  role="alert"
                >
                  <span class="material-symbols-outlined">error</span>
                  <span>{{ detailError }}</span>
                  <button class="modal-detail-retry" type="button" @click="retryInsightDetail">
                    {{ label('Retry', '重试') }}
                  </button>
                </div>
                <MarkdownContent
                  v-else-if="selectedInsightDetail"
                  class="modal-text"
                  :content="getContent(selectedInsightDetail)"
                  @link="openMarkdownLink"
                />
              </div>
            </div>
          </div>

          <Transition name="image-preview">
            <div
              v-if="showImagePreview"
              class="image-preview-overlay"
              role="dialog"
              aria-modal="true"
              :aria-label="label('Full image preview', '原图预览')"
              @click.self="showImagePreview = false"
            >
              <div class="image-preview-panel">
                <button
                  class="image-preview-close"
                  type="button"
                  :aria-label="label('Close image preview', '关闭原图预览')"
                  @click="showImagePreview = false"
                >
                  <span class="material-symbols-outlined">close</span>
                </button>
                <img
                  :src="getImageUrl(selectedInsight)"
                  :alt="getTitle(selectedInsight)"
                  class="image-preview-image"
                />
              </div>
            </div>
          </Transition>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 18px;
  line-height: 1;
  letter-spacing: 0;
  display: inline-block;
  white-space: nowrap;
  direction: ltr;
  font-feature-settings: 'liga';
  -webkit-font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings:
    'FILL' 0,
    'wght' 400,
    'GRAD' 0,
    'opsz' 24;
}

.filled-icon {
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 24;
}

/* ── Refresh Button ─────────────────────────────────────────────────────── */
.insight-refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 999px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-muted);
  font-weight: var(--weight-medium);
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
}

.insight-refresh-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.insight-refresh-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.insight-refresh-btn .material-symbols-outlined {
  font-size: 16px;
  color: var(--primary);
}

.insight-refresh-btn .material-symbols-outlined.spinning {
  animation: spin 0.8s linear infinite;
}

.insight-search-btn {
  flex: 0 0 auto;
  min-width: 82px;
}

/* ── Search ─────────────────────────────────────────────────────────────── */
.filter-bar {
  display: flex;
  align-items: center;
}

.search-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  max-width: 480px;
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--text-soft);
  font-size: 20px;
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 42px;
  padding: 0 40px 0 42px;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.search-input::placeholder {
  color: var(--text-soft);
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(208, 188, 255, 0.1);
}

.clear-btn {
  position: absolute;
  right: 8px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  background: var(--surface-container);
  border: 0;
  border-radius: 6px;
  color: var(--text-soft);
  cursor: pointer;
}

.clear-btn:hover {
  background: var(--surface-bright);
  color: var(--text);
}

/* ── Error state ────────────────────────────────────────────────────────── */
.error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  text-align: center;
  width: 100%;
}

.error-icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.25);
  margin-bottom: 16px;
}

.error-icon .material-symbols-outlined {
  font-size: 40px;
  color: #ef4444;
  font-variation-settings:
    'FILL' 1,
    'wght' 400,
    'GRAD' 0,
    'opsz' 40;
}

.error-state h3 {
  font-size: 18px;
  font-weight: var(--weight-semibold);
  color: var(--text);
  margin: 0 0 8px 0;
}

.error-state p {
  font-size: 14px;
  color: var(--text-soft);
  margin: 0 0 20px 0;
  width: min(100%, 820px);
  max-width: none;
  line-height: 1.6;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Empty state ────────────────────────────────────────────────────────── */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  color: var(--text-soft);
  margin-bottom: 16px;
}

.empty-state h3 {
  font-size: 20px;
  font-weight: var(--weight-semibold);
  color: var(--text-muted);
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-soft);
  margin: 0;
}

/* ── Loading state ──────────────────────────────────────────────────────── */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 24px;
  text-align: center;
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-strong);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-state p {
  font-size: 14px;
  color: var(--text-soft);
  margin: 0;
}

.retry-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 22px;
  background: var(--primary);
  color: var(--primary-on);
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: all 0.2s ease;
}

.retry-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
  box-shadow: 0 4px 14px rgba(208, 188, 255, 0.3);
}

.retry-btn:active:not(:disabled) {
  transform: translateY(0);
}

.retry-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.retry-btn .material-symbols-outlined {
  font-size: 18px;
}

.retry-btn .material-symbols-outlined.spinning {
  animation: spin 0.8s linear infinite;
}

/* ── Featured Card ──────────────────────────────────────────────────────── */
.featured-card {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  gap: 0;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-card);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease,
    border-color 0.25s ease;
}

.featured-card:hover {
  transform: translateY(-3px);
  border-color: var(--primary-deep);
  box-shadow:
    0 20px 40px rgba(109, 59, 215, 0.15),
    0 0 0 1px rgba(208, 188, 255, 0.1);
}

.featured-image-wrapper {
  position: relative;
  overflow: hidden;
  height: clamp(286px, 24vw, 320px);
  min-height: 0;
  background: var(--surface-container);
}

.featured-image {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: transform 0.4s ease;
}

.insight-image-surface {
  isolation: isolate;
}

.insight-image-surface::before,
.insight-image-surface::after {
  position: absolute;
  content: '';
  pointer-events: none;
}

.insight-image-surface::before {
  z-index: -2;
  inset: -24px;
  background-image: var(--insight-image);
  background-position: center;
  background-size: cover;
  filter: blur(22px) saturate(0.8);
  opacity: 0.16;
  transform: scale(1.08);
}

.insight-image-surface::after {
  z-index: -1;
  inset: 0;
  background: color-mix(in srgb, var(--surface-container) 76%, transparent);
}

.insight-image-placeholder {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  min-height: inherit;
  display: grid;
  place-items: center;
  color: var(--primary);
  background: linear-gradient(135deg, var(--surface-container), var(--surface-lowest));
}

.insight-image-placeholder .material-symbols-outlined {
  font-size: 46px;
  opacity: 0.55;
}

.featured-card:hover .featured-image {
  transform: scale(1.015);
}

.featured-image-overlay {
  position: absolute;
  z-index: 2;
  inset: 0;
  background: linear-gradient(to right, transparent 58%, var(--surface-low) 100%);
  pointer-events: none;
}

.featured-badge {
  position: absolute;
  z-index: 3;
  top: 16px;
  left: 16px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  color: #fff;
  border-radius: 999px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.featured-badge .material-symbols-outlined {
  font-size: 16px;
}

.featured-content {
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
}

.card-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--text-soft);
}

.date-text,
.source-text {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.date-text .material-symbols-outlined,
.source-text .material-symbols-outlined {
  font-size: 14px;
}

.featured-content h2 {
  font-size: 22px;
  font-weight: var(--weight-semibold);
  line-height: 1.3;
  margin: 0;
  color: var(--text);
  letter-spacing: -0.01em;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.featured-summary {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-muted);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-soft);
  font-weight: var(--weight-medium);
}

/* ── Insight Grid ──────────────────────────────────────────────────────────── */
.insight-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.insight-card {
  display: flex;
  flex-direction: column;
  background: var(--surface-low);
  border: 1px solid var(--border);
  border-radius: 14px;
  overflow: hidden;
  cursor: pointer;
  box-shadow: var(--shadow-card);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    border-color 0.2s ease;
}

.insight-card:hover {
  transform: translateY(-2px);
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-hover);
}

.card-image-wrapper {
  position: relative;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  min-height: 0;
  max-height: none;
  background: var(--surface-container);
}

.card-image {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  transition: transform 0.35s ease;
}

.insight-card:hover .card-image {
  transform: scale(1.02);
}

.card-body {
  padding: 18px 18px 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
}

.card-date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-soft);
}

.date-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.date-pill .material-symbols-outlined {
  font-size: 14px;
}

.card-title {
  font-size: 16px;
  font-weight: var(--weight-semibold);
  line-height: 1.4;
  margin: 0;
  color: var(--text);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  letter-spacing: -0.01em;
}

.card-summary {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-soft);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  flex: 1;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}

.card-tags-sm {
  display: flex;
  gap: 8px;
}

.tag-sm {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  line-height: 20px;
  color: var(--text-soft);
}

.read-more {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  color: var(--primary);
  transition: gap 0.15s ease;
}

.read-more .material-symbols-outlined {
  font-size: 16px;
  transition: transform 0.15s ease;
}

.insight-card:hover .read-more {
  gap: 8px;
}

/* ── Pagination ─────────────────────────────────────────────────────────── */
.pagination {
  display: flex;
  align-items: center;
  justify-content: center;
}

.page-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 38px;
  padding: 0 16px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-low);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--surface-container);
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.page-btn .material-symbols-outlined {
  font-size: 18px;
}

.page-numbers {
  display: flex;
  gap: 4px;
}

.page-num {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: all 0.15s ease;
}

.page-num:hover {
  background: var(--surface-container);
  color: var(--text);
}

.page-num.active {
  background: var(--primary);
  color: var(--primary-on);
  border-color: var(--primary);
  font-weight: var(--weight-semibold);
}

.page-ellipsis {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  color: var(--text-soft);
  font-size: 14px;
}

/* ── Modal ──────────────────────────────────────────────────────────────── */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(6px);
  overflow-y: auto;
}

.modal-container {
  position: relative;
  width: 100%;
  max-width: 800px;
  background: var(--surface-low);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  overflow: hidden;
  margin: auto 0;
  box-shadow: 0 40px 80px rgba(0, 0, 0, 0.5);
}

.modal-close {
  position: absolute;
  top: 16px;
  right: 16px;
  z-index: 10;
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  color: #fff;
  cursor: pointer;
  transition: background 0.15s ease;
}

.modal-close:hover {
  background: rgba(0, 0, 0, 0.75);
}

.modal-close .material-symbols-outlined {
  font-size: 22px;
}

.modal-hero-image-wrapper {
  position: relative;
  width: 100%;
  height: clamp(260px, 34vh, 340px);
  padding: 0;
  overflow: hidden;
  background: var(--surface-container);
  border: 0;
  color: inherit;
  cursor: zoom-in;
  font: inherit;
  text-align: initial;
}

.modal-image-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    var(--surface-container) 25%,
    var(--surface-container-high) 50%,
    var(--surface-container) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.modal-hero-image {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.modal-hero-image.loaded {
  opacity: 1;
}

.modal-hero-overlay {
  position: absolute;
  z-index: 2;
  inset: auto 0 0 0;
  height: 32%;
  background: linear-gradient(to top, var(--surface-low), transparent);
  pointer-events: none;
}

.modal-image-zoom-hint {
  position: absolute;
  right: 14px;
  bottom: 12px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 10px;
  color: var(--text);
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 9px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(10px);
  font-size: 12px;
  font-weight: var(--weight-semibold);
  opacity: 0.86;
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.modal-image-zoom-hint .material-symbols-outlined {
  font-size: 17px;
}

.modal-hero-image-wrapper:hover .modal-image-zoom-hint,
.modal-hero-image-wrapper:focus-visible .modal-image-zoom-hint {
  opacity: 1;
  transform: translateY(-2px);
}

.modal-hero-image-wrapper:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}

.image-preview-overlay {
  position: fixed;
  z-index: 120;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(8, 10, 16, 0.9);
  backdrop-filter: blur(8px);
}

.image-preview-panel {
  position: relative;
  width: min(96vw, 1440px);
  height: min(92vh, 1080px);
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--surface-lowest);
  border: 1px solid var(--border-strong);
  border-radius: 14px;
  box-shadow: 0 32px 90px rgba(0, 0, 0, 0.56);
}

.image-preview-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-preview-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text);
  background: color-mix(in srgb, var(--bg-elevated) 90%, transparent);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-card);
  backdrop-filter: blur(10px);
  cursor: pointer;
}

.image-preview-close:hover {
  color: var(--primary);
  border-color: var(--primary-border);
}

.image-preview-enter-active,
.image-preview-leave-active {
  transition: opacity 0.18s ease;
}

.image-preview-enter-active .image-preview-panel,
.image-preview-leave-active .image-preview-panel {
  transition: transform 0.18s ease;
}

.image-preview-enter-from,
.image-preview-leave-to {
  opacity: 0;
}

.image-preview-enter-from .image-preview-panel,
.image-preview-leave-to .image-preview-panel {
  transform: scale(0.985);
}

.modal-content {
  padding: 28px 32px 36px;
}

.modal-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
  color: var(--text-soft);
  margin-bottom: 16px;
}

.modal-title {
  font-size: 24px;
  font-weight: var(--weight-semibold);
  line-height: 1.3;
  margin: 0 0 14px 0;
  color: var(--text);
  letter-spacing: -0.02em;
}

.modal-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 24px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}

.modal-tags .tag-chip {
  font-size: 13px;
  color: var(--primary);
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-summary {
  font-size: 16px;
  line-height: 1.7;
  color: var(--text-muted);
  margin: 0;
  font-weight: var(--weight-medium);
}

.modal-detail-state {
  min-height: 132px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  padding: 24px;
  color: var(--text-soft);
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 10px;
  text-align: center;
}

.modal-detail-state .material-symbols-outlined {
  color: var(--primary);
  font-size: 24px;
}

.modal-detail-state .spinning {
  animation: spin 0.8s linear infinite;
}

.modal-detail-state--error .material-symbols-outlined {
  color: var(--danger, #dc5b5b);
}

.modal-detail-retry {
  min-height: 32px;
  padding: 0 14px;
  color: var(--primary);
  background: var(--surface-low);
  border: 1px solid var(--primary-border);
  border-radius: 8px;
  font: inherit;
  font-size: 13px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition:
    color 0.16s ease,
    background 0.16s ease,
    border-color 0.16s ease;
}

.modal-detail-retry:hover {
  color: var(--surface-lowest);
  background: var(--primary);
  border-color: var(--primary);
}

.modal-text {
  font-size: 15px;
  line-height: 1.8;
  color: var(--text-muted);
  margin: 0;
}

/* ── Modal Transitions ──────────────────────────────────────────────────── */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}

.modal-enter-active .modal-container,
.modal-leave-active .modal-container {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .modal-container,
.modal-leave-to .modal-container {
  transform: translateY(20px) scale(0.98);
  opacity: 0;
}

/* ── Responsive ─────────────────────────────────────────────────────────── */
@media (max-width: 1024px) {
  .insight-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .insight-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .insight-search-btn {
    width: 100%;
  }
}

@media (max-width: 820px) {
  .featured-card {
    grid-template-columns: 1fr;
  }

  .featured-image-wrapper {
    height: auto;
    min-height: 0;
    aspect-ratio: 16 / 9;
  }

  .featured-image-overlay {
    background: linear-gradient(to bottom, transparent 50%, var(--surface-low) 100%);
  }

  .featured-content {
    padding: 20px;
  }

  .featured-content h2 {
    font-size: 18px;
  }
}

@media (max-width: 560px) {
  .modal-overlay {
    padding: 12px;
  }

  .modal-hero-image-wrapper {
    height: clamp(220px, 56vw, 280px);
  }

  .modal-content {
    padding: 20px;
  }

  .modal-title {
    font-size: 20px;
  }

  .page-btn span:not(.material-symbols-outlined) {
    display: none;
  }

  .page-btn {
    padding: 0 10px;
  }
  .image-preview-overlay {
    padding: 10px;
  }

  .image-preview-panel {
    width: 100%;
    height: calc(100vh - 20px);
    border-radius: 12px;
  }
}
</style>
