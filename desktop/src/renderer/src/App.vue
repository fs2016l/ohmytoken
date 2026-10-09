<script setup lang="ts">
import AppLayout from './components/layout/AppLayout.vue'
import WindowTitleBar from './components/layout/WindowTitleBar.vue'

const windowControlsOverlay = window.api?.windowControlsOverlay === true
</script>

<template>
  <div class="app-window">
    <WindowTitleBar v-if="windowControlsOverlay" />
    <AppLayout />
  </div>
</template>

<style scoped>
.app-window {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}
.app-window > :deep(.omt-app) {
  flex: 1;
  height: auto;
  min-height: 0;
}
</style>
