<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from '../i18n/useI18n'
import { getAllPlans } from '../api'
import PageIntro from '../components/base/PageIntro.vue'
import { REMOTE_DATA_ERROR_COPY } from '../config/remote-data-error'

const { currentLang, label } = useI18n()

// Types
interface PlanTier {
  id: string
  name: string
  nameEn: string
  price: string
  priceEn: string
  priceQuarterly?: string
  priceQuarterlyEn?: string
  periodQuarterly?: string
  periodQuarterlyEn?: string
  priceYearly?: string
  priceYearlyEn?: string
  periodYearly?: string
  periodYearlyEn?: string
  priceNote?: string
  priceNoteEn?: string
  period: string
  periodEn: string
  features: string[]
  featuresEn: string[]
  highlight?: boolean
  popular?: boolean
}

interface Provider {
  id: string
  name: string
  nameEn: string
  logoUrl?: string
  category: 'coding' | 'token' | 'payg'
  billingType: string
  billingTypeEn: string
  tagline: string
  taglineEn: string
  models: string[]
  purchaseUrl: string
  plans: PlanTier[]
}

// State
const logoFailures = ref<Set<string>>(new Set())
const providers = ref<Provider[]>([])
const loading = ref(true)
const loadError = ref('')

/**
 * 从 ohmytokencom 服务端获取套餐数据
 * 连接失败时设置 loadError，由 UI 显示错误状态和刷新按钮，不展示任何虚假数据
 */
async function loadProviders() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await getAllPlans()
    if (res.data?.code === 200 && res.data?.data) {
      providers.value = res.data.data as Provider[]
      logoFailures.value = new Set()
    } else {
      // API 返回了非 200 的业务错误
      console.warn('API 返回错误:', res.data?.msg)
      loadError.value = res.data?.msg || 'SERVER_ERROR'
    }
  } catch (e: unknown) {
    // 网络错误 / 服务不可达
    console.warn('加载套餐数据失败:', e instanceof Error ? e.message : String(e))
    loadError.value = 'NETWORK_ERROR'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadProviders()
})

type CategoryFilter = 'all' | 'coding' | 'token' | 'payg'
const activeCategory = ref<CategoryFilter>('all')
const searchQuery = ref('')
const selectedVendors = ref<Set<string>>(new Set())

const categoryOptions: { key: CategoryFilter; label: string; labelEn: string; icon: string }[] = [
  { key: 'all', label: '全部', labelEn: 'All', icon: 'grid_view' },
  { key: 'coding', label: '编程套餐', labelEn: 'Coding Plans', icon: 'code' },
  { key: 'token', label: 'Token 套餐', labelEn: 'Token Plans', icon: 'token' },
  { key: 'payg', label: '按量计费', labelEn: 'Pay-per-Use', icon: 'payments' },
]

// Computed
const categoryFilteredProviders = computed(() => {
  let result = [...providers.value]

  // Category filter
  if (activeCategory.value !== 'all') {
    result = result.filter((p) => p.category === activeCategory.value)
  }

  return result
})

const availableVendors = computed(() => {
  const seen = new Set<string>()
  return categoryFilteredProviders.value.filter((provider) => {
    if (seen.has(provider.id)) return false
    seen.add(provider.id)
    return true
  })
})

const filteredProviders = computed(() => {
  let result = [...categoryFilteredProviders.value]

  // Vendor filter
  if (selectedVendors.value.size > 0) {
    result = result.filter((p) => selectedVendors.value.has(p.id))
  }

  // Search filter
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.nameEn.toLowerCase().includes(q) ||
        p.models.some((m) => m.toLowerCase().includes(q)) ||
        p.tagline.toLowerCase().includes(q) ||
        p.taglineEn.toLowerCase().includes(q),
    )
  }

  return result
})

const providerCount = computed(() => filteredProviders.value.length)

watch(activeCategory, () => {
  selectedVendors.value = new Set()
})

// Methods
function getName(p: Provider): string {
  return currentLang.value === 'zh' ? p.name : p.nameEn
}

function getTagline(p: Provider): string {
  return currentLang.value === 'zh' ? p.tagline : p.taglineEn
}

function getBillingType(p: Provider): string {
  return currentLang.value === 'zh' ? p.billingType : p.billingTypeEn
}

function getPlanName(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.name : plan.nameEn
}

function getPlanPrice(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.price : plan.priceEn
}

