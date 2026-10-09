<script setup lang="ts">
import PageSurface from '../components/base/PageSurface.vue'
import DateRangeControl from '../components/base/DateRangeControl.vue'
import SegmentedControl from '../components/base/SegmentedControl.vue'
import SelectControl from '../components/base/SelectControl.vue'
import FilterSelect from '../components/base/FilterSelect.vue'
import ReplayIcon from '../components/replay/ReplayIcon.vue'
import ReplayPreview from '../components/replay/ReplayPreview.vue'
import ReplayHistory from '../components/replay/ReplayHistory.vue'
import ReplayAdvancedSettings from '../components/replay/ReplayAdvancedSettings.vue'
import '../styles/replay.css'
import {
  REPLAY_TITLE_MAX_LENGTH,
  replayTitle,
  type ReplayOptions,
  type ReplayMeasure,
} from '@shared/replay'
import { useReplayEditor } from '../replay/useReplayEditor'
const {
  replayValue,
  sizeHint,
  label,
  state,
  busy,
  range,
  dimensionOptions,
  measureOptions,
  currency,
  agentOptions,
  modelOptions,
  projectOptions,
  favoriteProjects,
  metricOptions,
  templates,
  themes,
  advancedSummary,
  mode,
  preview,
  snapshot,
  empty,
  unavailable,
  loading,
  loadError,
  data,
  rangeValid,
  refresh,
  note,
  options,
  format,
  dimensions,
  modeOptions,
  formatOptions,
  setMode,
  setFormat,
  resolutionOptions,
  durationOptions,
  fpsOptions,
  qualityOptions,
  qualityPreset,
  selectedQualityPreset,
  qualityPresetOptions,
  qualityPresetHint,
  status,
  progress,
  task,
  statusText,
  generate,
  errorText,
  exported,
  records,
  reuse,
} = useReplayEditor()
const templateIcons = {
  race: 'bar_chart',
  trend: 'show_chart',
  share: 'donut_large',
  summary: 'dashboard',
}
</script>

