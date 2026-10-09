<script setup lang="ts">
import { computed } from 'vue'
import type { ScanPreview, ScanProgress, ScanWorkProgress } from '@shared/scan-progress'
import { useI18n } from '../../i18n/useI18n'
import { getAgentName } from '../../config/agents'

const props = defineProps<{ progress: ScanProgress | null; preview: ScanPreview | null }>()
const { label } = useI18n()
const activeAgents = computed(() => props.progress?.activeAgents ?? [])
const phase = computed(() => {
  switch (props.progress?.phase) {
    case 'reading':
      return label('Reading usage', '读取用量')
    case 'writing':
      return label('Summarizing sessions', '汇总会话')
    case 'costs':
      return label('Calculating estimates', '计算参考费用')
    case 'committing':
      return label('Verifying and saving', '核验并保存')
    default:
      return label('Finding local sources', '查找本地数据')
  }
})
function unitLabel(work?: ScanWorkProgress): string {
  switch (work?.unit) {
    case 'files':
      return label('files', '个文件')
    case 'bytes':
      return label('bytes', '字节')
    case 'rows':
      return label('rows', '条记录')
    case 'calls':
      return label('API records', '条 API 记录')
    case 'sessions':
      return label('sessions', '个会话')
    case 'days':
      return label('days', '天')
    default:
      return ''
  }
}
const unit = computed(() => unitLabel(props.progress?.work))
function workFraction(work?: ScanWorkProgress): number | undefined {
  return work?.total && work.total > 0 ? Math.min(1, work.completed / work.total) : undefined
}
const fraction = computed(() => {
  if (activeAgents.value.length && props.progress?.totalAgents)
    return props.progress.completedAgents / props.progress.totalAgents
  return workFraction(props.progress?.work)
})
</script>

<template>
  <section
    v-if="progress?.status === 'running' || preview"
    class="scan-progress panel"
    aria-live="polite"
  >
    <div class="scan-line">
      <strong>
        {{ phase }}
        <template v-if="progress?.agent">· {{ getAgentName(progress.agent) }}</template>
      </strong>
      <span v-if="progress?.work">
        {{ progress.work.completed.toLocaleString() }}
        <template v-if="progress.work.total !== undefined">
          / {{ progress.work.total.toLocaleString() }}
        </template>
        {{ unit }}
      </span>
      <span v-else-if="progress?.totalAgents">
        {{ label('Completed', '已完成') }} {{ progress.completedAgents }} /
        {{ progress.totalAgents }}
        Agent
      </span>
    </div>
    <progress :value="fraction" :max="1" :aria-label="phase" />
    <div v-if="activeAgents.length" class="agent-tasks">
      <div v-for="task in activeAgents" :key="task.agent" class="agent-task">
        <div class="scan-line">
          <strong>{{ getAgentName(task.agent) }}</strong>
          <span>
            {{
              task.phase === 'reading'
                ? label('Reading usage', '读取用量')
                : label('Summarizing sessions', '汇总会话')
            }}
          </span>
        </div>
        <progress
          :value="workFraction(task.work)"
          :max="1"
          :aria-label="getAgentName(task.agent)"
        />
        <p v-if="task.work">
          {{ task.work.completed.toLocaleString() }}
          <template v-if="task.work.total !== undefined">
            / {{ task.work.total.toLocaleString() }}
          </template>
          {{ unitLabel(task.work) }}
        </p>
      </div>
    </div>
    <p v-if="preview?.complete">
      {{
        label(
          'Overview is ready. Session usage and costs will appear when processing finishes.',
          '概览已就绪，会话用量和费用将在整理完成后自动显示。',
        )
      }}
    </p>
    <p v-else-if="preview">
      {{
        label(
          'Showing usage read so far; totals will grow as more sources are scanned.',
          '当前显示已读取的用量，尚未扫描完毕，总量会继续更新。',
        )
      }}
    </p>
    <p v-else>
      {{
        label(
          'Your saved statistics remain available while scanning.',
          '扫描期间继续显示已保存的统计。',
        )
      }}
    </p>
    <p v-if="preview?.retainedAgents.length" class="retained">
      {{ label('Sources unavailable; keeping saved history:', '以下来源暂不可用，保留已有历史：') }}
      {{ preview.retainedAgents.map(getAgentName).join('、') }}
    </p>
  </section>
  <p
    v-else-if="progress?.status === 'failed' && progress.rebuilding"
    class="scan-progress panel"
    role="status"
  >
    {{
      label(
        'Rebuild did not complete. Previously saved statistics have been preserved.',
        '本轮重建未完成，已保留原有统计。',
      )
    }}
  </p>
</template>

<style scoped>
.scan-progress {
  margin: 0 0 20px;
  padding: 18px 22px;
}
.scan-line {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.scan-line span,
p {
  color: var(--text-secondary);
  font-size: 13px;
}
p {
  margin: 8px 0 0;
}
progress {
  display: block;
  width: 100%;
  height: 8px;
  margin-top: 12px;
  accent-color: var(--accent, #7863ff);
}
.retained {
  font-size: 12px;
}
.agent-tasks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 12px;
  margin-top: 14px;
}
.agent-task {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.agent-task strong {
  font-size: 13px;
}
</style>
