import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import type { UsageAnalytics, UsageAnalyticsFilter } from '@shared/analytics'
import type { Overview, TrackedProject } from '@shared/models'
import { validDate } from '@shared/calendar-date'
import {
  validReplayOptions,
  clampReplayAnimationSettings,
  REPLAY_ANIMATION_MAX_RESOLUTION,
  REPLAY_ANIMATION_MAX_FPS,
  replayDimensions,
  replayFormat,
  type ReplayOptions,
  type ReplayMeasure,
} from '@shared/replay'
import { useI18n } from '../i18n/useI18n'
import { usePageState } from '../composables/usePageState'
import { useScanStatus } from '../composables/useScanStatus'
import { useCostCurrency } from '../composables/useCostCurrency'
import { useLocalFavorites } from '../composables/useLocalFavorites'
import { useVisibleNow } from '../composables/useVisibleNow'
import { getAgentName } from '../config/agents'
import { localDate, presetRange, rollDateRange, type DateRange } from '../utils/date-range'
import { createReplaySnapshot, createReplayTimeline } from './replay-data'
import { replayNote, replayValue } from './replay-painter'
import { useReplayTask } from './replay-task'
import { replayTemplates } from './replay-labels'
import {
  matchingReplayPreset,
  replayPresetSettings,
  replayQualitySignature,
  REPLAY_QUALITY_PRESETS,
} from './replay-presets'
import {
  defaultReplayExportSettings,
  isReplayFormat,
  readReplayExportPreferences,
  replayExportSettings,
  writeReplayExportPreferences,
} from './replay-preferences'