<template>
  <PageSurface page-key="generation-history" class="replay-page">
    <header class="replay-heading">
      <div>
        <h1>{{ label('Generation history', '生成历史') }}</h1>
        <p>
          {{
            label(
              'A moving story. A shareable snapshot. Your AI journey.',
              '将 AI 使用历程，变成值得分享的动态图与卡片。',
            )
          }}
        </p>
      </div>
      <div class="replay-date" :inert="busy" :class="{ 'replay-disabled': busy }">
        <DateRangeControl v-model="range" />
      </div>
    </header>
    <fieldset class="replay-toolbar" :disabled="busy">
      <div>
        <span>{{ label('Group by', '统计维度') }}</span>
        <SegmentedControl
          :model-value="state.dimension"
          :options="dimensionOptions"
          :label="label('Group by', '统计维度')"
          compact
          @update:model-value="state.dimension = $event as ReplayOptions['dimension']"
        />
      </div>
      <div>
        <span>{{ label('Measure', '统计指标') }}</span>
        <SegmentedControl
          :model-value="state.measure"
          :options="measureOptions"
          :label="label('Measure', '统计指标')"
          compact
          @update:model-value="state.measure = $event as ReplayMeasure"
        />
      </div>
      <div v-if="state.measure === 'cost'">
        <SelectControl
          v-model="currency"
          :options="[
            { value: 'USD', label: 'USD' },
            { value: 'CNY', label: 'CNY' },
          ]"
          :label="label('Currency', '币种')"
          compact
          :disabled="busy"
        />
      </div>
      <div class="replay-aggregation">
        <span>{{ label('Aggregation', '统计方式') }}</span>
        <SelectControl
          v-model="state.metric"
          :options="metricOptions"
          :label="label('Aggregation', '统计方式')"
          compact
          :disabled="busy || (mode === 'image' && state.still === 'summary')"
        />
      </div>
    </fieldset>
    <fieldset class="replay-filters" :disabled="busy">
      <FilterSelect
        v-model="state.agents"
        :name="label('Agent', 'Agent')"
        :options="agentOptions"
        :label="label('All Agents', '所有 Agent')"
        icon="stacks"
        option-kind="agent"
      />
      <FilterSelect
        v-model="state.models"
        :name="label('Models', '模型')"
        :options="modelOptions"
        :label="label('All models', '全部模型')"
        icon="memory"
        option-kind="model"
      />
      <FilterSelect
        v-model="state.projectIds"
        :name="label('Projects', '项目')"
        :options="projectOptions"
        :favorite-values="favoriteProjects"
        :label="label('All projects', '全部项目')"
        icon="folder"
      />
    </fieldset>
    <div class="replay-workbench">
      <section class="replay-editor">
        <div class="replay-preview-toolbar">
          <SegmentedControl
            class="replay-template-tabs"
            :model-value="state.template"
            :options="
              templates.map((item) => ({ value: item.value, label: item.title, disabled: busy }))
            "
            :label="label('Template', '画面模板')"
            appearance="underline"
            @update:model-value="state.template = $event as ReplayOptions['template']"
          >
            <template #option="{ option }">
              <span class="material-symbols-outlined" aria-hidden="true">
                {{ templateIcons[option.value as ReplayOptions['template']] }}
              </span>
              {{ option.label }}
            </template>
          </SegmentedControl>
          <div class="replay-theme-switch" :aria-label="label('Canvas theme', '画面主题')">
            <button
              v-for="theme in themes"
              :key="theme.value"
              :class="[theme.value, { selected: state.theme === theme.value }]"
              :title="theme.label"
              :aria-label="theme.label"
              :aria-pressed="state.theme === theme.value"
              :disabled="busy || state.transparent"
              @click="state.theme = theme.value"
            >
              <i />
            </button>
          </div>
        </div>
        <ReplayPreview
          v-if="preview && (busy || (!empty && !unavailable))"
          :snapshot="preview"
          @position="state.position = $event"
        />
        <div v-else class="replay-preview-empty" :aria-busy="loading">
          <span class="material-symbols-outlined" aria-hidden="true">
            {{ loading ? 'hourglass_empty' : 'insert_chart' }}
          </span>
          <strong>
            {{
              loading
                ? label('Preparing your story…', '正在整理你的使用历程…')
                : !rangeValid
                  ? label('Choose a valid date range', '请选择有效的日期范围')
                  : loadError || (!snapshot && data)
                    ? label('Could not prepare this range', '暂时无法生成该时间范围的回顾')
                    : unavailable
                      ? label('This measure is not available', '当前指标暂不可用')
                      : label('Your next story starts here', '你的下一段故事，从这里开始')
            }}
          </strong>
          <p>
            {{
              unavailable
                ? label(
                    'Pricing, exchange rates or complete counts may be missing. Try another measure.',
                    '可能缺少价格、汇率或次数记录，可以选择其他指标。',
                  )
                : label(
                    'Choose a period with recorded activity.',
                    '选择有使用记录的时间范围，即可预览。',
                  )
            }}
          </p>
          <button v-if="loadError" class="workspace-button" @click="refresh">
            {{ label('Retry', '重试') }}
          </button>
        </div>
        <div class="replay-caption">
          <span>
            {{
              state.dimension === 'agents'
                ? 'Agent'
                : state.dimension === 'projects'
                  ? label('Project', '项目')
                  : label('Model', '模型')
            }}
            · {{ measureOptions.find((item) => item.value === state.measure)?.label }} ·
            {{
              mode === 'image' && state.still === 'summary'
                ? label('Whole period', '完整区间')
                : metricOptions.find((item) => item.value === state.metric)?.label
            }}
          </span>
          <span>
            {{
              note ||
              (snapshot
                ? `${label('Total', '区间合计')} ${replayValue(snapshot.totalValue ?? snapshot.totalTokens, options)}`
                : '')
            }}
          </span>
        </div>
      </section>
      <aside class="replay-settings">
        <h2>{{ label('Export settings', '导出设置') }}</h2>
        <fieldset :disabled="busy">
          <div class="replay-title-field">
            <div class="replay-title-label">
              <label for="replay-custom-title">{{ label('Canvas title', '画面标题') }}</label>
              <span id="replay-title-count" class="numeric">
                {{ state.title.length }} / {{ REPLAY_TITLE_MAX_LENGTH }}
              </span>
            </div>
            <input
              id="replay-custom-title"
              v-model="state.title"
              type="text"
              :maxlength="REPLAY_TITLE_MAX_LENGTH"
              :placeholder="replayTitle({ language: options.language })"
              aria-describedby="replay-title-hint replay-title-count"
              autocomplete="off"
            />
            <p id="replay-title-hint">
              {{
                label(
                  'Live preview. Leave blank for the default title.',
                  '实时更新预览，留空使用默认标题。',
                )
              }}
            </p>
          </div>
          <SegmentedControl
            :model-value="mode"
            :options="modeOptions"
            :label="label('Export type', '导出类型')"
            compact
            @update:model-value="setMode"
          />
          <div class="replay-inline-field">
            <span>{{ label('Format', '格式') }}</span>
            <SegmentedControl
              :model-value="state.format"
              :options="formatOptions"
              :label="label('File format', '文件格式')"
              compact
              @update:model-value="setFormat"
            />
          </div>
          <div class="replay-inline-field">
            <span>{{ label('Ratio', '画面比例') }}</span>
            <SegmentedControl
              :model-value="state.aspect"
              :options="[
                { value: 'landscape', label: '16:9' },
                { value: 'portrait', label: '9:16' },
                { value: 'square', label: '1:1' },
              ]"
              :label="label('Aspect ratio', '画面比例')"
              compact
              @update:model-value="state.aspect = $event as ReplayOptions['aspect']"
            />
          </div>
          <div class="replay-settings-grid">
            <label>
              <span>{{ label('Resolution', '分辨率') }}</span>
              <SelectControl
                v-model="state.resolution"
                :options="resolutionOptions"
                :label="label('Resolution', '分辨率')"
                :disabled="busy"
                compact
              />
            </label>
            <label v-if="mode !== 'image'">
              <span>{{ label('Duration', '时长') }}</span>
              <SelectControl
                v-model="state.duration"
                :options="durationOptions"
                :label="label('Duration', '时长')"
                :disabled="busy"
                compact
              />
            </label>
            <label v-else>
              <span>{{ label('Pixel scale', '输出倍率') }}</span>
              <SelectControl
                v-model="state.scale"
                :options="[
                  { value: 1, label: '1×' },
                  { value: 2, label: '2×' },
                  { value: 3, label: '3×' },
                ]"
                :label="label('Pixel scale', '输出倍率')"
                :disabled="busy"
                compact
              />
            </label>
          </div>
          <ReplayAdvancedSettings
            :label="label('Advanced settings', '高级设置')"
            :summary="advancedSummary"
          >
            <div class="replay-advanced-content">
              <div class="replay-quality-presets">
                <span>{{ label('Quick setup', '快捷配置') }}</span>
                <SegmentedControl
                  :model-value="selectedQualityPreset"
                  :options="qualityPresetOptions"
                  :label="label('Quick setup', '快捷配置')"
                  appearance="light"
                  compact
                  @update:model-value="qualityPreset"
                />
                <p>{{ qualityPresetHint }}</p>
              </div>
              <div class="replay-settings-grid">
                <label v-if="mode !== 'image'">
                  <span>{{ label('Frame rate', '帧率') }}</span>
                  <SelectControl
                    v-model="state.fps"
                    :options="fpsOptions"
                    :label="label('Frame rate', '帧率')"
                    :disabled="busy"
                    compact
                  />
                </label>
                <label v-else>
                  <span>{{ label('Content', '画面内容') }}</span>
                  <SelectControl
                    v-model="state.still"
                    :options="[
                      { value: 'summary', label: label('Whole period', '完整区间') },
                      {
                        value: 'frame',
                        label: label('Selected frame', '选定时刻'),
                      },
                    ]"
                    :label="label('Content', '画面内容')"
                    :disabled="busy"
                    compact
                  />
                </label>
                <label v-if="state.format === 'gif'">
                  <span>{{ label('Colors', '色彩') }}</span>
                  <SelectControl
                    v-model="state.colors"
                    :options="
                      [64, 128, 256].map((value) => ({
                        value: value as 64 | 128 | 256,
                        label: `${value} ${label('colors', '色')}`,
                      }))
                    "
                    :label="label('Colors', '色彩')"
                    :disabled="busy"
                    compact
                  />
                </label>
                <label v-else>
                  <span>{{ label('Quality', '画质') }}</span>
                  <div v-if="state.format === 'png'" class="replay-fixed-setting">
                    {{ label('Lossless', '无损') }}
                    <span>PNG</span>
                  </div>
                  <SelectControl
                    v-else
                    v-model="state.quality"
                    :options="qualityOptions"
                    :label="label('Quality', '画质')"
                    :disabled="busy"
                    compact
                  />
                </label>
              </div>
              <label v-if="mode === 'animation'" class="replay-checkbox">
                <input v-model="state.loop" type="checkbox" />
                {{ label('Loop animation', '循环播放') }}
                <span>{{ label('Silent', '无声动画') }}</span>
              </label>
              <label v-else-if="mode === 'image'" class="replay-checkbox">
                <input
                  v-model="state.transparent"
                  type="checkbox"
                  :disabled="state.format === 'jpeg'"
                />
                {{ label('Transparent background', '透明背景') }}
                <span>
                  {{
                    state.format === 'jpeg'
                      ? label('JPG is opaque', 'JPG 不支持')
                      : label('Paper theme', '使用纸白主题')
                  }}
                </span>
              </label>
              <p v-else class="replay-codec">
                H.264 · {{ state.fps }} FPS · {{ label('Silent video', '无声视频') }}
              </p>
              <p v-if="state.format === 'gif' && state.fps === 60" class="replay-codec">
                {{
                  label(
                    'GIF playback speed varies by viewer. Choose WebP for smooth 60 FPS.',
                    'GIF 播放速度受查看器限制，流畅 60 FPS 建议选择 WebP。',
                  )
                }}
              </p>
            </div>
          </ReplayAdvancedSettings>
        </fieldset>
        <div class="replay-export-footer">
          <div class="replay-size-hint">
            <strong class="numeric">{{ dimensions.width }} × {{ dimensions.height }}</strong>
            <span
              :title="
                label(
                  'Estimate only; actual size depends on content. Maximum 128 MB.',
                  '仅作参考，实际体积取决于画面内容；单文件上限 128 MB。',
                )
              "
            >
              {{ sizeHint }}
            </span>
          </div>
          <template v-if="busy">
            <div class="replay-progress">
              <span :style="{ width: `${Math.max(2, progress * 100)}%` }" />
            </div>
            <div class="replay-export-progress" role="status">
              <span>{{ statusText }}</span>
              <button :disabled="status !== 'encoding'" @click="task.cancel">
                {{ label('Cancel', '取消') }}
              </button>
            </div>
          </template>
          <button
            v-else
            class="replay-generate"
            data-testid="replay-export"
            :disabled="!snapshot || loading || empty || unavailable"
            @click="generate"
          >
            <ReplayIcon name="download" :size="18" />
            {{ label('Generate & export', '生成并导出') }} {{ format.label }}
          </button>
          <p v-if="errorText" class="replay-export-message error" role="alert">{{ errorText }}</p>
          <p v-else-if="status === 'complete'" class="replay-export-message" role="status">
            {{
              exported
                ? label('Exported. A copy is saved in history.', '已导出，历史中已保留一份。')
                : label(
                    'Saved in history. Use Save as to export again.',
                    '已存入历史；目标位置写入失败，可在历史中另存为。',
                  )
            }}
          </p>
          <p v-else class="replay-export-message">
            {{
              label(
                'Choose a save location. A copy stays in local history.',
                '选择保存位置后开始生成，历史中自动保留一份。',
              )
            }}
          </p>
        </div>
      </aside>
      <ReplayHistory :records="records" :busy="busy" @reuse="reuse" @refresh="task.refresh" />
    </div>
  </PageSurface>
</template>
