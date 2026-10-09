<script setup lang="ts">
import { computed } from 'vue'
import { useTheme } from '../../composables/useTheme'
import { builtinThemes } from '../../config/themes'

withDefaults(defineProps<{ size?: number }>(), { size: 24 })

const THEME_ICON_SIZES = [16, 24, 32, 48, 64, 256] as const

const builtinPaletteIds = new Set(builtinThemes.map((theme) => theme.id))

const { currentTheme, currentAccent } = useTheme()

// 逐尺寸文件带小尺寸视觉校正；sizes 按显示尺寸让浏览器选对应文件。
function themedIconUrl(size: number): string {
  const appearance = currentTheme.value
  const selected = builtinPaletteIds.has(currentAccent.value) ? currentAccent.value : 'classic'
  const palette = selected === 'copper' && appearance === 'light' ? 'classic' : selected
  return `./brand/icons/${palette}/${appearance}/Icon-${size}.png`
}

const brandMarkUrl = computed(() => themedIconUrl(32))
const brandMarkSrcset = computed(() =>
  THEME_ICON_SIZES.map((size) => `${themedIconUrl(size)} ${size}w`).join(', '),
)
</script>

<template>
  <img
    class="brand-mark-image"
    :src="brandMarkUrl"
    :srcset="brandMarkSrcset"
    :sizes="`${size}px`"
    alt=""
    aria-hidden="true"
    draggable="false"
  />
</template>

<style scoped>
.brand-mark-image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
</style>
