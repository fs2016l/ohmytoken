<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import PageIntro from '../components/base/PageIntro.vue'
import { useI18n } from '../i18n/useI18n'
import { getAgentDownloads, type AgentDownloadItem } from '../api'
import { REMOTE_DATA_ERROR_COPY } from '../config/remote-data-error'

const { currentLang, label } = useI18n()

type CategoryKey = 'all' | 'coding' | 'general'

const categoryOptions: Array<{
  key: CategoryKey
  zh: string
  en: string
  icon: string
}> = [
  { key: 'all', zh: '全部', en: 'All', icon: 'grid_view' },
  { key: 'coding', zh: '编程智能体', en: 'Coding Agents', icon: 'code' },
  { key: 'general', zh: '通用智能体', en: 'General Agents', icon: 'smart_toy' },
]

const agents = ref<AgentDownloadItem[]>([])
const loading = ref(true)
const loadError = ref('')
const actionError = ref('')
const searchQuery = ref('')
const activeCategory = ref<CategoryKey>('all')
const selectedAgentCodes = ref<Set<string>>(new Set())
const openingId = ref<number | null>(null)
const logoFailures = ref<Set<number>>(new Set())

const visibleCategories = computed(() => {
  const existing = new Set(agents.value.map((agent) => agent.category))
  return categoryOptions.filter((category) => category.key === 'all' || existing.has(category.key))
})

const categoryFilteredAgents = computed(() => {
  if (activeCategory.value === 'all') return agents.value
  return agents.value.filter((agent) => agent.category === activeCategory.value)
})

const availableAgentFilters = computed(() => categoryFilteredAgents.value)

const filteredAgents = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  return categoryFilteredAgents.value.filter((agent) => {
    if (selectedAgentCodes.value.size && !selectedAgentCodes.value.has(agent.agentCode)) {
      return false
    }
    if (!query) return true
    return [
      agent.name,
      agent.nameEn,
      agent.vendor,
      agent.vendorEn,
      agent.description,
      agent.descriptionEn,
      agent.agentCode,
      ...agent.highlights,
      ...agent.highlightsEn,
    ].some((value) => value?.toLowerCase().includes(query))
  })
})

async function loadAgents(): Promise<void> {
  loading.value = true
  loadError.value = ''
  actionError.value = ''
  try {
    const response = await getAgentDownloads()
    if (response.data?.code !== 200 || !Array.isArray(response.data?.data)) {
      loadError.value = response.data?.message || 'SERVER_ERROR'
      return
    }
    agents.value = response.data.data as AgentDownloadItem[]
    const availableCodes = new Set(agents.value.map((agent) => agent.agentCode))
    selectedAgentCodes.value = new Set(
      [...selectedAgentCodes.value].filter((agentCode) => availableCodes.has(agentCode)),
    )
    if (
      activeCategory.value !== 'all' &&
      !agents.value.some((agent) => agent.category === activeCategory.value)
    ) {
      activeCategory.value = 'all'
    }
  } catch (error) {
    console.warn('加载智能体下载目录失败:', error)
    loadError.value = 'NETWORK_ERROR'
  } finally {
    loading.value = false
  }
}

function localized(primary: string | undefined, secondary: string | undefined): string {
  if (currentLang.value === 'zh') return primary || secondary || ''
  return secondary || primary || ''
}

function getName(agent: AgentDownloadItem): string {
  return localized(agent.name, agent.nameEn)
}

function getVendor(agent: AgentDownloadItem): string {
  return localized(agent.vendor, agent.vendorEn)
}

function getDescription(agent: AgentDownloadItem): string {
  return localized(agent.description, agent.descriptionEn)
}

function getHighlights(agent: AgentDownloadItem): string[] {
  const preferred = currentLang.value === 'zh' ? agent.highlights : agent.highlightsEn
  const fallback = currentLang.value === 'zh' ? agent.highlightsEn : agent.highlights
  return (preferred?.length ? preferred : fallback || []).slice(0, 6)
}

function categoryLabel(category: string): string {
  const option = categoryOptions.find((item) => item.key === category)
  return option ? (currentLang.value === 'zh' ? option.zh : option.en) : category
}

