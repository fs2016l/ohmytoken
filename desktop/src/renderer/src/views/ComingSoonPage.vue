<script setup lang="ts">
import { useI18n } from '../i18n/useI18n'

/**
 * 通用占位页（兼作路由 catch-all 404 页）
 *
 * 用法：
 *   - 作为路由 catch-all 404：通过 router props 传 icon + name
 *   - 作为"敬请期待"页：传入业务图标和名称
 */
defineProps<{
  icon: string
  name: string
}>()

const { label } = useI18n()
</script>

<template>
  <main style="display: flex; align-items: center; justify-content: center; flex: 1; min-height: 0">
    <div
      style="
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        padding: 60px 24px;
        text-align: center;
      "
    >
      <div
        style="
          width: 96px;
          height: 96px;
          border-radius: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(139, 92, 246, 0.12);
          border: 1px solid rgba(139, 92, 246, 0.25);
        "
      >
        <span class="material-symbols-outlined" style="font-size: 44px; color: #8b5cf6">
          {{ icon }}
        </span>
      </div>
      <div>
        <h2
          style="
            font-size: 22px;
            font-weight: var(--weight-semibold);
            color: var(--text-primary);
            margin: 0 0 6px 0;
          "
        >
          {{ name }}
        </h2>
        <p style="font-size: 14px; color: var(--text-secondary); margin: 0">
          {{ label('The page you are looking for does not exist.', '您访问的页面不存在。') }}
        </p>
      </div>
      <router-link
        to="/agent"
        style="
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border-radius: 10px;
          background: rgba(109, 59, 215, 0.1);
          border: 1px solid rgba(109, 59, 215, 0.25);
          color: var(--text-primary);
          text-decoration: none;
          font-size: 13px;
        "
      >
        <span class="material-symbols-outlined" style="font-size: 18px; color: #8b5cf6">
          arrow_back
        </span>
        <span>{{ label('Back to Dashboard', '返回首页') }}</span>
      </router-link>
    </div>
  </main>
</template>
