<script setup lang="ts">
import AgentMark from './AgentMark.vue'
import ModelMark from './ModelMark.vue'
import { useRollingValue } from '../../composables/useRollingValue'
import { motion } from '../../config/motion'

const props = withDefaults(
  defineProps<{ kind: 'models' | 'agents'; value: string; size?: number }>(),
  { size: 16 },
)
const { element, currentElement, incomingElement, displayed, incoming } = useRollingValue(
  () => ({ kind: props.kind, value: props.value }),
  (left, right) => left.kind === right.kind && left.value === right.value,
)
</script>

<template>
  <span
    ref="element"
    class="rolling-mark"
    aria-hidden="true"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      perspective: `${motion.textRoll.perspective}px`,
    }"
  >
    <span ref="currentElement" class="rolling-mark__layer rolling-mark__current">
      <AgentMark v-if="displayed.kind === 'agents'" :agent="displayed.value" :size="size" />
      <ModelMark v-else :model="displayed.value" :size="size" />
    </span>
    <span
      v-if="incoming !== null"
      ref="incomingElement"
      class="rolling-mark__layer rolling-mark__incoming"
    >
      <AgentMark v-if="incoming.kind === 'agents'" :agent="incoming.value" :size="size" />
      <ModelMark v-else :model="incoming.value" :size="size" />
    </span>
  </span>
</template>

<style scoped>
.rolling-mark {
  position: relative;
  display: inline-block;
  flex: none;
  overflow: hidden;
  vertical-align: middle;
}
.rolling-mark__layer {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  backface-visibility: hidden;
  transform-origin: center;
}
.rolling-mark__incoming {
  opacity: 0;
}
</style>