async function openOfficialSite(agent: AgentDownloadItem): Promise<void> {
  if (!agent.officialUrl || openingId.value !== null) return
  openingId.value = agent.id
  actionError.value = ''
  try {
    await window.api.openExternal(agent.officialUrl)
  } catch (error: unknown) {
    console.warn('打开智能体官方页面失败:', error)
    actionError.value = label('Failed to open the official website.', '官网打开失败。')
  } finally {
    openingId.value = null
  }
}

function markLogoFailed(id: number): void {
  logoFailures.value = new Set([...logoFailures.value, id])
}

function toggleAgentFilter(agentCode: string): void {
  const next = new Set(selectedAgentCodes.value)
  if (next.has(agentCode)) {
    next.delete(agentCode)
  } else {
    next.add(agentCode)
  }
  selectedAgentCodes.value = next
}

function isAgentSelected(agentCode: string): boolean {
  return selectedAgentCodes.value.has(agentCode)
}

function clearFilters(): void {
  searchQuery.value = ''
  activeCategory.value = 'all'
  selectedAgentCodes.value = new Set()
}

watch(activeCategory, () => {
  selectedAgentCodes.value = new Set()
})

onMounted(loadAgents)
</script>

<template>
  <main class="agent-download-page">
    <div class="page-header">
      <PageIntro
        icon="download_for_offline"
        :eyebrow="label('AGENT CATALOG', '智能体目录')"
        :title="label('Discover Agents', '发现智能体')"
        :subtitle="
          label(
            'Explore the core strengths of leading agent products and visit their official pages.',
            '汇总主流厂商的智能体产品，展示核心亮点并提供对应官网入口。',
          )
        "
      />

      <div class="search-bar catalog-toolbar">
        <div class="search-input-wrapper catalog-search">
          <span class="material-symbols-outlined search-icon">search</span>
          <input
            v-model="searchQuery"
            class="search-input"
            type="search"
            :placeholder="
              label('Search agents, vendors or capabilities...', '搜索智能体、厂商或能力标签…')
            "
          />
          <button
            v-if="searchQuery"
            class="clear-btn"
            type="button"
            :aria-label="label('Clear search', '清空搜索')"
            @click="searchQuery = ''"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <button class="catalog-refresh" type="button" :disabled="loading" @click="loadAgents">
          <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
          {{ label('Refresh', '刷新') }}
        </button>
      </div>
    </div>

    <div class="category-tabs" role="tablist" :aria-label="label('Agent categories', '智能体分类')">
      <button
        v-for="category in visibleCategories"
        :key="category.key"
        class="category-tab"
        type="button"
        role="tab"
        :aria-selected="activeCategory === category.key"
        :class="{ active: activeCategory === category.key }"
        @click="activeCategory = category.key"
      >
        <span class="material-symbols-outlined">{{ category.icon }}</span>
        {{ currentLang === 'zh' ? category.zh : category.en }}
      </button>
    </div>

    <div
      v-if="!loading && !loadError && availableAgentFilters.length"
      class="agent-filter-bar"
      role="group"
      :aria-label="label('Agent quick filter', '智能体快捷筛选')"
    >
      <button
        v-for="agent in availableAgentFilters"
        :key="agent.agentCode"
        class="agent-filter-btn"
        :class="{ active: isAgentSelected(agent.agentCode) }"
        type="button"
        :aria-pressed="isAgentSelected(agent.agentCode)"
        @click="toggleAgentFilter(agent.agentCode)"
      >
        <span class="agent-filter-logo">
          <img
            v-if="agent.logoUrl && !logoFailures.has(agent.id)"
            :src="agent.logoUrl"
            alt=""
            @error="markLogoFailed(agent.id)"
          />
          <span v-else>{{ getName(agent).slice(0, 1).toUpperCase() }}</span>
        </span>
        <span>{{ getName(agent) }}</span>
      </button>
    </div>

    <div v-if="actionError" class="action-error" role="alert">
      <span class="material-symbols-outlined">error</span>
      <span>{{ actionError }}</span>
      <button type="button" :aria-label="label('Dismiss', '关闭')" @click="actionError = ''">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div v-if="!loading && !loadError" class="results-info">
      <span>
        {{ label(`${filteredAgents.length} agents found`, `共 ${filteredAgents.length} 个智能体`) }}
      </span>
    </div>

    <div v-if="!loading && !loadError && agents.length" class="catalog-note">
      <span class="material-symbols-outlined">info</span>
      <span>
        {{
          label(
            'Products and download services are provided by third-party vendors. Versions and availability are subject to their official pages.',
            '智能体及下载服务由第三方厂商提供，版本与可用性请以对应官方页面为准。',
          )
        }}
      </span>
    </div>

    <section v-if="loading" class="state-card" aria-live="polite">
      <span class="loading-ring"></span>
      <h2>{{ label('Loading agent catalog', '正在加载智能体目录') }}</h2>
      <p>
        {{
          label('Fetching the latest entries from the service…', '正在从服务端获取最新上架内容…')
        }}
      </p>
    </section>

    <section v-else-if="loadError" class="state-card state-card--error">
      <span class="state-icon material-symbols-outlined">cloud_off</span>
      <h2>
        {{ label(REMOTE_DATA_ERROR_COPY.title.en, REMOTE_DATA_ERROR_COPY.title.zh) }}
      </h2>
      <p>
        {{ label(REMOTE_DATA_ERROR_COPY.description.en, REMOTE_DATA_ERROR_COPY.description.zh) }}
      </p>
      <button type="button" @click="loadAgents">
        <span class="material-symbols-outlined">refresh</span>
        {{ label(REMOTE_DATA_ERROR_COPY.action.en, REMOTE_DATA_ERROR_COPY.action.zh) }}
      </button>
    </section>

    <template v-else>
      <section v-if="filteredAgents.length" class="agent-grid" aria-live="polite">
        <article
          v-for="agent in filteredAgents"
          :key="agent.id"
          class="agent-card"
          :class="{ 'agent-card--featured': agent.featured }"
        >
          <div v-if="agent.featured" class="featured-ribbon">
            <span class="material-symbols-outlined">stars</span>
            {{ label('Featured', '精选') }}
          </div>

          <header class="agent-card__header">
            <div
              class="agent-logo"
              :class="{ 'agent-logo--fallback': !agent.logoUrl || logoFailures.has(agent.id) }"
            >
              <img
                v-if="agent.logoUrl && !logoFailures.has(agent.id)"
                :src="agent.logoUrl"
                :alt="`${getName(agent)} logo`"
                @error="markLogoFailed(agent.id)"
              />
              <span v-else>{{ getName(agent).slice(0, 1).toUpperCase() }}</span>
            </div>
            <div class="agent-identity">
              <h2>{{ getName(agent) }}</h2>
              <div class="agent-identity__meta">
                <span class="agent-vendor">{{ getVendor(agent) }}</span>
                <span class="category-badge">{{ categoryLabel(agent.category) }}</span>
              </div>
            </div>
          </header>

          <p class="agent-description">{{ getDescription(agent) }}</p>

          <ul v-if="getHighlights(agent).length" class="agent-highlights">
            <li v-for="highlight in getHighlights(agent)" :key="highlight">
              <span class="material-symbols-outlined" aria-hidden="true">verified</span>
              <span>{{ highlight }}</span>
            </li>
          </ul>

          <footer class="agent-card__actions">
            <button
              class="official-action"
              type="button"
              :disabled="openingId !== null"
              @click="openOfficialSite(agent)"
            >
              <span class="material-symbols-outlined" :class="{ spinning: openingId === agent.id }">
                {{ openingId === agent.id ? 'progress_activity' : 'open_in_new' }}
              </span>
              {{
                openingId === agent.id
                  ? label('Opening…', '正在打开…')
                  : label('Visit official site', '前往官网')
              }}
            </button>
          </footer>
        </article>
      </section>

      <section v-else class="state-card state-card--empty">
        <span class="state-icon material-symbols-outlined">manage_search</span>
        <h2>{{ label('No matching agents', '没有符合条件的智能体') }}</h2>
        <p>{{ label('Try another keyword or category.', '请更换关键词或分类筛选。') }}</p>
        <button type="button" @click="clearFilters">
          {{ label('Clear filters', '清除筛选') }}
        </button>
      </section>
    </template>
  </main>