function getPlanPriceQuarterly(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.priceQuarterly || '' : plan.priceQuarterlyEn || ''
}

function getPlanPeriodQuarterly(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.periodQuarterly || '' : plan.periodQuarterlyEn || ''
}

function getPlanPriceYearly(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.priceYearly || '' : plan.priceYearlyEn || ''
}

function getPlanPeriodYearly(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.periodYearly || '' : plan.periodYearlyEn || ''
}

function getPlanPeriod(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.period : plan.periodEn
}

function getPlanPriceNote(plan: PlanTier): string {
  return currentLang.value === 'zh' ? plan.priceNote || '' : plan.priceNoteEn || ''
}

function getPlanFeatures(plan: PlanTier): string[] {
  return currentLang.value === 'zh' ? plan.features : plan.featuresEn
}

function getCategoryLabel(cat: (typeof categoryOptions)[number]): string {
  return currentLang.value === 'zh' ? cat.label : cat.labelEn
}

function toggleVendor(id: string) {
  const next = new Set(selectedVendors.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedVendors.value = next
}

function isVendorSelected(id: string): boolean {
  return selectedVendors.value.has(id)
}

function markLogoFailed(id: string): void {
  const next = new Set(logoFailures.value)
  next.add(id)
  logoFailures.value = next
}

function openPurchase(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function getCategoryBadge(category: string): string {
  if (currentLang.value === 'zh') {
    switch (category) {
      case 'coding':
        return '编程套餐'
      case 'token':
        return 'Token 套餐'
      case 'payg':
        return '按量计费'
      default:
        return ''
    }
  } else {
    switch (category) {
      case 'coding':
        return 'Coding Plan'
      case 'token':
        return 'Token Plan'
      case 'payg':
        return 'Pay-per-Use'
      default:
        return ''
    }
  }
}

function getCategoryBadgeClass(category: string): string {
  switch (category) {
    case 'coding':
      return 'badge-coding'
    case 'token':
      return 'badge-token'
    case 'payg':
      return 'badge-payg'
    default:
      return ''
  }
}
</script>

<template>
  <div class="coding-plan-page">
    <!-- Page Header -->
    <div class="page-header">
      <PageIntro
        icon="receipt_long"
        :eyebrow="label('PLAN CATALOG', '套餐目录')"
        :title="label('Coding & Token Plans', '编程与 Token 套餐')"
        :subtitle="
          label(
            'Compare coding subscriptions and token plans from leading AI providers.',
            '集中对比主流大模型厂商的编程订阅与 Token 套餐。',
          )
        "
      />

      <!-- Search & Sort Bar -->
      <div class="search-bar catalog-toolbar">
        <div class="search-input-wrapper catalog-search">
          <span class="material-symbols-outlined search-icon">search</span>
          <input
            v-model="searchQuery"
            type="text"
            :placeholder="label('Search providers, models...', '搜索厂商、模型名称...')"
            class="search-input"
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
        <button class="catalog-refresh" type="button" :disabled="loading" @click="loadProviders">
          <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
          <span>{{ label('Refresh', '刷新') }}</span>
        </button>
      </div>
    </div>

    <!-- Category Tabs -->
    <div class="category-tabs" role="tablist">
      <button
        v-for="cat in categoryOptions"
        :key="cat.key"
        class="category-tab"
        :class="{ active: activeCategory === cat.key }"
        role="tab"
        :aria-selected="activeCategory === cat.key"
        @click="activeCategory = cat.key"
      >
        <span class="material-symbols-outlined">{{ cat.icon }}</span>
        <span>{{ getCategoryLabel(cat) }}</span>
      </button>
    </div>

    <!-- Vendor Filter -->
    <div
      v-if="availableVendors.length"
      class="vendor-filter-bar"
      role="group"
      :aria-label="label('Vendor filter', '厂商筛选')"
    >
      <button
        v-for="vendor in availableVendors"
        :key="vendor.id"
        type="button"
        class="vendor-filter-btn"
        :class="{ active: isVendorSelected(vendor.id) }"
        :aria-pressed="isVendorSelected(vendor.id)"
        @click="toggleVendor(vendor.id)"
      >
        <span class="vendor-filter-logo" aria-hidden="true">
          <img
            v-if="vendor.logoUrl && !logoFailures.has(vendor.id)"
            :src="vendor.logoUrl"
            alt=""
            @error="markLogoFailed(vendor.id)"
          />
          <span v-else>{{ getName(vendor).slice(0, 1).toUpperCase() }}</span>
        </span>
        <span>{{ getName(vendor) }}</span>
      </button>
    </div>

    <!-- Results count -->
    <div class="results-info">
      <span>{{ label(`${providerCount} providers found`, `共 ${providerCount} 家厂商`) }}</span>
    </div>

    <div v-if="!loading && !loadError && filteredProviders.length > 0" class="catalog-note">
      <span class="material-symbols-outlined">info</span>
      <span>
        {{
          label(
            '* Pricing is for reference only, please refer to official pages. Click plan cards to visit official purchase pages.',
            '* 价格信息仅供参考，以官方页面为准。点击套餐卡片可跳转至官方购买页面。',
          )
        }}
      </span>
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-state">
      <div class="loading-spinner"></div>
      <p>{{ label('Loading plans...', '加载套餐数据中...') }}</p>
    </div>

    <!-- Error State: 服务不可达，提供刷新按钮，绝不展示虚假数据 -->
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
      <button class="retry-btn" type="button" :disabled="loading" @click="loadProviders">
        <span class="material-symbols-outlined" :class="{ spinning: loading }">refresh</span>
        <span>
          {{ label(REMOTE_DATA_ERROR_COPY.action.en, REMOTE_DATA_ERROR_COPY.action.zh) }}
        </span>
      </button>
    </div>

    <!-- Provider Cards Grid -->
    <div v-else-if="providers.length" class="providers-grid">
      <div v-for="provider in filteredProviders" :key="provider.id" class="provider-card">
        <!-- Card Header -->
        <div class="provider-header">
          <div class="provider-logo">
            <img
              v-if="provider.logoUrl && !logoFailures.has(provider.id)"
              :src="provider.logoUrl"
              :alt="`${getName(provider)} logo`"
              @error="markLogoFailed(provider.id)"
            />
            <span v-else>{{ getName(provider).slice(0, 1).toUpperCase() }}</span>
          </div>
          <div class="provider-info">
            <h3 class="provider-name">{{ getName(provider) }}</h3>
            <span class="provider-badge" :class="getCategoryBadgeClass(provider.category)">
              {{ getCategoryBadge(provider.category) }}
            </span>
          </div>
        </div>

        <p class="provider-tagline">{{ getTagline(provider) }}</p>

        <!-- Models -->
        <div class="models-section">
          <span class="models-label">{{ label('Models', '支持模型') }}</span>
          <div class="models-list">
            <span v-for="model in provider.models" :key="model" class="model-tag">{{ model }}</span>
          </div>
        </div>

        <!-- Billing Type -->
        <div class="billing-info">
          <span class="material-symbols-outlined">payments</span>
          <span>{{ getBillingType(provider) }}</span>
        </div>

        <!-- Plans -->
        <div class="plans-section">
          <div
            v-for="plan in provider.plans"
            :key="plan.id"
            class="plan-card"
            :class="{ highlight: plan.highlight, popular: plan.popular }"
            @click="openPurchase(provider.purchaseUrl)"
          >
            <div v-if="plan.popular" class="popular-badge">{{ label('Popular', '推荐') }}</div>
            <div v-if="plan.highlight" class="highlight-badge">{{ label('Flagship', '旗舰') }}</div>

            <div class="plan-name">{{ getPlanName(plan) }}</div>
            <div class="plan-price">
              <span class="price-value">{{ getPlanPrice(plan) }}</span>
              <span class="price-period">{{ getPlanPeriod(plan) }}</span>
              <template v-if="getPlanPriceQuarterly(plan)">
                <span class="price-sep">·</span>
                <span class="alt-price">{{ getPlanPriceQuarterly(plan) }}</span>
                <span class="alt-period">{{ getPlanPeriodQuarterly(plan) }}</span>
              </template>
              <template v-if="getPlanPriceYearly(plan)">
                <span class="price-sep">·</span>
                <span class="alt-price">{{ getPlanPriceYearly(plan) }}</span>
                <span class="alt-period">{{ getPlanPeriodYearly(plan) }}</span>
              </template>
            </div>
            <div v-if="getPlanPriceNote(plan)" class="plan-price-note">
              {{ getPlanPriceNote(plan) }}
            </div>

            <ul class="plan-features">
              <li v-for="(feature, idx) in getPlanFeatures(plan)" :key="idx">
                <span class="material-symbols-outlined check-icon">check_circle</span>
                <span>{{ feature }}</span>
              </li>
            </ul>

            <button class="purchase-btn" type="button">
              <span>{{ label('Buy Now', '立即购买') }}</span>
              <span class="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty State: 仅在数据成功加载但筛选无结果时显示（加载失败走 error-state） -->
    <div v-if="!loading && !loadError && filteredProviders.length === 0" class="empty-state">
      <div class="empty-icon">
        <span class="material-symbols-outlined">search_off</span>
      </div>
      <h3>{{ label('No providers found', '未找到相关厂商') }}</h3>
      <p>{{ label('Try different keywords or categories', '试试其他搜索关键词或分类') }}</p>
    </div>
  </div>
</template>

<style scoped>
.coding-plan-page {
  --coding-color: #4edea3;
  --token-color: #60a5fa;
  --payg-color: #fbbf24;

  min-height: calc(100vh - 64px);
  background: var(--bg-base);
  color: var(--text);
}

.material-symbols-outlined {
  font-family: 'Material Symbols Outlined';
  font-weight: normal;
  font-style: normal;
  font-size: 20px;
  line-height: 1;
  letter-spacing: 0;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
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

/* Page Header */
.page-header {
  display: flex;
  flex-direction: column;
}

/* Search Bar */
.search-bar {
  display: flex;
  align-items: center;
}

.search-input-wrapper {
  flex: 1;
  position: relative;
  max-width: 480px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-soft);
  font-size: 20px;
}

.search-input {
  width: 100%;
  height: 42px;
  padding: 0 14px 0 40px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface-container);
  color: var(--text);
  font-size: 14px;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.search-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(208, 188, 255, 0.12);
}

.search-input::placeholder {
  color: var(--text-soft);
}

.sort-select {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  height: 42px;
  border: 1px solid var(--border-strong);
  border-radius: 10px;
  background: var(--surface-container);
  color: var(--text-muted);
}

.sort-select .material-symbols-outlined {
  font-size: 18px;
}

.sort-dropdown {
  background: transparent;
  border: none;
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.sort-dropdown option {
  background: var(--surface-container);
  color: var(--text);
}

/* Category Tabs */
.category-tabs {
  display: flex;
  padding: 4px;
  background: var(--surface-container);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  width: fit-content;
}

.category-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: all 0.2s ease;
}

.category-tab .material-symbols-outlined {
  font-size: 18px;
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

/* Vendor Filter */
.vendor-filter-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  background: var(--surface-container);
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  width: fit-content;
  max-width: 100%;
}

.vendor-filter-label {
  padding: 0 8px;
  color: var(--text-soft);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.vendor-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  font-weight: var(--weight-medium);
  font-family: inherit;
  cursor: pointer;
  transition:
    color 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}

.vendor-filter-logo {
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

.vendor-filter-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.vendor-filter-btn:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--surface-container-high);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.vendor-filter-btn:active {
  transform: translateY(0) scale(0.97);
}

.vendor-filter-btn.active {
  color: var(--primary-on);
  background: var(--primary);
  border-color: var(--primary);
  font-weight: var(--weight-semibold);
}

.vendor-filter-btn.active:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

/* Results Info */
.results-info {
  font-size: 13px;
  color: var(--text-soft);
}

/* Providers Grid - 1 provider per row */
.providers-grid {
  display: grid;
  grid-template-columns: 1fr;
}

/* Provider Card */
.provider-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-card);
}

