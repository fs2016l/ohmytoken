<script setup lang="ts">
import { computed } from 'vue'
import type { UsageTrendStats } from '@shared/models'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import TokenShare from '../base/TokenShare.vue'
import RelativeUpdatedAt from '../base/RelativeUpdatedAt.vue'
import { useI18n } from '../../i18n/useI18n'
import FloatingTokenSparkline from './FloatingTokenSparkline.vue'

const props = defineProps<{
  stats: UsageTrendStats
  rangeTitle: string
  ready: boolean
  updatedAt: number
  failed: boolean
}>()
const emit = defineEmits<{ expand: [] }>()
const { label } = useI18n()
const breakdown = computed(() => [
  { id: 'input' as const, name: label('Input', '输入'), value: props.stats.inputTokens },
  { id: 'output' as const, name: label('Output', '输出'), value: props.stats.outputTokens },
  {
    id: 'cache' as const,
    name: label('Cache', '缓存'),
    value: props.stats.cacheReadTokens + props.stats.cacheWriteTokens,
  },
  {
    id: 'reasoning' as const,
    name: label('Reasoning', '推理'),
    value: props.stats.reasoningTokens,
  },
])
</script>

<template>
  <div class="floating-summary floating-token-summary">
    <div class="floating-summary-heading">
      <strong>{{ rangeTitle }}</strong>
      <span class="floating-summary-updated" :class="{ 'is-stale': failed }">
        <RelativeUpdatedAt v-if="updatedAt" :timestamp="updatedAt" />
      </span>
    </div>
    <button
      class="floating-summary-total"
      :aria-label="label('Expand token details', '展开 Token 详情')"
      @click="emit('expand')"
    >
      <span>
        <AnimatedNumber
          :value="ready ? stats.totalTokens : null"
          :format="{ compact: true }"
          :replay="false"
        />
        <small>tokens</small>
      </span>
      <FloatingTokenSparkline v-if="ready" :stats="stats" />
    </button>
    <div class="floating-summary-breakdown">
      <div v-for="item in breakdown" :key="item.id">
        <span>
          {{ item.name }}
          <TokenShare :usage="ready ? stats : null" :bucket="item.id" />
        </span>
        <AnimatedNumber
          :value="ready ? item.value : null"
          :format="{ compact: true }"
          :replay="false"
        />
      </div>
    </div>
    <div class="floating-summary-footer">
      <span
        :class="{ 'is-stale': failed }"
        :title="
          failed
            ? label('Refresh failed. Showing saved usage.', '刷新失败，显示已保存的用量。')
            : undefined
        "
      >
        <RelativeUpdatedAt v-if="updatedAt" :timestamp="updatedAt" />
        <template v-else>
          {{
            ready
              ? label('Cached data · awaiting refresh', '缓存数据 · 待刷新')
              : label('Waiting for data', '等待数据')
          }}
        </template>
      </span>
      <button class="floating-link" @click="emit('expand')">
        {{ label('Details', '展开详情') }} ›
      </button>
    </div>
  </div>
</template>