export function useReplayEditor() {
  const { label, currentLang } = useI18n()
  const { revision } = useScanStatus()
  const { currency: defaultCurrency, exchange } = useCostCurrency()
  const favorites = useLocalFavorites()
  const now = useVisibleNow()
  const today = ref(localDate())
  const task = useReplayTask()
  const { busy: taskBusy, preparing, status, progress, failure, records, exported } = task
  const busy = computed(() => preparing.value || taskBusy.value)
  const preferences = readReplayExportPreferences()
  const defaults = {
    ...presetRange('all'),
    title: '',
    dimension: 'models' as ReplayOptions['dimension'],
    measure: 'tokens' as ReplayMeasure,
    currency: defaultCurrency.value,
    agents: [] as string[],
    models: [] as string[],
    projectIds: [] as string[],
    ...preferences.profiles[preferences.format].settings,
  }
  const state = usePageState('generation-history', { ...defaults, defaultsVersion: 0 })
  for (const key of ['agents', 'models', 'projectIds'] as const)
    if (!Array.isArray(state[key])) state[key] = []
  if (!state.defaultsVersion) {
    if (state.preset === 'month') Object.assign(state, presetRange('all'))
    if (state.dimension === 'agents') state.dimension = 'models'
    state.defaultsVersion = 1
  }
  if (!['today', 'week', 'month', 'all', 'custom'].includes(state.preset)) state.preset = 'custom'
  if (state.preset === 'all') Object.assign(state, presetRange('all'))
  else {
    const next = rollDateRange(state)
    if (next !== state) Object.assign(state, next)
  }
  const range = computed<DateRange>({
    get: () => ({ from: state.from, to: state.to, preset: state.preset }),
    set: (value) => Object.assign(state, value),
  })
  const data = shallowRef<UsageAnalytics | null>(null)
  const currency = computed({
    get: () => state.currency,
    set: (value: ReplayOptions['currency']) => {
      if (value) state.currency = value
    },
  })
  const metadata = shallowRef<{ overview: Overview | null; projects: TrackedProject[] }>({
    overview: null,
    projects: [],
  })
  async function refreshFilterOptions(): Promise<void> {
    const [overview, projects] = await Promise.allSettled([
      window.api.getOverview(),
      window.api.projectsList(),
    ])
    metadata.value = {
      overview: overview.status === 'fulfilled' ? overview.value : metadata.value.overview,
      projects: projects.status === 'fulfilled' ? projects.value : metadata.value.projects,
    }
  }
  const agentOptions = computed(() =>
    Object.keys(metadata.value.overview?.agentTotals || {}).map((id) => ({
      value: id,
      label: getAgentName(id),
    })),
  )
  const modelOptions = computed(() =>
    Object.keys(metadata.value.overview?.modelTotals || {}).map((id) => ({ value: id, label: id })),
  )
  const projectOptions = computed(() =>
    metadata.value.projects.map((project) => ({ value: project.id, label: project.name })),
  )
  const favoriteProjects = computed(() =>
    favorites.items.value.filter((item) => item.type === 'project').map((item) => item.id),
  )
  const options = computed<ReplayOptions>(() => {
    const { defaultsVersion: _defaultsVersion, ...settings } = state
    return {
      ...settings,
      agents: [...state.agents],
      models: [...state.models],
      projectIds: [...state.projectIds],
      from: state.from || data.value?.from || localDate(),
      to: state.to || data.value?.to || localDate(),
      language: currentLang.value === 'zh' ? 'zh' : 'en',
    }
  })
  if (!validReplayOptions(options.value)) Object.assign(state, defaults)
  Object.assign(state, clampReplayAnimationSettings(state))
  const format = computed(() => replayFormat(options.value))
  watch(options, () => {
    if (!busy.value && status.value === 'complete') status.value = 'idle'
  })
  const mode = computed(() => format.value.kind)
  const dimensions = computed(() => replayDimensions(options.value))
  const rangeValid = computed(
    () =>
      state.preset === 'all' ||
      (validDate(state.from) &&
        validDate(state.to) &&
        state.from <= state.to &&
        state.to <= today.value &&
        Date.parse(state.to) - Date.parse(state.from) < 3660 * 86400000),
  )
  const loading = ref(false),
    loadError = ref(false)
  let request = 0,
    active = true,
    refreshAfterExport = false,
    timer: ReturnType<typeof setTimeout> | undefined
  function synchronizeRange(): void {
    // An export can begin just after midnight, before the shared clock's next tick.
    today.value = localDate()
    if (state.preset === 'all') {
      if (state.from || state.to) Object.assign(state, presetRange('all'))
      return
    }
    const next = rollDateRange(state)
    if (next !== state) Object.assign(state, next)
  }
  async function load(): Promise<boolean> {
    synchronizeRange()
    clearTimeout(timer)
    const id = ++request
    data.value = null
    loadError.value = false
    if (!rangeValid.value) {
      loading.value = false
      return false
    }
    loading.value = true
    try {
      const filter: UsageAnalyticsFilter = {
        from: state.from || undefined,
        to: state.to || undefined,
        agents: [...state.agents],
        models: [...state.models],
        projectIds: [...state.projectIds],
      }
      const result = await window.api.getUsageAnalytics(filter)
      if (id !== request) return false
      data.value = result
      return true
    } catch {
      if (id === request) loadError.value = true
      return false
    } finally {
      if (id === request) loading.value = false
    }
  }
  watch(
    () => [
      state.from,
      state.to,
      JSON.stringify(state.agents),
      JSON.stringify(state.models),
      JSON.stringify(state.projectIds),
    ],
    () => {
      ++request
      data.value = null
      clearTimeout(timer)
      loadError.value = false
      loading.value = rangeValid.value
      if (active && !busy.value) timer = setTimeout(() => void load(), 180)
      else {
        loading.value = false
        refreshAfterExport = true
      }
    },
    { immediate: true, flush: 'sync' },
  )
  function refreshData(): void {
    if (active && !busy.value) void load()
    else refreshAfterExport = true
  }
  watch([revision, () => localDate(new Date(now.value))], refreshData)
  watch(revision, () => void refreshFilterOptions())
  watch(busy, (value) => {
    if (!value && active && refreshAfterExport) {
      refreshAfterExport = false
      void load()
    }
  })
  const snapshot = computed(() => {
    if (!data.value || !rangeValid.value) return null
    try {
      return createReplaySnapshot(data.value, options.value, exchange.value.snapshot)
    } catch {
      return null
    }
  })
  const empty = computed(
    () =>
      !snapshot.value?.series.length ||
      (snapshot.value.totalTokens === 0 && snapshot.value.totalValue === 0),
  )
  const unavailable = computed(() => snapshot.value?.available === false)
  const preview = computed(() => (taskBusy.value ? task.current.value : snapshot.value))
  const note = computed(() =>
    snapshot.value ? replayNote(createReplayTimeline(snapshot.value)) : '',
  )
  const templates = computed(() =>
    replayTemplates(label).filter((item) => mode.value === 'image' || item.value !== 'summary'),
  )
  const dimensionOptions = computed(() => [
    { value: 'models', label: label('Model', '模型') },
    { value: 'agents', label: 'Agent' },
    { value: 'projects', label: label('Project', '项目') },
  ])
  const measureOptions = computed(() => [
    { value: 'tokens', label: 'Token' },
    { value: 'cost', label: label('Cost', '费用') },
    { value: 'turns', label: label('Turns', '对话次数') },
    { value: 'calls', label: label('API calls', 'API 次数') },
  ])
  const modeOptions = computed(() => [
    { value: 'video', label: label('Video', '视频') },
    { value: 'image', label: label('Image', '静态图') },
    { value: 'animation', label: label('Animation', '动态图') },
  ])
  const formatOptions = computed(() =>
    mode.value === 'image'
      ? [
          { value: 'png', label: 'PNG' },
          { value: 'jpeg', label: 'JPG' },
          { value: 'webp', label: 'WebP' },
        ]
      : mode.value === 'video'
        ? [{ value: 'mp4', label: 'MP4 · H.264' }]
        : [
            { value: 'gif', label: 'GIF' },
            { value: 'webp-animation', label: 'WebP' },
          ],
  )
  const metricOptions = computed(() => [
    { value: 'cumulative' as const, label: label('Cumulative', '累计') },
    {
      value: 'period' as const,
      label:
        snapshot.value?.granularity === 'hour'
          ? label('Per hour', '每小时')
          : label('Per day', '每天'),
    },
  ])
  const durationOptions = computed(() =>
    [10, 20, 30, 60].map((value) => ({
      value: value as ReplayOptions['duration'],
      label: `${value} ${label('sec', '秒')}`,
    })),
  )
  const resolutionOptions = computed(() =>
    (state.format === 'gif' ? [360, 540, 720, 1080] : [540, 720, 1080])
      .filter((value) => mode.value !== 'animation' || value <= REPLAY_ANIMATION_MAX_RESOLUTION)
      .map((value) => ({ value: value as ReplayOptions['resolution'], label: `${value}p` })),
  )
  const fpsOptions = computed(() =>
    (state.format === 'gif' ? [10, 15, 20, 30, 60] : [10, 20, 30, 60])
      .filter((value) => mode.value !== 'animation' || value <= REPLAY_ANIMATION_MAX_FPS)
      .map((value) => ({
        value: value as NonNullable<ReplayOptions['fps']>,
        label: `${value} FPS`,
      })),
  )
  const qualityOptions = computed(() => [
    { value: 65 as const, label: label('Light · 65%', '轻量 · 65%') },
    { value: 85 as const, label: label('Standard · 85%', '标准 · 85%') },
    { value: 95 as const, label: label('Fine · 95%', '精细 · 95%') },
  ])
  const themes = computed(() => [
    { value: 'midnight' as const, label: label('Midnight', '深蓝') },
    { value: 'paper' as const, label: label('Paper', '纸白') },
    { value: 'slate' as const, label: label('Slate', '石墨') },
  ])
  const advancedSummary = computed(() => {
    const quality =
      state.format === 'gif'
        ? `${state.colors} ${label('colors', '色')}`
        : state.format === 'png'
          ? label('Lossless', '无损')
          : `${state.quality}%`
    const content =
      mode.value !== 'image'
        ? `${state.fps} FPS`
        : state.still === 'frame'
          ? label('Selected frame', '选定时刻')
          : label('Whole period', '完整区间')
    return `${content} · ${quality}`
  })
  function setMode(value: string | number): void {
    if (value === mode.value || busy.value) return
    if (value === 'image' || value === 'animation' || value === 'video')
      setFormat(preferences.lastFormats[value])
  }
  function setFormat(value: string | number): void {
    if (!isReplayFormat(value) || value === state.format || busy.value) return
    rememberSettings()
    const profile = preferences.profiles[value]
    changingSettings = true
    Object.assign(state, profile.settings)
    customQuality.value = profile.custom
    changingSettings = false
    rememberSettings()
  }
  const customQuality = ref(preferences.profiles[state.format].custom)
  let changingSettings = false
  function rememberSettings(): void {
    preferences.format = state.format
    preferences.lastFormats[mode.value] = state.format
    preferences.profiles[state.format] = {
      settings: replayExportSettings(state),
      custom: customQuality.value,
    }
    writeReplayExportPreferences(preferences)
  }
  watch(
    () => replayQualitySignature(options.value),
    () => {
      if (!changingSettings) customQuality.value = false
    },
    { flush: 'sync' },
  )
  watch(
    [() => replayExportSettings(state), customQuality],
    () => {
      if (!changingSettings) rememberSettings()
    },
    { immediate: true, flush: 'sync' },
  )
  const selectedQualityPreset = computed(() =>
    customQuality.value ? 'custom' : matchingReplayPreset(options.value),
  )
  const qualityPresetOptions = computed(() => [
    { value: 'light', label: label('Light', '轻量') },
    { value: 'standard', label: label('Standard', '标准') },
    { value: 'fine', label: label('Fine', '精细') },
    { value: 'custom', label: label('Custom', '自定义') },
  ])
  const qualityPresetHint = computed(() =>
    mode.value === 'image'
      ? state.format === 'png'
        ? label(
            'Presets set resolution and scale; PNG remains lossless.',
            '预设会调整分辨率与输出倍率，PNG 保持无损。',
          )
        : label('Presets set resolution, scale and quality.', '预设会调整分辨率、输出倍率与画质。')
      : state.format === 'gif'
        ? label(
            'Presets set resolution, duration, frame rate and colors.',
            '预设会调整分辨率、时长、帧率与色彩。',
          )
        : label(
            'Presets set resolution, duration, frame rate and quality.',
            '预设会调整分辨率、时长、帧率与画质。',
          ),
  )
  function qualityPreset(value: string | number): void {
    if (busy.value) return
    if (value === 'custom') {
      customQuality.value = true
      return
    }
    const preset = REPLAY_QUALITY_PRESETS.find((item) => item === value)
    if (!preset) return
    customQuality.value = false
    Object.assign(state, replayPresetSettings(options.value, preset))
  }
  const sizeHint = computed(() => {
    const pixels = dimensions.value.width * dimensions.value.height
    const bytes =
      mode.value === 'image'
        ? pixels * (state.format === 'png' ? 0.32 : 0.12)
        : state.format === 'mp4'
          ? (pixels * state.fps * (0.04 + (state.quality - 65) * 0.002) * state.duration) / 8
          : pixels * state.fps * state.duration * (state.format === 'gif' ? 0.08 : 0.035)
    const mb = bytes / 1048576
    return `${label('Approx.', '约')} ${Math.max(0.1, mb * 0.5).toFixed(1)}–${Math.max(0.2, mb * 1.8).toFixed(1)} MB`
  })
  const errorText = computed(() => {
    if (failure.value === 'too-large')
      return label(
        'File exceeds 128 MB. Lower resolution, frame rate or duration.',
        '文件超过 128 MB，请降低分辨率、帧率或时长后重试。',
      )
    if (failure.value === 'unsupported')
      return label(
        'This encoder is unavailable. Try another format or a lower resolution.',
        '当前环境不支持此编码，请更换格式或降低分辨率。',
      )
    if (failure.value === 'start')
      return label(
        'Choose a writable folder and keep the selected file extension.',
        '请选择可写文件夹，并保留所选格式的文件扩展名。',
      )
    if (failure.value === 'write')
      return label(
        'Could not save. Check disk space and try again.',
        '写入失败，请检查磁盘空间后重试。',
      )
    if (failure.value === 'history')
      return label('Could not load history. Refresh to retry.', '历史读取失败，请刷新重试。')
    return failure.value
      ? label(
          'Generation stopped. You can retry with these settings.',
          '生成未完成，可以使用当前设置重试。',
        )
      : ''
  })
  const statusText = computed(() =>
    preparing.value
      ? label('Reading latest data…', '正在读取最新数据…')
      : status.value === 'choosing'
        ? label('Choose save location', '请选择保存位置')
        : status.value === 'saving'
          ? label('Saving…', '正在保存…')
          : status.value === 'cancelling'
            ? label('Cancelling…', '正在取消…')
            : `${label('Generating', '正在生成')} ${Math.round(progress.value * 100)}%`,
  )
  async function generate(): Promise<void> {
    if (busy.value || !rangeValid.value) return
    if (status.value === 'complete') status.value = 'idle'
    preparing.value = true
    try {
      // A saved page or missed scan event must never become the source of a new export.
      // Query the database again, then freeze this one snapshot for the entire encoding job.
      if ((await load()) && snapshot.value && !empty.value && !unavailable.value)
        await task.start(snapshot.value)
    } finally {
      preparing.value = false
    }
  }
  function reuse(value: ReplayOptions): void {
    if (busy.value) return
    rememberSettings()
    changingSettings = true
    Object.assign(state, defaults, defaultReplayExportSettings(value.format ?? 'mp4'), value, {
      format: value.format ?? 'mp4',
      measure: value.measure ?? 'tokens',
      fps: value.fps ?? 30,
      quality: value.quality ?? 85,
      colors: value.colors ?? 128,
      scale: value.scale ?? 1,
      preset: 'custom',
    })
    Object.assign(state, clampReplayAnimationSettings(state))
    customQuality.value = false
    changingSettings = false
    rememberSettings()
    void load()
  }
  function refresh(): void {
    refreshData()
    void task.refresh()
  }
  void task.refresh()
  onMounted(() => {
    window.addEventListener('focus', refreshData)
    void refreshFilterOptions()
  })
  onActivated(() => {
    active = true
    void task.refresh()
    void refreshFilterOptions()
    if (!busy.value) {
      refreshAfterExport = false
      void load()
    }
  })
  onDeactivated(() => {
    active = false
    clearTimeout(timer)
  })
  onBeforeUnmount(() => {
    active = false
    ++request
    clearTimeout(timer)
    window.removeEventListener('focus', refreshData)
  })

  return {
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
  }
}
