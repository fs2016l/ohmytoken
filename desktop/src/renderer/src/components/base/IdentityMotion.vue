<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useMotionVisibility } from '../../composables/useMotionVisibility'
import { motion } from '../../config/motion'
const props = defineProps<{ identity: string }>()
const element = ref<HTMLElement | null>(null)
const { visible, reduced, activation } = useMotionVisibility(element)
let animation: Animation | undefined
let shownIdentity = '',
  shownActivation = -1
watch(
  [() => props.identity, visible, reduced, activation],
  () => {
    animation?.cancel()
    if (!visible.value || reduced.value || !element.value) return
    if (shownIdentity === props.identity && shownActivation === activation.value) return
    shownIdentity = props.identity
    shownActivation = activation.value
    animation = element.value.animate(
      [
        { opacity: 0, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: motion.identity, easing: motion.entranceEase },
    )
  },
  { flush: 'post' },
)
onUnmounted(() => animation?.cancel())
</script>
<template>
  <div ref="element" class="identity-motion"><slot /></div>
</template>
