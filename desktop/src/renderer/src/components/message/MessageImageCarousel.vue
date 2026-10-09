<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { useI18n } from '../../i18n/useI18n'
import DesignIcon from '../base/DesignIcon.vue'
import type { CustomMessageImageData } from '@shared/custom-message'

const props = defineProps<{
  images: CustomMessageImageData[]
  title: string
  paused?: boolean
}>()
const emit = defineEmits<{
  open: [actionUrl: string]
  preview: [imageUrl: string, title: string]
}>()

const { label } = useI18n()
const gallery = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(gallery)
const activeIndex = ref(0)
const direction = ref<'left' | 'right'>('left')
const currentImage = computed(() => props.images[activeIndex.value] || null)
const portraits = reactive(new Set<string>())
const hovered = ref(false)
const keyboardFocus = ref(false)
const cycle = ref(0)
const canPlay = computed(
  () =>
    props.images.length > 1 &&
    visible.value &&
    !reduced.value &&
    !props.paused &&
    !hovered.value &&
    !keyboardFocus.value,
)
const IMAGE_DURATION_MS = 5000
let progressAnimation: Animation | undefined

function syncPlayback(): void {
  if (!progressAnimation) return
  if (canPlay.value) progressAnimation.play()
  else progressAnimation.pause()
}

function stopPlayback(): void {
  if (!progressAnimation) return
  progressAnimation.onfinish = null
  progressAnimation.cancel()
  progressAnimation = undefined
}

function restartPlayback(): void {
  stopPlayback()
  if (props.images.length <= 1 || reduced.value) return
  const fill = gallery.value?.querySelector(
    '.carousel-segment[aria-current="true"] .carousel-segment-fill',
  )
  if (!fill) return
  progressAnimation = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
    duration: IMAGE_DURATION_MS,
    easing: 'linear',
    fill: 'forwards',
  })
  progressAnimation.onfinish = next
  syncPlayback()
}

function measureImage(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  const url = image.dataset.imageUrl
  if (!url) return
  if (image.naturalHeight > image.naturalWidth) portraits.add(url)
  else portraits.delete(url)
}

function focusIn(event: FocusEvent): void {
  if (event.target instanceof Element && event.target.matches(':focus-visible'))
    keyboardFocus.value = true
}

function focusOut(event: FocusEvent): void {
  if (!(event.relatedTarget instanceof Node) || !gallery.value?.contains(event.relatedTarget))
    keyboardFocus.value = false
}

