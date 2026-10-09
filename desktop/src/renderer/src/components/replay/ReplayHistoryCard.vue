<script setup lang="ts">
import { computed } from 'vue'
import { replayDimensions, replayFormat, type ReplayRecord } from '@shared/replay'
import { useI18n } from '../../i18n/useI18n'
import { replayRecordTitle } from '../../replay/replay-labels'
import ReplayIcon from './ReplayIcon.vue'
const props = defineProps<{ record: ReplayRecord; compact?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ open: []; save: [] }>()
const { label, currentLang } = useI18n()
const format = computed(() => replayFormat(props.record.options))
const dimensions = computed(() => replayDimensions(props.record.options))
const title = computed(() => replayRecordTitle(props.record.options, label))
const time = computed(() =>
  new Intl.DateTimeFormat(currentLang.value === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(props.record.createdAt),
)
const state = computed(() =>
  props.record.status === 'complete'
    ? ''
    : props.record.status === 'generating'
      ? label('Generating', '生成中')
      : props.record.status === 'cancelled'
        ? label('Cancelled', '已取消')
        : props.record.failure === 'interrupted'
          ? label('Interrupted', '已中断')
          : label('Failed', '生成失败'),
)
const measure = computed(
  () =>
    ({
      tokens: 'Token',
      cost: label('Cost', '费用'),
      turns: label('Turns', '对话次数'),
      calls: label('API calls', 'API 次数'),
    })[props.record.options.measure ?? 'tokens'],
)
</script>
<template>
  <article :data-replay-id="record.id" class="replay-history-card" :class="{ compact }">
    <button
      class="replay-history-cover"
      :disabled="disabled"
      :aria-label="`${label('Preview', '预览')} ${title} ${record.options.from}`"
      @click="emit('open')"
    >
      <img v-if="record.thumbnail" :src="record.thumbnail" alt="" loading="lazy" />
      <span v-else class="material-symbols-outlined" aria-hidden="true">
        {{ record.status === 'generating' ? 'hourglass_empty' : 'movie' }}
      </span>
      <span class="replay-media-badge">
        {{ format.label }}{{ format.kind !== 'image' ? ` · ${record.options.duration}s` : '' }}
      </span>
      <span v-if="state" class="replay-record-status" :class="record.status">{{ state }}</span>
    </button>
    <div class="replay-history-body">
      <button
        class="replay-history-title"
        :title="title"
        :disabled="disabled"
        @click="emit('open')"
      >
        {{ title }}
        <span>· {{ measure }}</span>
      </button>
      <p class="replay-history-period">
        {{ record.options.from.slice(5).replace('-', '/') }} —
        {{ record.options.to.slice(5).replace('-', '/') }} ·
        {{
          record.options.dimension === 'agents'
            ? 'Agent'
            : record.options.dimension === 'projects'
              ? label('Project', '项目')
              : label('Model', '模型')
        }}
      </p>
      <p class="replay-history-meta numeric">
        {{ dimensions.width }} × {{ dimensions.height }}
        <span v-if="record.bytes">
          ·
          {{
            record.bytes < 1048576
              ? `${Math.round(record.bytes / 1024)} KB`
              : `${(record.bytes / 1048576).toFixed(1)} MB`
          }}
        </span>
      </p>
      <footer>
        <time>{{ time }}</time>
        <div>
          <button
            v-if="record.status === 'complete'"
            class="replay-icon-button"
            :disabled="disabled"
            :title="label('Save as', '另存为')"
            :aria-label="label('Save as', '另存为')"
            @click="emit('save')"
          >
            <ReplayIcon name="download" :size="16" />
          </button>
          <button
            class="replay-icon-button"
            :disabled="disabled"
            :title="label('Details and actions', '详情与操作')"
            :aria-label="label('Details and actions', '详情与操作')"
            @click="emit('open')"
          >
            <span class="material-symbols-outlined" aria-hidden="true">more_horiz</span>
          </button>
        </div>
      </footer>
    </div>
  </article>
</template>
