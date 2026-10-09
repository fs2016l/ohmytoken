<script setup lang="ts">
import { computed } from 'vue'
import type { UsageTrendStats } from '@shared/models'
import AnimatedNumber from '../base/AnimatedNumber.vue'
import UpdatedAt from '../base/UpdatedAt.vue'
import { useI18n } from '../../i18n/useI18n'
import { compactTokenLine } from '../../utils/floating-summary'

const props = defineProps<{
  stats: UsageTrendStats
  rangeTitle: string
  ready: boolean
  updatedAt: number
  failed: boolean
}>()
const emit = defineEmits<{ expand: [] }>()
const { label } = useI18n()
const line = computed(() => compactTokenLine(props.stats))
</script>

<template>
  <div class="floating-summary floating-token-summary">
    <div class="floating-summary-heading">
      <strong>{{ rangeTitle }}</strong>
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
      <svg v-if="ready" viewBox="0 0 160 50" preserveAspectRatio="none" aria-hidden="true">
        <path :d="`${line} L160,50 L0,50 Z`" fill="currentColor" opacity="0.1" />
        <path
          :d="line"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </button>
    <div class="floating-summary-breakdown">
      <div>
        <span>{{ label('Input', '输入') }}</span>
        <AnimatedNumber
          :value="ready ? stats.inputTokens : null"
          :format="{ compact: true }"
          :replay="false"
        />
      </div>
      <div>
        <span>{{ label('Output', '输出') }}</span>
        <AnimatedNumber
          :value="ready ? stats.outputTokens : null"
          :format="{ compact: true }"
          :replay="false"
        />
      </div>
      <div>
        <span>{{ label('Cache', '缓存') }}</span>
        <AnimatedNumber
          :value="ready ? stats.cacheReadTokens + stats.cacheWriteTokens : null"
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
        <UpdatedAt v-if="updatedAt" :timestamp="updatedAt" />
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
