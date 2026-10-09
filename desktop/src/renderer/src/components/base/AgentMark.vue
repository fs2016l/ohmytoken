<script setup lang="ts">
import { computed } from 'vue'
import { agentColors, getAgentName } from '../../config/agents'
import { agentLogoUrl, initialOf, isMonochromeAgent } from '../../config/brand-logos'
const props = withDefaults(defineProps<{ agent: string; size?: number }>(), { size: 16 })
const url = computed(() => agentLogoUrl(props.agent))
const mono = computed(() => url.value && isMonochromeAgent(props.agent))
const initial = computed(() => initialOf(getAgentName(props.agent)))
const tileColor = computed(() => agentColors[props.agent] || '#64748b')
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
const maskStyle = computed(() => ({ ...box.value, maskImage: `url("${url.value}")` }))
const tileStyle = computed(() => ({
  ...box.value,
  background: tileColor.value,
  fontSize: `${Math.max(9, Math.round(props.size * 0.56))}px`,
}))
</script>
<template>
  <span v-if="mono" class="mark mark--mask" :style="maskStyle" aria-hidden="true" />
  <img v-else-if="url" class="mark" :src="url" :width="size" :height="size" alt="" />
  <span v-else class="mark mark--tile" :style="tileStyle" aria-hidden="true">{{ initial }}</span>
</template>
<style scoped>
.mark {
  flex: none;
  object-fit: contain;
  vertical-align: middle;
  border-radius: 3px;
}
.mark--mask {
  display: inline-block;
  background: currentColor;
  mask: center / contain no-repeat;
}
.mark--tile {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  line-height: 1;
  border-radius: 22%;
}
</style>
