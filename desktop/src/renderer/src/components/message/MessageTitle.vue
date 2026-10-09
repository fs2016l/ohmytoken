<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useMotionVisibility } from '../../composables/useMotionVisibility'

const props = defineProps<{ text: string; messageUid: string; paused: boolean }>()
const emit = defineEmits<{
  durationChange: [messageUid: string, milliseconds: number]
}>()
const viewport = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const copy = ref<HTMLElement | null>(null)
const scrolling = ref(false)
const { visible, reduced } = useMotionVisibility(viewport)
const GAP = 32
const SPEED = 32
const HOLD_MS = 1200
let observer: ResizeObserver | undefined
let animation: Animation | undefined
let measured = ''

function syncPlayback(): void {
  if (!animation) return
  if (visible.value && !props.paused) animation.play()
  else animation.pause()
}

function measure(): void {
  if (!viewport.value || !copy.value || !track.value) return
  const width = viewport.value.clientWidth
  const textWidth = copy.value.getBoundingClientRect().width
  const signature = `${props.messageUid}:${props.text}:${width}:${textWidth}:${reduced.value}`
  if (signature === measured) return
  measured = signature
  animation?.cancel()
  animation = undefined
  scrolling.value = width > 0 && textWidth > width + 1 && !reduced.value
  if (!scrolling.value) {
    emit('durationChange', props.messageUid, 0)
    return
  }
  const distance = textWidth + GAP
  const duration = HOLD_MS + (distance / SPEED) * 1000
  animation = track.value.animate(
    [
      { transform: 'translateX(0)', offset: 0 },
      { transform: 'translateX(0)', offset: HOLD_MS / duration },
      { transform: `translateX(-${distance}px)`, offset: 1 },
    ],
    { duration, iterations: Infinity, easing: 'linear' },
  )
  syncPlayback()
  emit('durationChange', props.messageUid, Math.ceil(duration))
}

watch([() => props.text, () => props.messageUid, reduced], measure, { flush: 'post' })
watch([visible, () => props.paused], syncPlayback, { flush: 'post' })
onMounted(() => {
  observer = new ResizeObserver(measure)
  if (viewport.value) observer.observe(viewport.value)
  if (copy.value) observer.observe(copy.value)
  measure()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  animation?.cancel()
})
</script>

<template>
  <strong ref="viewport" class="message-title">
    <span v-if="!scrolling" class="message-title-static">{{ text }}</span>
    <span
      ref="track"
      class="message-title-track"
      :class="{ 'message-title-track--measuring': !scrolling }"
      :aria-hidden="!scrolling"
    >
      <span ref="copy" class="message-title-copy">{{ text }}</span>
      <span v-if="scrolling" class="message-title-copy" aria-hidden="true">{{ text }}</span>
    </span>
  </strong>
</template>

<style scoped>
.message-title {
  position: relative;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.message-title-static {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}
.message-title-track {
  display: flex;
  width: max-content;
  gap: 32px;
}
.message-title-track--measuring {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
}
.message-title-copy {
  flex: none;
}
</style>
