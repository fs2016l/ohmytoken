<script setup lang="ts">
import { useRollingValue } from '../../composables/useRollingValue'
import { motion } from '../../config/motion'

const props = defineProps<{ text: string; wrap?: boolean }>()
const { element, currentElement, incomingElement, displayed, incoming } = useRollingValue(
  () => props.text,
)
</script>

<template>
  <span
    ref="element"
    class="rolling-text"
    :class="{ 'rolling-text--wrap': wrap }"
    :title="text"
    :style="{ perspective: `${motion.textRoll.perspective}px` }"
  >
    <span class="rolling-text__size" :data-text="text" aria-hidden="true" />
    <span class="rolling-text__accessible">{{ text }}</span>
    <span ref="currentElement" class="rolling-text__line rolling-text__current" aria-hidden="true">
      {{ displayed }}
    </span>
    <span
      v-if="incoming !== null"
      ref="incomingElement"
      class="rolling-text__line rolling-text__incoming"
      aria-hidden="true"
    >
      {{ incoming }}
    </span>
  </span>
</template>

<style scoped>
.rolling-text {
  display: grid;
  position: relative;
  height: 1lh;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}
.rolling-text__size {
  min-width: 0;
  visibility: hidden;
  overflow: hidden;
  white-space: nowrap;
  pointer-events: none;
}
.rolling-text__size::before {
  content: attr(data-text);
}
.rolling-text--wrap {
  height: auto;
  min-height: 1lh;
}
.rolling-text--wrap .rolling-text__size,
.rolling-text--wrap .rolling-text__line {
  white-space: normal;
  overflow-wrap: anywhere;
}
.rolling-text__line {
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  backface-visibility: hidden;
  transform-origin: center;
}
.rolling-text__incoming {
  opacity: 0;
}
.rolling-text__accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
