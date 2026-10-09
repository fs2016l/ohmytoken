<script setup lang="ts">
import { motion } from '../../config/motion'

defineProps<{ open: boolean }>()
</script>

<template>
  <div
    class="collapse-region"
    :class="{ 'collapse-region--open': open }"
    :style="{ '--collapse-duration': `${motion.detail}ms`, '--collapse-ease': motion.entranceEase }"
    :inert="!open"
    :aria-hidden="!open"
  >
    <div class="collapse-region__clip">
      <div class="collapse-region__body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.collapse-region {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition:
    grid-template-rows var(--collapse-duration) var(--collapse-ease),
    opacity var(--collapse-duration) var(--collapse-ease);
}
.collapse-region--open {
  grid-template-rows: 1fr;
  opacity: 1;
}
.collapse-region__clip {
  min-height: 0;
  overflow: hidden;
  visibility: hidden;
  transition: visibility 0s var(--collapse-duration);
}
.collapse-region--open > .collapse-region__clip {
  visibility: visible;
  transition-delay: 0s;
}
.collapse-region__body {
  /* Keep slotted margins inside the animated height. No fixed maximum height. */
  display: flow-root;
}
@media (prefers-reduced-motion: reduce) {
  .collapse-region,
  .collapse-region__clip {
    transition: none;
  }
}
</style>
