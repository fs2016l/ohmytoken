<script setup lang="ts">
import { computed } from 'vue'
import { TOKEN_PLAN_PROVIDER_BY_ID } from '../../config/token-plan-providers'
import { initialOf, isMonochromeVendor, vendorLogoUrl } from '../../config/brand-logos'
const props = withDefaults(defineProps<{ provider: string; size?: number }>(), { size: 18 })
const meta = computed(() => TOKEN_PLAN_PROVIDER_BY_ID[props.provider])
const url = computed(() => vendorLogoUrl(props.provider))
const mono = computed(() => url.value && isMonochromeVendor(props.provider))
const name = computed(() => meta.value?.nameEn || props.provider)
const initial = computed(() => initialOf(name.value))
const tileColor = computed(() => meta.value?.brandColor || '#64748b')
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
