<script setup lang="ts">
import { computed } from 'vue'
import type { LatestGeneration, LatestTurnFirstToken } from '@shared/models'
import { useI18n } from '../../i18n/useI18n'
import DesignIcon from '../base/DesignIcon.vue'
import FloatingGenerationFlow from '../floating/FloatingGenerationFlow.vue'

const props = defineProps<{
  sample?: LatestGeneration
  turnFirstToken?: LatestTurnFirstToken
  agent?: string
  stacked?: boolean
  floating?: boolean
  detail?: boolean
  tokenDelta?: number
  motionAvailable?: boolean
}>()
const { label } = useI18n()
const estimated = computed(() => props.sample?.speedKind === 'response-estimate')
const streamEstimated = computed(() => props.sample?.speedKind === 'stream-estimate')
/** 首字可能来自另一次调用：更晚的仅首字调用，或本样本缺首字时更早一次有首字的调用。 */
const firstToken = computed(() => props.sample?.firstToken)
const firstTokenLater = computed(
  () =>
    !!firstToken.value &&
    !!props.sample &&
    firstToken.value.completedAtMs > props.sample.completedAtMs,
)
const ttftEstimated = computed(() => (firstToken.value ?? props.sample)?.ttftKind === 'estimate')
const flowRequested = computed(
  () => props.floating && (props.tokenDelta ?? 0) > 0 && props.motionAvailable !== false,
)
const speedLabel = computed(() =>
  estimated.value
    ? label('Avg. estimate', '估算均速')
    : streamEstimated.value
      ? label('Stream estimate', '估算流速')
      : label('Stream', '流速'),
)
const speed = computed(() =>
  props.sample?.tokensPerSecond !== undefined
    ? `${Math.round(props.sample.tokensPerSecond)} t/s`
    : '—',
)
/** 单次 API 的首字优先；Codex 只在最近调用缺少逐 API 推导值时回退到原生整轮计时。 */
const apiLatencyMs = computed(
  () => firstToken.value?.timeToFirstTokenMs ?? props.sample?.timeToFirstTokenMs,
)
const turnScope = computed(
  () => apiLatencyMs.value === undefined && (!!props.turnFirstToken || props.agent === 'codex'),
)
function formatLatency(ms: number): string {
  return ms > 1000 ? `${(Math.round(ms / 100) / 10).toFixed(1)} s` : `${Math.round(ms)} ms`
}
const latency = computed(() => {
  const ms = apiLatencyMs.value ?? props.turnFirstToken?.timeToFirstTokenMs
  return ms === undefined ? '—' : formatLatency(ms)
})
const latencyLabel = computed(() =>
  turnScope.value
    ? label('Turn first token', '首轮字')
    : ttftEstimated.value
      ? label('First token est.', '估算首字')
      : label('First token', '首字'),
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
function timeLabel(timeSource: 'recorded' | undefined): string {
  return timeSource === 'recorded'
    ? label(
        'Response record time (may be later than generation completion or changed by import)',
        '响应记录时间（可能晚于生成完成或受导入影响）',
      )
    : label('Completed at', '生成完成时间')
}
const source = computed(() =>
  props.sample
    ? `${
        estimated.value
          ? label(
              'Latest observed API response · average estimate',
              '最近记录的 API 响应 · 均速估算',
            )
          : streamEstimated.value
            ? label(
                'Latest observed API response · stream estimate',
                '最近记录的 API 响应 · 流速估算',
              )
            : props.sample.speedExcluded
              ? label('Latest call with first-token timing only', '最近仅有首字计时的调用')
              : label('Latest completed call with timing', '最近有计时的已完成调用')
      } · ${props.sample.model}\n${timeLabel(props.sample.timeSource)} · ${formatTime(
        props.sample.completedAtMs,
      )}\n${props.sample.apiCallId}`
    : label('The source has no reliable call timing', '来源尚无可靠的调用计时'),
)
const firstTokenSource = computed(() =>
  firstToken.value
    ? `${
        firstTokenLater.value
          ? label('Later call · first token only', '更晚的调用 · 仅首字')
          : label('Earlier call · first token', '较早的调用 · 首字')
      } · ${firstToken.value.model}\n${timeLabel(firstToken.value.timeSource)} · ${formatTime(
        firstToken.value.completedAtMs,
      )}\n${firstToken.value.apiCallId}`
    : '',
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
  [
    source.value,
    ...(firstToken.value ? [firstTokenSource.value] : []),
    ...(props.turnFirstToken ? [turnSource.value] : []),
  ].join('\n'),
)
const speedTooltip = computed(() =>
  [
    speedLabel.value,
    props.sample?.tokensPerSecond === undefined
      ? props.sample?.speedExcluded
        ? label(
            'Only text responses with a native stream window of at least 2 s provide stream speed: thinking finishes before the first visible output, tool-call arguments arrive in one burst, and shorter windows overstate speed. This session has no stream sample yet',
            '仅原生流窗口不短于 2 秒的纯文本响应提供流速：思考在首个可见输出前完成，工具调用参数整块下发，更短的窗口会高估速度。本会话尚无流速样本',
          )
        : label('The available call records lack streaming duration', '现有调用记录缺少流输出时长')
      : estimated.value
        ? label(
            'Generated output / observed response time, including first-output wait, client overhead and possibly tools',
            '生成输出÷可观察响应时间，包含首输出等待、客户端开销，部分记录可能包含工具耗时',
          ) + `\n${Math.round(props.sample!.responseDurationMs!)} ms`
        : streamEstimated.value
          ? label(
              'Generated output (including reasoning) / derived streaming time: from the first content block start (thinking record time minus its client-recorded duration) to the last content block record; excludes first-token wait',
              '生成输出（含推理）÷推导的流输出时间：从首个内容块开始（thinking 记录时间减去客户端记录的思考时长）到最后一个内容块记录，不含首字等待',
            ) + `\n${Math.round(props.sample!.responseDurationMs!)} ms`
          : props.agent === 'opencode'
            ? label(
                'Client-observed mean stream speed, including reasoning: from first non-empty output to response stream end; excludes first-token wait and later tools',
                '客户端平均流速（含推理）：从首个非空输出到响应流结束，不含首字等待和之后的工具耗时',
              )
            : props.agent === 'antigravity'
              ? label(
                  'Visible output / native streaming window from the first visible chunk to completion. Thinking finishes before that chunk and is excluded; only text responses with a window of at least 2 s are sampled',
                  '可见正文÷原生流窗口（首个可见片段至完成）。思考在该片段前完成，不计入；仅取窗口不短于 2 秒的纯文本响应',
                )
              : label(
                  'Generated output (including reasoning) / streaming duration, excluding first-token wait and tools',
                  '生成输出（含推理）÷流输出时长，不含首 Token 等待和工具耗时',
                ),
    source.value,
    ...(firstToken.value
      ? [
          firstTokenLater.value
            ? label(
                'The first token comes from a later call; speed stays on this sample',
                '首字来自更晚的调用，速度仍取本样本',
              )
            : label(
                'This call has no first-token timing; the first token comes from the latest earlier call that has one',
                '本次调用没有首字计时，首字取自更早一次有首字的调用',
              ),
        ]
      : []),
    estimated.value || streamEstimated.value
      ? label(
          'Updated from recorded API usage and record times; this is an estimate',
          '读取已保存的 API 用量与记录时间后更新，属于估算',
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
        latencyLabel.value,
        label(
          'Codex native turn timing: from turn start to the first non-empty text, reasoning summary or tool call, including turn setup, context compaction, attachment processing and reasoning before any summary appears',
          'Codex 原生轮级计时：从本轮开始到首个非空正文、推理摘要或工具调用，包含本轮初始化、上下文压缩、附件处理和推理摘要出现前的推理',
        ),
        label(
          'Shown when the latest API has no derivable first token, for example when it starts with a tool call',
          '最近一次 API 没有可推导的首字时显示，例如以工具调用开头',
        ),
        turnSource.value,
        label(
          'Updated from the native turn completion record; keeps the previous completed turn while the next turn runs. Speed is sampled independently per API.',
          '扫描到原生轮完成记录后更新；新一轮运行时保留上一轮值。速度独立按 API 取样。',
        ),
      ].join('\n')
    : [
        latencyLabel.value,
        latency.value === '—'
          ? label(
              'The available call records lack first-output timing',
              '现有调用记录缺少首个输出时间',
            )
          : ttftEstimated.value
            ? props.agent === 'codex'
              ? label(
                  'Estimated from Codex record times: from the user input, tool result or compaction that triggered this API to the native start of its first reasoning or text item, including client work such as request assembly and attachment processing',
                  '由 Codex 记录时间推导：从触发本次 API 的用户输入、工具结果或上下文压缩完成，到本次首个推理或正文的原生开始时间，包含请求组装、附件处理等客户端开销',
                )
              : label(
                  'Estimated from record times: from the preceding user input or tool result record to the first content block start, including client overhead such as hooks and context assembly',
                  '由记录时间推导：从上一条用户输入或工具结果记录到首个内容块开始，包含 hook、上下文组装等客户端开销',
                )
            : props.agent === 'antigravity'
              ? label(
                  'Antigravity native timing: from request start to the first visible chunk. Every request carries the full context, so long sessions wait longer on the server; thinking that is not streamed and tool-call arguments that arrive in one block are included',
                  'Antigravity 原生计时：从请求开始到首个可见片段。每次请求都携带完整上下文，长会话的服务端等待更久；未流式输出的思考和整块到达的工具调用参数也计入等待',
                )
              : label(
                  'Time from request start to the first text, reasoning or tool-call content',
                  '从请求开始到首个文本、推理或工具调用内容的等待时间',
                ),
        firstToken.value ? firstTokenSource.value : source.value,
        ...(props.turnFirstToken
          ? [
              `${label(
                'Codex native first output of the turn (from turn start)',
                'Codex 原生本轮首个输出（从本轮开始计）',
              )} · ${formatLatency(props.turnFirstToken.timeToFirstTokenMs)}`,
            ]
          : []),
      ].join('\n'),
)
</script>
<template>
  <div
    class="generation-metrics"
    :class="{
      stacked,
      'generation-metrics--floating': floating,
      'generation-metrics--flowing': flowRequested,
      'generation-metrics--detail': detail,
    }"
    :title="summary"
  >
    <span
      class="generation-speed"
      :title="speedTooltip"
      :role="floating || stacked ? 'group' : undefined"
      :aria-label="floating || stacked ? speedLabel : undefined"
    >
      <DesignIcon
        v-if="floating || stacked"
        class="generation-metric-icon"
        name="generationSpeed"
        :size="14"
      />
      <small v-else>{{ speedLabel }}</small>
      <b>{{ speed }}</b>
    </span>
    <FloatingGenerationFlow
      v-if="flowRequested"
      :token-delta="tokenDelta"
      :tokens-per-second="sample?.tokensPerSecond"
      :enabled="motionAvailable ?? true"
    />
    <span
      class="generation-ttft"
      :class="{ 'generation-ttft--long': floating && latency.length > 6 }"
      :title="latencyTooltip"
      :role="floating || stacked ? 'group' : undefined"
      :aria-label="floating || stacked ? latencyLabel : undefined"
    >
      <DesignIcon
        v-if="floating || stacked"
        class="generation-metric-icon"
        name="generationTimer"
        :size="14"
      />
      <small v-else>{{ latencyLabel }}</small>
      <b :title="floating ? `${latency}\n${latencyTooltip}` : undefined">{{ latency }}</b>
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
.stacked > span {
  align-items: center;
  gap: 5px;
}
.generation-metrics--floating {
  position: relative;
  display: grid;
  grid-template-columns: 64px minmax(24px, 1fr) 64px;
  gap: 8px;
  padding: 2px 8px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--primary) 5%, var(--surface-low));
}
.generation-metrics--floating > span {
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.generation-metric-icon {
  color: var(--text-muted);
}
.generation-metrics--floating > .generation-speed {
  grid-column: 1;
}
.generation-metrics--floating > .generation-ttft {
  display: grid;
  grid-column: 3;
  grid-template-columns: minmax(0, 1fr) 14px;
  gap: 5px;
}
.generation-metrics--floating > .generation-ttft .generation-metric-icon {
  grid-column: 2;
  grid-row: 1;
}
.generation-metrics--floating > .generation-ttft b {
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: end;
}
.generation-metrics--floating > .generation-ttft--long b {
  font-size: 11px;
}
.generation-metrics--floating::after {
  content: '';
  position: absolute;
  inset-block: 2px;
  inset-inline-start: 50%;
  width: 1px;
  background: var(--border);
  pointer-events: none;
}
.generation-metrics--floating > .generation-flow {
  grid-column: 2;
}
.generation-metrics--flowing::after {
  display: none;
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
