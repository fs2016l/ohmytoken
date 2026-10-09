<script setup lang="ts">
import { computed } from 'vue'
import { initialOf, modelLogoUrl, modelTileColor } from '../../config/brand-logos'
const props = withDefaults(defineProps<{ model: string; size?: number }>(), { size: 16 })
const url = computed(() => modelLogoUrl(props.model))
const initial = computed(() => initialOf(props.model))
const box = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
const tileStyle = computed(() => ({
  ...box.value,
  background: modelTileColor(props.model),
  fontSize: `${Math.max(9, Math.round(props.size * 0.56))}px`,
}))
</script>
<template>
  <img v-if="url" class="mark" :src="url" :width="size" :height="size" alt="" />
  <span v-else class="mark mark--tile" :style="tileStyle" aria-hidden="true">{{ initial }}</span>
</template>
<style scoped>
.mark {
  flex: none;
  object-fit: contain;
  vertical-align: middle;
  border-radius: 3px;
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
