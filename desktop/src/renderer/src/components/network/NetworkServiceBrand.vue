<script setup lang="ts">
import type { AiNetworkServiceId } from '@shared/network-check'
import openai from '../../assets/design/network-openai.svg'
import anthropic from '../../assets/design/network-claude.svg'
import google from '../../assets/design/network-gemini.svg'
import xai from '../../assets/design/network-grok.svg'
import copilot from '../../assets/design/network-copilot.svg'
withDefaults(defineProps<{ service: AiNetworkServiceId; size?: number }>(), { size: 28 })
const marks = { openai, anthropic, google, xai, copilot }
const mask = (service: AiNetworkServiceId): string => `url("${marks[service]}")`
const monochrome: AiNetworkServiceId[] = ['openai', 'xai']
</script>
<template>
  <span
    v-if="monochrome.includes(service)"
    class="network-brand network-brand--mask"
    :style="{ width: `${size}px`, height: `${size}px`, maskImage: mask(service) }"
    aria-hidden="true"
  />
  <img v-else class="network-brand" :src="marks[service]" :width="size" :height="size" alt="" />
</template>
<style scoped>
.network-brand {
  flex: none;
  object-fit: contain;
}
.network-brand--mask {
  display: inline-block;
  background: currentColor;
  mask: center / contain no-repeat;
}
</style>