</template>

<style scoped>
.agent-download-page {
  --market-accent: #61d6a8;
  min-height: calc(100vh - 72px);
  color: var(--text);
  background: transparent;
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-style: normal;
  font-weight: normal;
  font-size: 20px;
  line-height: 1;
  font-feature-settings: 'liga';
  -webkit-font-smoothing: antialiased;
  font-variation-settings:
    'FILL' 0,
    'wght' 450,
    'GRAD' 0,
    'opsz' 24;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: var(--page-section-gap);
}

.search-bar {
  display: flex;
  align-items: center;
}

.search-input-wrapper {
  position: relative;
  min-width: 0;
  flex: 1;
  max-width: 480px;
}

.agent-download-page .catalog-toolbar {
  flex-direction: row;
  margin-top: 0;
}

.agent-download-page .catalog-search {
  width: min(480px, 100%);
  max-width: 480px;
  height: auto;
  border: 0;
  border-radius: 0;
  color: inherit;
  background: transparent;
  box-shadow: none;
}

.agent-download-page .catalog-search:focus-within {
  border-color: transparent;
  box-shadow: none;
}

.search-icon {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: 13px;
  margin: 0 !important;
  color: var(--text-soft);
  font-size: 18px;
  pointer-events: none;
  transform: translateY(-50%);
}

