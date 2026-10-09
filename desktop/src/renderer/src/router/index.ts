/**
 * vue-router 路由配置（hash 模式，适配 Electron file:// 协议）
 *
 * 路由设计：
 *   /            → 重定向到 /agent
 *   /agent       → AgentPage（agent 维度 token 仪表盘）
 *   /token       → TokenPlanPage（各 vendor token 用量）
 *   /codingplan、/agent-download、/insight 及其子路由
 *                 → DiscoveryRoute（由 Cloud discovery 页面展示）
 *   /news        → redirect → /insight（旧入口兼容）
 *   /network-check → NetworkCheckPage（IP 质量与 AI 服务访问检测）
 *   /settings    → SettingsPage（设置）
 *   /:pathMatch  → ComingSoonPage（catch-all 404 占位）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import DiscoveryRoute from '../components/discovery/DiscoveryRoute.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/agent' },
  {
    path: '/agent',
    name: 'agent',
    meta: { surface: true },
    component: () => import('../views/OverviewPage.vue'),
  },
  {
    path: '/sessions',
    name: 'sessions',
    meta: { surface: true },
    component: () => import('../views/SessionsPage.vue'),
  },
  {
    path: '/projects',
    name: 'projects',
    meta: { surface: true },
    component: () => import('../views/ProjectsPage.vue'),
  },
  {
    path: '/analytics',
    name: 'analytics',
    meta: { surface: true },
    component: () => import('../views/AnalyticsPage.vue'),
  },
  {
    path: '/analytics/models/:id',
    name: 'model-detail',
    meta: { surface: true },
    component: () => import('../views/ModelDetailPage.vue'),
  },
  {
    path: '/analytics/fees',
    name: 'fee-detail',
    meta: { surface: true },
    component: () => import('../views/FeeDetailPage.vue'),
  },
  {
    path: '/token',
    name: 'token',
    meta: { surface: true },
    component: () => import('../views/TokenPlanPage.vue'),
  },
  {
    path: '/codingplan',
    name: 'codingplan',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/codingplan/favorites',
    name: 'codingplan-favorites',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/agent-download',
    name: 'agent-download',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/agent-download/favorites',
    name: 'agent-download-favorites',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/agent-download/:id(\\d+)',
    name: 'agent-download-detail',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/insight',
    name: 'insight',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/insight/favorites',
    name: 'insight-favorites',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    path: '/insight/:id(\\d+)',
    name: 'insight-detail',
    meta: { surface: true },
    component: DiscoveryRoute,
  },
  {
    // 旧入口兼容：历史 hash 路由 /news 重定向到 /insight
    path: '/news',
    redirect: '/insight',
  },
  {
    path: '/network-check',
    name: 'network-check',
    component: () => import('../views/NetworkCheckPage.vue'),
    meta: { surface: true },
  },
  {
    path: '/network-monitor',
    name: 'network-monitor',
    component: () => import('../views/NetworkMonitorPage.vue'),
    meta: { surface: true },
  },
  {
    path: '/generation-history',
    name: 'generation-history',
    component: () => import('../views/GenerationHistoryPage.vue'),
    meta: { surface: true },
  },
  {
    path: '/settings',
    name: 'settings',
    redirect: '/settings/general',
  },
  {
    path: '/settings/:section(general|appearance|account|diagnostics|feedback|about)',
    name: 'settings-section',
    meta: { surface: true },
    component: () => import('../views/SettingsPage.vue'),
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('../views/ComingSoonPage.vue'),
    props: {
      icon: 'sentiment_dissatisfied',
      name: '404',
    },
  },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // Each destination owns and restores its actual scrolling element.
  scrollBehavior: () => false,
})

export default router
