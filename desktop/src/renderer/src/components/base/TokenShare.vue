<script setup lang="ts">
import { computed } from 'vue'
import { tokenShares, type TokenShareBucket, type TokenShareUsage } from '../../utils/format'
const props = withDefaults(
  defineProps<{
    /** 同一组用量一起分配占比，保证输入 / 输出 / 缓存 / 推理合计能对上 */
    usage: TokenShareUsage | null | undefined
    bucket: TokenShareBucket
    /** 不加括号，用于独占一行的占比 */
    plain?: boolean
  }>(),
  { plain: false },
)
const text = computed(() => tokenShares(props.usage)[props.bucket])
</script>
<template>
  <small v-if="text" class="token-share" :class="{ 'token-share--plain': plain }">
    {{ plain ? text : `(${text})` }}
  </small>
</template>
<style scoped>
.token-share {
  margin-inline-start: 3px;
  color: var(--text-muted);
  font-family: var(--font-number);
  font-variant-numeric: tabular-nums;
  font-size: 0.85em;
  font-weight: 400;
  white-space: nowrap;
}
.token-share--plain {
  margin-inline-start: 0;
}
</style>