.action-error button {
  display: grid;
  width: 38px;
  height: 38px;
  flex: 0 0 auto;
  padding: 0;
  place-items: center;
  border: 0;
  color: var(--text-soft);
  background: transparent;
  cursor: pointer;
}

.category-tabs {
  display: flex;
  flex-wrap: wrap;
  width: fit-content;
}

.category-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 0;
  border-radius: 8px;
  color: var(--text-muted);
  background: transparent;
  font-size: 13px;
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 0.2s ease;
}

.category-tab:hover {
  color: var(--text);
  background: var(--surface-container-high);
}

.category-tab.active {
  color: var(--primary-on);
  background: var(--primary);
  font-weight: var(--weight-semibold);
}

.category-tabs .material-symbols-outlined {
  font-size: 17px;
}

.agent-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  width: fit-content;
  max-width: 100%;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: var(--surface-container);
}

.agent-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  color: var(--text-muted);
  background: var(--surface);
  font-family: inherit;
  font-size: 13px;
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.agent-filter-logo {
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  place-items: center;
  overflow: hidden;
  border-radius: 5px;
  color: var(--primary);
  background: #fff;
  font-size: 10px;
  font-weight: var(--weight-semibold);
  line-height: 1;
}

.agent-filter-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.agent-filter-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--surface-container-high);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.agent-filter-btn:active {
  transform: translateY(0) scale(0.97);
}

.agent-filter-btn.active {
  color: var(--primary-on);
  background: var(--primary);
  border-color: var(--primary);
  font-weight: var(--weight-semibold);
}

.agent-filter-btn.active:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.agent-filter-btn.active .agent-filter-logo {
  color: var(--primary);
  background: #fff;
}