.provider-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow-card-hover);
  transform: translateY(-2px);
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.provider-logo {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 48px;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 12px;
  color: var(--primary);
  background: #fff;
  font-size: 24px;
  font-weight: var(--weight-semibold);
}

.provider-logo img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.provider-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.provider-name {
  font-size: 17px;
  font-weight: var(--weight-semibold);
  margin: 0;
  color: var(--text);
}

.provider-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: var(--type-caption);
  font-weight: var(--weight-medium);
  width: fit-content;
}

.badge-coding {
  background: rgba(78, 222, 163, 0.15);
  color: var(--coding-color);
  border: 1px solid rgba(78, 222, 163, 0.3);
}

.badge-token {
  background: rgba(96, 165, 250, 0.15);
  color: var(--token-color);
  border: 1px solid rgba(96, 165, 250, 0.3);
}

.badge-payg {
  background: rgba(251, 191, 36, 0.15);
  color: var(--payg-color);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

.provider-tagline {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 14px 0;
  line-height: 1.5;
}

/* Models Section */
.models-section {
  margin-bottom: 14px;
}

.models-label {
  font-size: var(--type-caption);
  font-weight: var(--weight-medium);
  color: var(--text-soft);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  display: block;
}

.models-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-tag {
  display: inline-block;
  padding: 3px 8px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: var(--type-caption);
  color: var(--text-muted);
  white-space: nowrap;
}

/* Billing Info */
.billing-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-soft);
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}

