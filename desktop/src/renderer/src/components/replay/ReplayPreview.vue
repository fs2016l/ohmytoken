<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { replayFormat, replayTitle, type ReplayOptions, type ReplaySnapshot } from '@shared/replay'
import { createReplayTimeline } from '../../replay/replay-data'
import { paintReplay } from '../../replay/replay-painter'
import { motion, numberProgress } from '../../config/motion'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { useI18n } from '../../i18n/useI18n'
import ReplayIcon from './ReplayIcon.vue'
const props = defineProps<{ snapshot: ReplaySnapshot }>()
const emit = defineEmits<{ position: [value: number] }>()
const { label } = useI18n()
const canvas = ref<HTMLCanvasElement>()
const container = ref<HTMLElement>()
const { visible, reduced } = useMotionVisibility(container)
const playing = ref(false),
  seconds = ref(0)
const timeline = computed(() => createReplayTimeline(props.snapshot))
const still = computed(() => replayFormat(props.snapshot.options).kind === 'image')
const showPlayer = computed(() => !still.value || props.snapshot.options.still === 'frame')
let resize: ResizeObserver | undefined
let frame = 0,
  transitionFrame = 0,
  last = 0,
  active = true
function cancelTransition(): void {
  cancelAnimationFrame(transitionFrame)
  transitionFrame = 0
}
function draw(): void {
  cancelTransition()
  const ctx = canvas.value?.getContext('2d')
  if (ctx) paintReplay(ctx, timeline.value, seconds.value)
}
function transitionTemplate(): void {
  const target = canvas.value
  const ctx = target?.getContext('2d')
  if (!target || !ctx || !visible.value || reduced.value) {
    draw()
    return
  }
  // Capture the displayed blend so rapid clicks continue from the visible frame.
  cancelTransition()
  const before = document.createElement('canvas'),
    after = document.createElement('canvas')
  before.width = after.width = target.width
  before.height = after.height = target.height
  const beforeContext = before.getContext('2d'),
    afterContext = after.getContext('2d')
  if (!beforeContext || !afterContext) {
    draw()
    return
  }
  beforeContext.drawImage(target, 0, 0)
  paintReplay(afterContext, timeline.value, seconds.value)
  const started = performance.now()
  const blend = (now: number): void => {
    const progress = Math.min(1, (now - started) / motion.detail)
    const alpha = numberProgress(progress)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, target.width, target.height)
    ctx.globalAlpha = 1 - alpha
    ctx.drawImage(before, 0, 0)
    // Add premultiplied colors to preserve opacity, including transparent PNG previews.
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = alpha
    ctx.drawImage(after, 0, 0)
    ctx.restore()
    if (progress < 1) transitionFrame = requestAnimationFrame(blend)
    else transitionFrame = 0
  }
  transitionFrame = requestAnimationFrame(blend)
}
function stop(): void {
  playing.value = false
  cancelAnimationFrame(frame)
}
function tick(now: number): void {
  if (!playing.value || !active || document.hidden) {
    stop()
    return
  }
  seconds.value = Math.min(
    props.snapshot.options.duration,
    seconds.value + Math.min(0.1, (now - last) / 1000),
  )
  last = now
  draw()
  if (seconds.value >= props.snapshot.options.duration) stop()
  else frame = requestAnimationFrame(tick)
}
function play(): void {
  if (playing.value) {
    stop()
    return
  }
  draw()
  if (seconds.value >= props.snapshot.options.duration) seconds.value = 0
  playing.value = true
  last = performance.now()
  frame = requestAnimationFrame(tick)
}
function seek(event: Event): void {
  stop()
  seconds.value = Number((event.target as HTMLInputElement).value)
  if (still.value) emit('position', seconds.value / props.snapshot.options.duration)
  draw()
}
function visibility(): void {
  if (document.hidden) {
    stop()
    draw()
  }
}
function fullscreen(): void {
  void container.value?.requestFullscreen?.().catch(() => {})
}
const format = (value: number): string =>
  `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`
watch(
  () => props.snapshot,
  (snapshot, previous) => {
    const changedOptions = previous
      ? (
          Object.keys({ ...previous.options, ...snapshot.options }) as (keyof ReplayOptions)[]
        ).filter((key) => snapshot.options[key] !== previous.options[key])
      : []
    if (changedOptions.length === 1 && changedOptions[0] === 'title') {
      draw()
      return
    }
    stop()
    if (changedOptions.length === 1 && changedOptions[0] === 'template') {
      transitionTemplate()
      return
    }
    seconds.value =
      props.snapshot.options.duration * (still.value ? (props.snapshot.options.position ?? 1) : 0.6)
    draw()
  },
  { flush: 'post' },
)
watch([visible, reduced], () => {
  if (!visible.value || reduced.value) draw()
})
onMounted(() => {
  seconds.value =
    props.snapshot.options.duration * (still.value ? (props.snapshot.options.position ?? 1) : 0.6)
  draw()
  resize = new ResizeObserver(draw)
  if (container.value) resize.observe(container.value)
  document.addEventListener('visibilitychange', visibility)
})
onActivated(() => {
  active = true
  draw()
})
onDeactivated(() => {
  active = false
  stop()
  cancelTransition()
})
onBeforeUnmount(() => {
  stop()
  cancelTransition()
  resize?.disconnect()
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <section class="replay-preview" :aria-label="label('Export preview', '导出预览')">
    <div
      ref="container"
      class="replay-stage"
      :class="{ 'replay-stage--transparent': snapshot.options.transparent && still }"
    >
      <canvas
        ref="canvas"
        :width="
          snapshot.options.aspect === 'portrait'
            ? 720
            : snapshot.options.aspect === 'square'
              ? 900
              : 1280
        "
        :height="
          snapshot.options.aspect === 'portrait'
            ? 1280
            : snapshot.options.aspect === 'square'
              ? 900
              : 720
        "
        :aria-label="replayTitle(snapshot.options)"
      />
      <span class="replay-preview-badge">{{ label('Preview', '预览') }}</span>
    </div>
    <div v-if="showPlayer" class="replay-player">
      <button
        v-if="!still"
        class="replay-play-button"
        :aria-label="playing ? label('Pause', '暂停') : label('Play', '播放')"
        @click="play"
      >
        <ReplayIcon :name="playing ? 'pause' : 'play'" :size="18" />
      </button>
      <span v-else>{{ label('Selected frame', '选定时刻') }}</span>
      <span class="numeric">{{ format(seconds) }} / {{ format(snapshot.options.duration) }}</span>
      <input
        :value="seconds"
        type="range"
        min="0"
        :max="snapshot.options.duration"
        step="0.01"
        :aria-label="label('Playback position', '播放进度')"
        @input="seek"
      />
      <button
        class="replay-icon-button"
        :aria-label="label('Fullscreen', '全屏预览')"
        @click="fullscreen"
      >
        <ReplayIcon name="expand" />
      </button>
    </div>
    <div v-else class="replay-still-caption">
      <span>
        {{
          label(
            'Whole-period snapshot · rendered at your selected resolution',
            '完整区间卡片 · 按所选尺寸重新渲染导出',
          )
        }}
      </span>
      <button
        class="replay-icon-button"
        :aria-label="label('Fullscreen', '全屏预览')"
        @click="fullscreen"
      >
        <ReplayIcon name="expand" />
      </button>
    </div>
  </section>
</template>