.action-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 11px 13px;
  border: 1px solid color-mix(in srgb, var(--error, #ef6b73) 42%, transparent);
  border-radius: 11px;
  color: var(--error, #ef6b73);
  background: color-mix(in srgb, var(--error, #ef6b73) 8%, var(--surface));
  font-size: 13px;
}

.action-error > span:nth-child(2) {
  flex: 1;
}

.agent-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.agent-card {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  padding: 20px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-low);
  box-shadow: var(--shadow-card);
  transition:
    transform 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.agent-card:hover {
  border-color: var(--border-strong);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-1px);
}

.agent-card--featured {
  border-color: color-mix(in srgb, var(--market-accent) 43%, var(--border));
}

.featured-ribbon {
  position: absolute;
  top: 0;
  right: 16px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px 6px;
  border-radius: 0 0 9px 9px;
  color: #07160f;
  background: var(--market-accent);
  font-size: 10px;
  font-weight: var(--weight-semibold);
}

.featured-ribbon .material-symbols-outlined {
  font-size: 14px;
  font-variation-settings:
    'FILL' 1,
    'wght' 550,
    'GRAD' 0,
    'opsz' 20;
}

.agent-card__header {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding-right: 2px;
}

.agent-card--featured .agent-card__header {
  padding-right: 84px;
}

.agent-logo {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  background: #fff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.agent-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.agent-logo--fallback {
  color: var(--primary);
  background: linear-gradient(145deg, var(--surface-container-high), var(--surface-lowest));
  font-family: var(--font-sans);
  font-size: 20px;
  font-weight: var(--weight-semibold);
}

.agent-identity {
  min-width: 0;
  flex: 1;
}

.agent-identity__meta {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 5px;
}

.agent-vendor {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  color: var(--text-soft);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-identity h2 {
  margin: 0;
  overflow: hidden;
  color: var(--text);
  font-size: 16px;
  font-weight: var(--weight-semibold);
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-badge {
  display: inline-block;
  flex: 0 0 auto;
  max-width: 102px;
  margin: 0;
  overflow: hidden;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.agent-description {
  display: -webkit-box;
  min-height: 0;
  margin: 13px 0 0;
  overflow: hidden;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 20px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.agent-highlights {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 15px 0 0;
  padding: 0;
  list-style: none;
}

.agent-highlights li {
  display: grid;
  grid-template-columns: 17px minmax(0, 1fr) 17px;
  min-width: 0;
  min-height: 48px;
  align-items: center;
  column-gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  color: var(--text-muted);
  background: var(--surface-container);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

.agent-highlights .material-symbols-outlined {
  grid-column: 1;
  grid-row: 1;
  justify-self: start;
  flex: 0 0 auto;
  color: var(--market-accent);
  font-size: 17px;
  font-variation-settings:
    'FILL' 1,
    'wght' 500,
    'GRAD' 0,
    'opsz' 20;
}

.agent-highlights li > span:last-child {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  justify-self: center;
  overflow-wrap: anywhere;
}

.agent-card__actions {
  display: flex;
  margin-top: 15px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}

.agent-card__actions button {
  display: inline-flex;
  min-width: 0;
  min-height: 38px;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: var(--weight-medium);
  cursor: pointer;
}

.official-action {
  border: 1px solid transparent;
  color: var(--primary-on);
  background: linear-gradient(120deg, var(--primary-deep), var(--primary));
  box-shadow: 0 5px 16px color-mix(in srgb, var(--primary) 20%, transparent);
}

.official-action:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.official-action:disabled {
  border-color: var(--border);
  color: var(--text-soft);
  background: var(--surface-container-high);
  box-shadow: none;
  cursor: not-allowed;
}

.agent-card__actions .material-symbols-outlined {
  font-size: 17px;
}

.state-card {
  display: flex;
  min-height: 330px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  margin: 0;
  padding: 34px;
  border: 1px dashed var(--border-strong);
  border-radius: 16px;
  color: var(--text-muted);
  background: var(--surface);
  text-align: center;
}

.state-card h2 {
  margin: 16px 0 6px;
  color: var(--text);
  font-size: 18px;
}

.state-card p {
  max-width: 520px;
  margin: 0;
  color: var(--text-soft);
  font-size: 13px;
  line-height: 20px;
}

.state-card button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 7px;
  margin-top: 18px;
  padding: 0 14px;
  border: 1px solid var(--primary);
  border-radius: 10px;
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  cursor: pointer;
}

.state-icon {
  color: var(--text-soft);
  font-size: 42px;
}

.state-card--error .state-icon {
  color: var(--error, #ef6b73);
}

.loading-ring {
  width: 34px;
  height: 34px;
  border: 3px solid var(--surface-container-high);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinning {
  animation: spin 0.85s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 760px) {
  .agent-download-page {
    padding: 16px;
  }
  .catalog-search {
    max-width: none;
  }
  .agent-grid {
    grid-template-columns: 1fr;
  }
  .agent-highlights {
    grid-template-columns: 1fr;
  }
}
</style>
