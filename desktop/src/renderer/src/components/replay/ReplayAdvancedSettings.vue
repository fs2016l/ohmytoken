<script setup lang="ts">
import { ref } from 'vue'
import CollapseRegion from '../base/CollapseRegion.vue'

defineProps<{ label: string; summary: string }>()
const open = ref(false)
</script>

<template>
  <div class="replay-advanced">
    <button
      type="button"
      class="replay-advanced-toggle"
      :aria-expanded="open"
      aria-controls="replay-advanced-options"
      :aria-label="label"
      @click="open = !open"
    >
      <span>{{ label }}</span>
      <span class="replay-advanced-summary">{{ summary }}</span>
      <span class="replay-advanced-chevron material-symbols-outlined" aria-hidden="true">
        expand_more
      </span>
    </button>
    <CollapseRegion id="replay-advanced-options" :open="open"><slot /></CollapseRegion>
  </div>
</template>