.billing-info .material-symbols-outlined {
  font-size: 16px;
}

/* Plans Section - 横向布局 */
.plans-section {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 12px;
  flex: 1;
}

.plan-card {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 180px;
  min-width: 160px;
  padding: 14px;
  background: var(--surface-container);
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.25s ease;
  overflow: hidden;
}

.plan-card:hover {
  border-color: var(--primary);
  background: var(--surface-container-high);
  transform: translateY(-4px);
}

.plan-card.highlight {
  border-color: var(--border-emphasis);
  background: linear-gradient(135deg, var(--surface-emphasis-strong), var(--surface-emphasis) 78%);
}

.plan-card.highlight:hover {
  border-color: var(--primary);
  box-shadow: 0 4px 20px var(--glow-emphasis);
}

.popular-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 8px;
  background: var(--tertiary);
  color: var(--tertiary-on);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.highlight-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  padding: 2px 8px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  color: var(--primary-on);
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  border-radius: 999px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.plan-name {
  font-size: 14px;
  font-weight: var(--weight-semibold);
  color: var(--text);
  margin-bottom: 6px;
}

.plan-price {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px;
  margin-bottom: 2px;
}

.price-sep {
  color: var(--text-soft);
  opacity: 0.5;
  margin: 0 4px;
}

.price-value {
  font-size: 22px;
  font-weight: var(--weight-semibold);
  color: var(--primary);
  line-height: 1.2;
}

