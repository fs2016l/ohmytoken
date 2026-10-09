<script setup lang="ts">
import type { VNode } from 'vue'
import PageSurface from '../base/PageSurface.vue'
defineProps<{ component: VNode; pageKey: string; ownsSurface: boolean }>()
</script>
<template>
  <div class="route-view">
    <component :is="component" v-if="ownsSurface" />
    <PageSurface v-else :page-key="pageKey"><component :is="component" /></PageSurface>
  </div>
</template>
<style scoped>
.route-view {
  height: 100%;
  min-height: 0;
  min-width: 0;
}
</style>
