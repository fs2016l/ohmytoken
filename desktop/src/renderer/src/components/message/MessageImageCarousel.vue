<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from '../../i18n/useI18n'
import type { CustomMessageImageData } from '@shared/custom-message'

const props = defineProps<{ images: CustomMessageImageData[]; title: string }>()
const emit = defineEmits<{ open: [actionUrl: string] }>()

const { label } = useI18n()
const activeIndex = ref(0)
const direction = ref<'left' | 'right'>('left')
const currentImage = computed(() => props.images[activeIndex.value] || null)

function hasActionLink(actionUrl?: string): boolean {
  return /^https?:\/\/\S+$/i.test(actionUrl?.trim() || '')
}

function select(index: number, nextDirection: 'left' | 'right'): void {
  if (props.images.length <= 1) return
  direction.value = nextDirection
  activeIndex.value = (index + props.images.length) % props.images.length
}

function previous(): void {
  select(activeIndex.value - 1, 'right')
}

function next(): void {
  select(activeIndex.value + 1, 'left')
}

function openCurrent(): void {
  const actionUrl = currentImage.value?.actionUrl
  if (hasActionLink(actionUrl) && actionUrl) emit('open', actionUrl)
}

watch(
  () => props.images.map((image) => image.id).join(','),
  () => {
    activeIndex.value = 0
    direction.value = 'left'
  },
)
</script>

<template>
  <div v-if="currentImage" class="carousel">
    <Transition :name="direction === 'left' ? 'carousel-next' : 'carousel-previous'">
      <button
        :key="currentImage.id"
        class="carousel-frame"
        :class="{ 'carousel-frame--linked': hasActionLink(currentImage.actionUrl) }"
        type="button"
        :disabled="!hasActionLink(currentImage.actionUrl)"
        :aria-label="
          hasActionLink(currentImage.actionUrl)
            ? label('Open image link', '打开图片链接')
            : undefined
        "
        @click="openCurrent"
      >
        <img :src="currentImage.imageUrl" :alt="`${title} ${activeIndex + 1}`" />
        <span v-if="hasActionLink(currentImage.actionUrl)" class="carousel-link-hint">
          {{ label('Open link', '打开链接') }} ↗
        </span>
      </button>
    </Transition>

    <template v-if="images.length > 1">
      <button
        class="carousel-arrow carousel-arrow--previous"
        type="button"
        :aria-label="label('Previous image', '上一张图片')"
        @click="previous"
      >
        ‹
      </button>
      <button
        class="carousel-arrow carousel-arrow--next"
        type="button"
        :aria-label="label('Next image', '下一张图片')"
        @click="next"
      >
        ›
      </button>
      <div class="carousel-pagination">
        <button
          v-for="(image, index) in images"
          :key="image.id"
          type="button"
          :class="{ active: index === activeIndex }"
          :aria-label="`${label('Image', '图片')} ${index + 1}`"
          @click="select(index, index > activeIndex ? 'left' : 'right')"
        ></button>
        <span>{{ activeIndex + 1 }}/{{ images.length }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.carousel {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: color-mix(in srgb, var(--surface-container) 82%, #000);
  border-radius: 18px 18px 0 0;
}
.carousel-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  overflow: hidden;
  color: var(--text);
  background: transparent;
  border: 0;
  opacity: 1;
  cursor: default;
}
.carousel-frame--linked {
  cursor: pointer;
}
.carousel-frame img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}
.carousel-link-hint {
  position: absolute;
  right: 12px;
  bottom: 12px;
  padding: 6px 9px;
  color: #fff;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  font-size: var(--type-caption);
  font-weight: var(--weight-semibold);
  backdrop-filter: blur(6px);
}
.carousel-arrow {
  position: absolute;
  z-index: 2;
  top: 50%;
  width: 38px;
  height: 46px;
  display: grid;
  place-items: center;
  padding: 0;
  color: #fff;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  font-size: 28px;
  line-height: 1;
  cursor: pointer;
  transform: translateY(-50%);
  backdrop-filter: blur(6px);
}
.carousel-arrow--previous {
  left: 12px;
}
.carousel-arrow--next {
  right: 12px;
}
.carousel-pagination {
  position: absolute;
  z-index: 2;
  left: 50%;
  bottom: 12px;
  min-height: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 9px;
  color: #fff;
  background: rgba(15, 23, 42, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  font-size: var(--type-caption);
  transform: translateX(-50%);
  backdrop-filter: blur(6px);
}
.carousel-pagination button {
  width: 6px;
  height: 6px;
  padding: 0;
  background: rgba(255, 255, 255, 0.5);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition:
    width 0.18s ease,
    background 0.18s ease;
}
.carousel-pagination button.active {
  width: 16px;
  background: #fff;
}
.carousel-next-enter-active,
.carousel-next-leave-active,
.carousel-previous-enter-active,
.carousel-previous-leave-active {
  transition:
    transform 0.28s cubic-bezier(0.22, 0.75, 0.28, 1),
    opacity 0.28s ease;
}
.carousel-next-enter-from,
.carousel-previous-leave-to {
  opacity: 0.7;
  transform: translateX(100%);
}
.carousel-next-leave-to,
.carousel-previous-enter-from {
  opacity: 0.7;
  transform: translateX(-100%);
}
@media (prefers-reduced-motion: reduce) {
  .carousel-next-enter-active,
  .carousel-next-leave-active,
  .carousel-previous-enter-active,
  .carousel-previous-leave-active {
    transition: none;
  }
}
</style>
