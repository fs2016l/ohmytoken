<script setup lang="ts">
import { computed } from 'vue'
import type { LatestGeneration, LatestTurnFirstToken } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'

const props = defineProps<{
  sample?: LatestGeneration
  turnFirstToken?: LatestTurnFirstToken
  agent?: string
  stacked?: boolean
  floating?: boolean
  detail?: boolean
}>()
const { label } = useI18n()
const estimated = computed(() => props.sample?.speedKind === 'response-estimate')
const speed = computed(() =>
  props.sample?.tokensPerSecond !== undefined
    ? `${Math.round(props.sample.tokensPerSecond)} t/s`
    : '—',
)
const latency = computed(() => {
  const ms = props.turnFirstToken?.timeToFirstTokenMs ?? props.sample?.timeToFirstTokenMs
  if (ms === undefined) return '—'
  return ms > 1000 ? `${(Math.round(ms / 100) / 10).toFixed(1)} s` : `${Math.round(ms)} ms`
})
const turnScope = computed(
  () =>
    !!props.turnFirstToken ||
    (props.agent === 'codex' && props.sample?.timeToFirstTokenMs === undefined),
)
function formatTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  })
}
const completedAt = computed(() => (props.sample ? formatTime(props.sample.completedAtMs) : ''))
const source = computed(() =>
  props.sample
    ? `${
        estimated.value
          ? label(
              'Latest observed API response · average estimate',
              '最近记录的 API 响应 · 均速估算',
            )
          : label('Latest completed call with timing', '最近有计时的已完成调用')
      } · ${props.sample.model}\n${
        props.sample.timeSource === 'recorded'
          ? label(
              'Response record time (may be later than generation completion or changed by import)',
              '响应记录时间（可能晚于生成完成或受导入影响）',
            )
          : label('Completed at', '生成完成时间')
      } · ${completedAt.value}\n${props.sample.apiCallId}`
    : label('The source has no reliable call timing', '来源尚无可靠的调用计时'),
)
const turnSource = computed(() =>
  props.turnFirstToken
    ? `${label('Latest completed turn · Codex native timing', '最近已完成轮 · Codex 原生计时')}\n${label(
        'Turn completion record',
        '轮完成记录时间',
      )} · ${formatTime(props.turnFirstToken.completedAtMs)}\n${label(
        'Session',
        '会话',
      )} · ${props.turnFirstToken.sessionId}\n${label('Turn', '轮次')} · ${props.turnFirstToken.turnId}`
    : label(
        'No completed turn with native first-token timing has been recorded',
        '尚未记录带原生首 Token 计时的已完成轮',
      ),
)
const summary = computed(() =>
  props.turnFirstToken ? `${source.value}\n${turnSource.value}` : source.value,
)
const speedTooltip = computed(() =>
  [
    props.sample?.tokensPerSecond === undefined
      ? label('The available call records lack streaming duration', '现有调用记录缺少流输出时长')
      : estimated.value
        ? label(
            'Generated output / observed response time, including first-output wait, client overhead and possibly tools',
            '生成输出÷可观察响应时间，包含首输出等待、客户端开销，部分记录可能包含工具耗时',
          ) + `\n${Math.round(props.sample!.responseDurationMs!)} ms`
        : props.agent === 'opencode'
          ? label(
              'Client-observed mean stream speed, including reasoning: from first non-empty output to response stream end; excludes first-token wait and later tools',
              '客户端平均流速（含推理）：从首个非空输出到响应流结束，不含首字等待和之后的工具耗时',
            )
          : label(
              'Generated output (including reasoning) / streaming duration, excluding first-token wait and tools',
              '生成输出（含推理）÷流输出时长，不含首 Token 等待和工具耗时',
            ),
    source.value,
    estimated.value
      ? label(
          'Updated from recorded API usage; this is an estimate of response average speed',
          '读取已保存的 API 用量后更新，显示响应区间的平均速度估算',
        )
      : label(
          'Updated after a completed API call is read from Agent logs or data; the conversation can continue',
          '扫描到 Agent 日志或数据库中已完成的 API 记录后即可更新，无需等整个对话结束',
        ),
  ].join('\n'),
)
const latencyTooltip = computed(() =>
  turnScope.value
    ? [
        label(
          'Codex native turn timing: from turn start to the first model output, including text, reasoning or a tool call',
          'Codex 原生轮级计时：从一轮开始到首次模型输出，可能是文本、推理或工具调用',
        ),
        turnSource.value,
        label(
          'Updated from the native turn completion record; keeps the previous completed turn while the next turn runs. Speed is sampled independently per API.',
          '扫描到原生轮完成记录后更新；新一轮运行时保留上一轮值。速度独立按 API 取样。',
        ),
      ].join('\n')
    : [
        props.sample?.timeToFirstTokenMs === undefined
          ? label(
              'The available call records lack first-output timing',
              '现有调用记录缺少首个输出时间',
            )
          : label(
              'Time from request start to the first text, reasoning or tool-call content',
              '从请求开始到首个文本、推理或工具调用内容的等待时间',
            ),
        source.value,
      ].join('\n'),
)
</script>
<template>
  <div
    class="generation-metrics"
    :class="{
      stacked,
      'generation-metrics--floating': floating,
      'generation-metrics--detail': detail,
    }"
    :title="summary"
  >
    <span class="generation-speed" :title="speedTooltip">
      <small>{{ estimated ? label('Avg. estimate', '估算均速') : label('Stream', '流速') }}</small>
      <b>{{ speed }}</b>
    </span>
    <span class="generation-ttft" :title="latencyTooltip">
      <small>
        {{ turnScope ? label('Turn first token', '首轮字') : label('First token', '首字') }}
      </small>
      <b>{{ latency }}</b>
    </span>
  </div>
</template>
<style scoped>
.generation-metrics {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12px;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}
.generation-metrics > span {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}
small {
  color: var(--text-muted);
  font-size: 11px;
}
b {
  color: var(--text);
  font-weight: 400;
}
.stacked {
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
}
.generation-metrics--floating {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  padding: 2px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary) 5%, var(--surface-low));
}
.generation-metrics--floating > span {
  min-width: 0;
}
.generation-metrics--floating > .generation-ttft {
  justify-content: flex-end;
  padding-inline-start: 8px;
  border-inline-start: 1px solid var(--border);
}
.generation-metrics--detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--primary-soft);
}
.generation-metrics--detail > span {
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}
.generation-metrics--detail > span + span {
  padding-left: 12px;
  border-left: 1px solid var(--border);
}
.generation-metrics--detail b {
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
}
</style>
