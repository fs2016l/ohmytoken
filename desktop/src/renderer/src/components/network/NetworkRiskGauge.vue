<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import { useAnimatedValue } from '../../composables/useAnimatedValue'
import { useNetworkLabels } from '../../composables/useNetworkLabels'
const props = defineProps<{ value?: number | null; source: string }>()
const element = ref<HTMLElement | null>(null)
const display = useAnimatedValue(toRef(props, 'value'), element)
const { label, riskText } = useNetworkLabels()
const color = computed(() =>
  props.value == null
    ? 'var(--text-soft)'
    : props.value <= 25
      ? 'var(--success)'
      : props.value <= 50
        ? 'var(--warning)'
        : 'var(--error)',
)
</script>
<template>
  <div
    ref="element"
    class="network-risk-gauge"
    :style="{
      '--risk-color': color,
      '--risk-angle': `${Math.max(0, Math.min(100, display)) * 1.8}deg`,
    }"
    :aria-label="label(`${source} risk score`, `${source} 风险评分`)"
  >
    <div class="network-risk-arc" aria-hidden="true"><i /></div>
    <div class="network-risk-value">
      <AnimatedNumber :value="value" :format="{ decimals: 1, compact: false }" />
      <span>/ 100</span>
    </div>
    <p>
      {{ source }}
      <span>· {{ riskText(value) }}</span>
    </p>
  </div>
</template>
<style scoped>
.network-risk-gauge {
  position: relative;
  width: 100%;
  padding-top: 48px;
  text-align: center;
  min-height: 132px;
}
.network-risk-arc {
  position: absolute;
  width: 200px;
  height: 100px;
  left: calc(50% - 100px);
  top: 0;
  overflow: hidden;
}
.network-risk-arc i {
  display: block;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: conic-gradient(
    from 270deg,
    var(--risk-color) var(--risk-angle),
    var(--surface-container-high) var(--risk-angle) 180deg,
    transparent 180deg
  );
  mask: radial-gradient(circle, transparent 60%, black 61%);
}
.network-risk-value {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 4px;
  font-size: 40px;
  font-weight: 600;
  line-height: 48px;
  position: relative;
}
.network-risk-value > span:last-child {
  font-size: 12px;
  color: var(--text-soft);
  font-weight: 400;
}
p {
  margin: 12px 0 0;
  font-size: 12px;
  line-height: 20px;
}
p span {
  color: var(--risk-color);
}
</style>