function handleKey(event: KeyboardEvent): void {
  keyboardFocus.value = true
  if (props.images.length <= 1 || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  if (event.key === 'ArrowLeft') previous()
  else next()
}

function hideLeavingFrame(element: Element): void {
  element.setAttribute('aria-hidden', 'true')
  if (element instanceof HTMLElement) element.inert = true
}

function hasActionLink(actionUrl?: string): boolean {
  return /^https?:\/\/\S+$/i.test(actionUrl?.trim() || '')
}

function select(index: number, nextDirection: 'left' | 'right'): void {
  if (props.images.length <= 1) return
  direction.value = nextDirection
  activeIndex.value = (index + props.images.length) % props.images.length
  cycle.value++
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
  else previewCurrent()
}

function previewCurrent(): void {
  if (currentImage.value) emit('preview', currentImage.value.imageUrl, props.title)
}

watch(
  () => JSON.stringify(props.images),
  () => {
    activeIndex.value = 0
    direction.value = 'left'
    const urls = new Set(props.images.map((image) => image.imageUrl))
    for (const url of portraits) if (!urls.has(url)) portraits.delete(url)
    cycle.value++
  },
)
watch([cycle, reduced], restartPlayback, { flush: 'post' })
watch(canPlay, syncPlayback, { flush: 'post' })
onMounted(restartPlayback)
onBeforeUnmount(stopPlayback)
</script>

<template>
  <div
    v-if="currentImage"
    ref="gallery"
    class="carousel"
    :class="{ 'carousel--reduced': reduced }"
    role="region"
    :aria-label="label('Announcement covers', '公告封面')"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @pointerdown="keyboardFocus = false"
    @focusin="focusIn"
    @focusout="focusOut"
    @keydown="handleKey"
  >
    <div class="carousel-stage">
      <Transition
        :name="direction === 'left' ? 'carousel-next' : 'carousel-previous'"
        @before-leave="hideLeavingFrame"
      >
        <button
          :key="`${currentImage.id}:${currentImage.imageUrl}`"
          class="carousel-frame"
          :class="{
            'carousel-frame--linked': hasActionLink(currentImage.actionUrl),
            'carousel-frame--portrait': portraits.has(currentImage.imageUrl),
          }"
          type="button"
          :aria-label="
            hasActionLink(currentImage.actionUrl)
              ? label('Open image link', '打开图片链接')
              : label('Enlarge image', '放大图片')
          "
          @click="openCurrent"
        >
          <img
            :src="currentImage.imageUrl"
            :data-image-url="currentImage.imageUrl"
            :alt="`${title} ${activeIndex + 1}`"
            draggable="false"
            @load="measureImage"
          />
        </button>
      </Transition>

      <template v-if="images.length > 1">
        <button
          class="carousel-arrow carousel-arrow--previous"
          type="button"
          :aria-label="label('Previous image', '上一张图片')"
          @click="previous"
        >
          <DesignIcon name="chevronRight" :size="16" class="carousel-chevron--previous" />
        </button>
        <button
          class="carousel-arrow carousel-arrow--next"
          type="button"
          :aria-label="label('Next image', '下一张图片')"
          @click="next"
        >
          <DesignIcon name="chevronRight" :size="16" />
        </button>
      </template>
    </div>
    <div
      v-if="images.length > 1"
      class="carousel-pagination"
      role="group"
      :aria-label="label('Cover images', '封面图片')"
    >
      <button
        v-for="(image, index) in images"
        :key="image.id"
        type="button"
        class="carousel-segment"
        :class="{ 'carousel-segment--complete': index < activeIndex }"
        :aria-current="index === activeIndex ? 'true' : undefined"
        :aria-label="
          label(
            `Image ${index + 1} of ${images.length}`,
            `第 ${index + 1} 张，共 ${images.length} 张`,
          )
        "
        @click="select(index, index > activeIndex ? 'left' : 'right')"
      >
        <span class="carousel-segment-track" aria-hidden="true">
          <span class="carousel-segment-fill"></span>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.carousel {
  width: 100%;
  min-width: 0;
}
.carousel-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: var(--surface-container);
  border-radius: 8px;
}
.carousel-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 0;
  overflow: hidden;
  color: var(--text);
  background: transparent;
  border: 0;
  opacity: 1;
  cursor: zoom-in;
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
.carousel-frame--portrait img {
  width: 65%;
  height: auto;
}
.carousel-arrow {
  position: absolute;
  z-index: 2;
  top: 50%;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-muted);
  background: var(--surface-low);
  border: 0;
  border-radius: 50%;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--text) 10%, transparent);
  line-height: 1;
  cursor: pointer;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 140ms ease;
}
.carousel-stage:hover .carousel-arrow,
.carousel-stage:focus-within .carousel-arrow {
  opacity: 1;
}
.carousel-chevron--previous {
  transform: rotate(180deg);
}
.carousel-arrow--previous {
  left: 10px;
}
.carousel-arrow--next {
  right: 10px;
}
.carousel-pagination {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 3px;
}
.carousel-segment {
  display: flex;
  flex: 1 1 0;
  align-items: center;
  min-width: 0;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.carousel-segment-track {
  display: block;
  width: 100%;
  height: 5px;
  overflow: hidden;
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-container));
  transition: height 140ms ease;
}
.carousel-segment-fill {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: left center;
}
.carousel-segment--complete .carousel-segment-fill {
  opacity: 0.55;
  transform: scaleX(1);
}
.carousel--reduced .carousel-segment[aria-current='true'] .carousel-segment-fill {
  transform: scaleX(1);
}
.carousel-segment:hover .carousel-segment-track,
.carousel-segment:focus-visible .carousel-segment-track {
  height: 7px;
}
.carousel-next-enter-active,
.carousel-next-leave-active,
.carousel-previous-enter-active,
.carousel-previous-leave-active {
  transition:
    transform 0.32s cubic-bezier(0.2, 0.7, 0.2, 1),
    opacity 0.32s ease;
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
@media (hover: none), (pointer: coarse) {
  .carousel-arrow {
    width: 44px;
    height: 44px;
    opacity: 1;
  }
  .carousel-segment {
    height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .carousel-arrow,
  .carousel-segment-track,
  .carousel-next-enter-active,
  .carousel-next-leave-active,
  .carousel-previous-enter-active,
  .carousel-previous-leave-active {
    transition: none;
  }
}
</style>
