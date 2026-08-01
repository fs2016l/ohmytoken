import type { Ref } from 'vue'
import { useI18n } from '../i18n/useI18n'
import { useTheme, type Theme } from './useTheme'
import { useTypography } from './useTypography'
import { formatTokens } from '../utils/format'

export interface ChartColors {
  text: string
  axisLine: string
  splitLine: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  tooltipDivider: string
  tooltipTotal: string
  pieBorder: string
  pieEmphasisShadow: string
  centerValue: string
  centerLabel: string
}

export interface TooltipFormatterItem {
  name?: string
  seriesId?: string
  seriesName?: string
  value?: number | string | null
  marker?: string
}

export interface TooltipFormatterOptions {
  totalSeriesId?: string
}

export function getChartColors(theme: Theme): ChartColors {
  const isLight = theme === 'light'
  return {
    text: isLight ? '#65748b' : '#aab6ca',
    axisLine: isLight ? '#d8e0eb' : '#2b3b56',
    splitLine: isLight ? '#e7edf5' : '#1b2940',
    tooltipBg: isLight ? '#ffffff' : '#152137',
    tooltipBorder: isLight ? '#c8d3e1' : '#344662',
    tooltipText: isLight ? '#172033' : '#f4f7fc',
    tooltipDivider: isLight ? '#d8e0eb' : '#344662',
    tooltipTotal: isLight ? '#6758d9' : '#8b80f9',
    pieBorder: isLight ? '#ffffff' : '#0f1828',
    pieEmphasisShadow: isLight ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.45)',
    centerValue: isLight ? '#172033' : '#f4f7fc',
    centerLabel: isLight ? '#607089' : '#8493aa',
  }
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function showEmpty(el: HTMLElement | null, msg: string | null): void {
  if (!el) return
  const existing = el.parentElement?.querySelector('.chart-empty')
  if (existing) existing.remove()
  if (!msg) return

  const div = document.createElement('div')
  div.className = 'chart-empty'
  div.textContent = msg
  el.parentElement?.appendChild(div)
}

function normalizeTooltipItems(items: unknown): TooltipFormatterItem[] {
  if (Array.isArray(items)) return items.map((item) => normalizeTooltipItem(item))
  return [normalizeTooltipItem(items)]
}

function normalizeTooltipItem(item: unknown): TooltipFormatterItem {
  if (!item || typeof item !== 'object') return {}
  const record = item as Record<string, unknown>
  return {
    name: typeof record.name === 'string' ? record.name : undefined,
    seriesId: typeof record.seriesId === 'string' ? record.seriesId : undefined,
    seriesName: typeof record.seriesName === 'string' ? record.seriesName : undefined,
    value:
      typeof record.value === 'number' || typeof record.value === 'string'
        ? record.value
        : undefined,
    marker: typeof record.marker === 'string' ? record.marker : undefined,
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function getAxisValue(params: unknown): string {
  const target = Array.isArray(params) ? params[0] : params
  if (!target || typeof target !== 'object') return ''
  const axisValue = (target as Record<string, unknown>).axisValue
  return axisValue == null ? '' : String(axisValue)
}

export function useChartTheme(themeRef?: Ref<Theme>) {
  const { currentTheme } = useTheme()
  const { currentLang, tr } = useI18n()
  const { currentInterfaceFont, currentNumberFont } = useTypography()
  const activeTheme = themeRef ?? currentTheme

  function chartColors(): ChartColors {
    return getChartColors(activeTheme.value)
  }

  function getChartText(): { color: string; fontFamily: string } {
    // Reading the ref makes ECharts options recompute immediately after a font switch.
    void currentInterfaceFont.value
    void currentNumberFont.value
    const rootStyle = getComputedStyle(document.documentElement)
    return {
      color: chartColors().text,
      fontFamily:
        rootStyle.getPropertyValue('--font-number').trim() ||
        rootStyle.getPropertyValue('--font-sans').trim(),
    }
  }

  function getAxisLine(): { lineStyle: { color: string } } {
    return { lineStyle: { color: chartColors().axisLine } }
  }

  function getSplitLine(): { lineStyle: { color: string; type: 'dashed' } } {
    return { lineStyle: { color: chartColors().splitLine, type: 'dashed' } }
  }

  function getTotalLabel(): string {
    return currentLang.value === 'zh' ? '总量' : 'Total'
  }

  function makeTooltipFormatter(
    title: string,
    rawItems: unknown,
    options: TooltipFormatterOptions = {},
  ): string {
    const cc = chartColors()
    const items = normalizeTooltipItems(rawItems)
    let html = `<div style="font-weight:600;margin-bottom:8px">${escapeHtml(title)}</div>`
    let total = 0
    let totalSeriesRow = ''

    items.forEach((item) => {
      const value = toNumber(item.value)
      const isTotalSeries = Boolean(
        options.totalSeriesId && item.seriesId === options.totalSeriesId,
      )
      if (!isTotalSeries) total += value
      // axis tooltip 中 item.name 是横轴值（如 15:00），系列身份在 seriesName。
      // 优先系列名，确保趋势图显示 Agent/模型，而不是重复显示时间。
      const name = String(item.seriesName || item.name || '')
      const row = `<div style="display:flex;justify-content:space-between;gap:18px;margin:3px 0"><span>${item.marker || ''} ${escapeHtml(name)}</span><b>${formatTokens(value)}</b></div>`
      if (isTotalSeries) totalSeriesRow += row
      else html += row
    })

    html += totalSeriesRow
    html += `<div style="border-top:1px solid ${cc.tooltipDivider};margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;gap:18px"><span>${tr('total')}</span><b style="color:${cc.tooltipTotal}">${formatTokens(total)}</b></div>`
    return html
  }

  return {
    currentLang,
    currentTheme: activeTheme,
    currentInterfaceFont,
    currentNumberFont,
    getChartColors: chartColors,
    getChartText,
    getAxisLine,
    getSplitLine,
    getTotalLabel,
    makeTooltipFormatter,
  }
}
