/**
 * vue-router 路由配置（hash 模式，适配 Electron file:// 协议）
 *
 * 路由设计：
 *   /            → 重定向到 /agent
 *   /agent       → AgentPage（agent 维度 token 仪表盘）
 *   /token       → TokenPlanPage（各 vendor token 用量）
 *   /codingplan  → CodingPlanPage（套餐展示）
 *   /agent-download → AgentDownloadPage（智能体下载目录）
 *   /insight     → InsightPage（AI 信息差）
 *   /news        → redirect → /insight（旧入口兼容）
 *   /settings    → SettingsPage（设置）
 *   /:pathMatch  → ComingSoonPage（catch-all 404 占位）
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/agent' },
  {
    path: '/agent',
    name: 'agent',
    component: () => import('../views/AgentPage.vue'),
  },
  {
    path: '/token',
    name: 'token',
    component: () => import('../views/TokenPlanPage.vue'),
  },
  {
    path: '/codingplan',
    name: 'codingplan',
    component: () => import('../views/CodingPlanPage.vue'),
  },
  {
    path: '/agent-download',
    name: 'agent-download',
    component: () => import('../views/AgentDownloadPage.vue'),
  },
  {
    path: '/insight',
    name: 'insight',
    component: () => import('../views/InsightPage.vue'),
  },
  {
    // 旧入口兼容：历史 hash 路由 /news 重定向到 /insight
    path: '/news',
    redirect: '/insight',
  },
  {
    path: '/settings',
    name: 'settings',
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
  scrollBehavior(_to, _from, savedPosition) {
    // 浏览器前进/后退时恢复位置，切换菜单时回到顶部
    return savedPosition || { top: 0 }
  },
})

export default router