.price-period {
  font-size: 12px;
  color: var(--text-soft);
}

.plan-price-alt {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 6px;
  margin: 2px 0 8px 0;
}

.alt-price {
  font-size: 22px;
  font-weight: var(--weight-semibold);
  color: var(--primary);
  line-height: 1.2;
}

.alt-period {
  font-size: 12px;
  color: var(--text-soft);
}

.alt-sep {
  color: var(--text-soft);
  opacity: 0.6;
}

.plan-price-note {
  font-size: var(--type-caption);
  color: var(--text-soft);
  margin-bottom: 10px;
}

.plan-features {
  list-style: none;
  padding: 0;
  margin: 0 0 12px 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}

.plan-features li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.check-icon {
  font-size: 14px;
  color: var(--tertiary);
  flex-shrink: 0;
  font-variation-settings:
    'FILL' 1,
    'wght' 400,
    'GRAD' 0,
    'opsz' 20;
}

.purchase-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 14px;
  background: var(--primary);
  color: var(--primary-on);
  border: none;
  border-radius: 8px;
  font-size: 12px;
  font-weight: var(--weight-semibold);
  cursor: pointer;
  transition: all 0.2s ease;
}

.purchase-btn:hover {
  filter: brightness(1.1);
  transform: scale(1.02);
}

.purchase-btn .material-symbols-outlined {
  font-size: 16px;
  transition: transform 0.2s ease;
}

.plan-card:hover .purchase-btn .material-symbols-outlined {
  transform: translateX(2px);
}

/* Loading State */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
  width: 100%;
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
  color: var(--text-soft);
  font-size: 14px;
  margin: 0;
}

/* Error State */
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

/* Empty State */
.empty-state {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
}

.empty-icon {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-container);
  border: 1px solid var(--border-strong);
  margin-bottom: 16px;
}

.empty-icon .material-symbols-outlined {
  font-size: 40px;
  color: var(--text-soft);
}

.empty-state h3 {
  font-size: 18px;
  font-weight: var(--weight-semibold);
  color: var(--text);
  margin: 0 0 8px 0;
}

.empty-state p {
  font-size: 14px;
  color: var(--text-soft);
  margin: 0;
}

/* Responsive */
@media (max-width: 900px) {
  .providers-grid {
    grid-template-columns: 1fr;
  }

  .search-bar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input-wrapper {
    max-width: none;
  }

  .sort-select {
    justify-content: center;
  }
}

@media (max-width: 600px) {
  .category-tabs {
    overflow-x: auto;
    width: 100%;
    white-space: nowrap;
  }

  .category-tab {
    flex-shrink: 0;
  }
}
</style>
