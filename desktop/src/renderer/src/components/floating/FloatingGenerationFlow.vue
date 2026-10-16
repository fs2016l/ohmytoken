<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMotionVisibility } from '../../composables/useMotionVisibility'

const props = withDefaults(
  defineProps<{ tokenDelta?: number; tokensPerSecond?: number; enabled?: boolean }>(),
  { tokenDelta: undefined, tokensPerSecond: undefined, enabled: true },
)
const root = ref<HTMLElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const colorProbe = ref<HTMLElement | null>(null)
const { visible, reduced } = useMotionVisibility(root)
const active = computed(
  () => (props.tokenDelta ?? 0) > 0 && props.enabled && visible.value && !reduced.value,
)
const targetRate = computed(() => {
  const rate = props.tokensPerSecond
  // Missing timing still shows the positive delta; the displayed metric remains unknown.
  if (rate === undefined || !Number.isFinite(rate) || rate <= 0) return 10
  return rate
})
// Amplify motion across the common 10–150 t/s range without a speed threshold.
const pixelsPerToken = 2.4
let context: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | undefined
let themeObserver: MutationObserver | undefined
let frameId = 0
let previousTime = 0
let distance = 0
let displayedRate = targetRate.value
let width = 0
let height = 0
let pixelRatio = 0
let sparkColor = 'transparent'

function publishMotion(): void {
  if (!root.value) return
  root.value.dataset.travel = distance.toFixed(4)
  root.value.dataset.displayRate = displayedRate.toFixed(4)
  root.value.dataset.targetRate = String(targetRate.value)
}
function seed(index: number): number {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}
function paint(): void {
  if (!context || width <= 0 || height <= 0) return
  context.clearRect(0, 0, width, height)
  context.fillStyle = sparkColor
  context.strokeStyle = sparkColor
  context.lineCap = 'round'
  const spacing = 18
  const trailLength = active.value ? Math.min(8, displayedRate * pixelsPerToken * 0.012) : 0
  const first = Math.floor(-distance / spacing) - 1
  const last = Math.ceil((width - distance) / spacing) + 1
  for (let index = first; index <= last; index++) {
    const x = index * spacing + distance
    const y = height * (0.24 + seed(index) * 0.52)
    const radius = 0.65 + seed(index + 2) * 0.6
    const opacity = 0.55 + seed(index + 4) * 0.45
    if (trailLength > 0) {
      context.globalAlpha = opacity * 0.25
      context.lineWidth = 0.6
      context.beginPath()
      context.moveTo(x - trailLength, y)
      context.lineTo(x, y)
      context.stroke()
    }
    context.globalAlpha = opacity
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1
}
function resize(): void {
  if (!root.value || !canvas.value || !context) return
  const box = root.value.getBoundingClientRect()
  width = box.width
  height = box.height
  pixelRatio = Math.min(2, window.devicePixelRatio || 1)
  canvas.value.width = Math.max(1, Math.round(width * pixelRatio))
  canvas.value.height = Math.max(1, Math.round(height * pixelRatio))
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
  paint()
}
function updateColor(): void {
  if (colorProbe.value) sparkColor = getComputedStyle(colorProbe.value).color
  paint()
}
function stop(): void {
  cancelAnimationFrame(frameId)
  frameId = 0
  previousTime = 0
}
function frame(now: number): void {
  frameId = 0
  if (!active.value || !context) return
  if (pixelRatio !== Math.min(2, window.devicePixelRatio || 1)) resize()
  const dt = previousTime ? Math.min(0.05, Math.max(0, (now - previousTime) / 1000)) : 0
  previousTime = now
  // Keep position continuous and ease rate changes; travel remains proportional above 150 t/s.
  displayedRate += (targetRate.value - displayedRate) * (1 - Math.exp(-dt / 0.18))
  distance += displayedRate * pixelsPerToken * dt
  publishMotion()
  paint()
  frameId = requestAnimationFrame(frame)
}
function start(): void {
  if (context && !frameId) frameId = requestAnimationFrame(frame)
}
watch(active, (moving) => {
  if (moving) start()
  else {
    stop()
    paint()
  }
})
onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  resize()
  updateColor()
  publishMotion()
  resizeObserver = new ResizeObserver(resize)
  if (root.value) resizeObserver.observe(root.value)
  themeObserver = new MutationObserver(updateColor)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-accent', 'style'],
  })
  window.addEventListener('resize', resize)
  if (active.value) start()
})
onUnmounted(() => {
  stop()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <div
    ref="root"
    class="generation-flow"
    :class="{ 'generation-flow--active': active }"
    aria-hidden="true"
  >
    <canvas ref="canvas" class="generation-flow-particles" />
    <span ref="colorProbe" class="generation-flow-color" />
  </div>
</template>

<style scoped>
.generation-flow {
  --generation-flow-spark: light-dark(var(--surface-low), var(--text));
  position: relative;
  min-width: 0;
  height: 10px;
  border-radius: 999px;
  overflow: hidden;
  background: linear-gradient(
    90deg,
    var(--primary-hover),
    color-mix(in srgb, var(--primary) 65%, var(--generation-flow-spark))
  );
}
.generation-flow-particles {
  display: block;
  width: 100%;
  height: 100%;
}
.generation-flow-color {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  color: var(--generation-flow-spark);
  pointer-events: none;
}
</style>
