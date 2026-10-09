<script setup lang="ts">
import { WINDOW_CHROME_HEIGHT } from '@shared/window-chrome'
import BrandMark from '../base/BrandMark.vue'
</script>

<template>
  <header
    class="window-titlebar"
    :style="{ '--window-titlebar-height': `${WINDOW_CHROME_HEIGHT}px` }"
  >
    <div class="window-titlebar__content">
      <BrandMark :size="16" />
      <span>ohmytoken</span>
    </div>
  </header>
</template>

<style scoped>
.window-titlebar {
  flex: none;
  height: env(titlebar-area-height, var(--window-titlebar-height));
  background: var(--sidebar);
  color: var(--text-muted);
  -webkit-app-region: drag;
  user-select: none;
}
.window-titlebar__content {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  margin-left: env(titlebar-area-x, 0px);
  width: env(titlebar-area-width, 100%);
  padding: 0 12px;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1;
}
.window-titlebar .brand-mark-image {
  width: 16px;
  height: 16px;
}
</style>
