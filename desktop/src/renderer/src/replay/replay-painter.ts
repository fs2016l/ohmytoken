import { replayFormat, replayTitle, type ReplayMeasure, type ReplayOptions } from '@shared/replay'
import { replayPosition, sampleReplay, type ReplayTimeline } from './replay-data'

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const NUMBER = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'
export function replayNumber(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return Math.round(value).toLocaleString('en-US')
}
export function replayValue(
  value: number | null,
  options: ReplayOptions,
  measure = options.measure ?? 'tokens',
): string {
  if (value === null) return '—'
  return measure === 'cost'
    ? `${options.currency === 'CNY' ? '¥' : '$'}${value >= 10000 ? replayNumber(value) : value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : replayNumber(value)
}
export function replayMeasureLabel(measure: ReplayMeasure, zh: boolean): string {
  return {
    tokens: 'Token',
    cost: zh ? '预估费用' : 'Estimated cost',
    turns: zh ? '对话次数' : 'Conversation turns',
    calls: zh ? 'API 次数' : 'API calls',
  }[measure]
}
export function replayNote(timeline: ReplayTimeline): string {
  const zh = timeline.snapshot.options.language === 'zh'
  return (timeline.snapshot.notes ?? [])
    .map(
      (note) =>
        ({
          partial: zh ? '部分数据未计入' : 'Partial data',
          range: zh ? '费用为区间估算，图中展示下限' : 'Estimated range; chart shows lower bound',
          unavailable: zh ? '数据或汇率暂不可用' : 'Data or exchange rate unavailable',
        })[note],
    )
    .join(' · ')
}
export function paintReplay(ctx: Context, timeline: ReplayTimeline, seconds: number): void {
  const { snapshot } = timeline,
    o = snapshot.options
  const zh = o.language === 'zh',
    portrait = o.aspect === 'portrait',
    square = o.aspect === 'square'
  const width = portrait ? 720 : square ? 900 : 1280,
    height = portrait ? 1280 : square ? 900 : 720
  const still = replayFormat(o).kind === 'image'
  const entire = still && o.still !== 'frame'
  const progress = entire
    ? 1
    : replayPosition(still ? (o.position ?? 1) * o.duration : seconds, o.duration)
  const sample = sampleReplay(timeline, progress)
  if (entire && o.template !== 'trend') {
    sample.values = snapshot.series.map((_, i) =>
      snapshot.points.reduce((sum, point) => sum + point.values[i], 0),
    )
    sample.total = sample.values.reduce((a, b) => a + b, 0)
  }
  // Freeze ordering in stills so labels cannot collide halfway through a rank swap.
  if (still) {
    ;[...sample.values.keys()]
      .sort((a, b) => sample.values[b] - sample.values[a] || a - b)
      .forEach((i, rank) => {
        sample.ranks[i] = rank
      })
  }
  const transparent = still && o.transparent && o.format !== 'jpeg'
  const light = o.theme === 'paper' || transparent
  const palette = light
    ? {
        bg: '#f8faff',
        end: '#ffffff',
        text: '#13233e',
        muted: '#70809b',
        grid: '#e4eaf4',
        panel: '#edf2fc',
      }
    : o.theme === 'slate'
      ? {
          bg: '#202936',
          end: '#141c28',
          text: '#f5f7fc',
          muted: '#a0adc1',
          grid: '#354154',
          panel: '#293548',
        }
      : {
          bg: '#10263b',
          end: '#091427',
          text: '#f5f7fc',
          muted: '#91a6bf',
          grid: '#20364f',
          panel: '#18304a',
        }
  ctx.save()
  ctx.setTransform(ctx.canvas.width / width, 0, 0, ctx.canvas.height / height, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const text = (
    value: string,
    x: number,
    y: number,
    size = 18,
    color = palette.text,
    align: CanvasTextAlign = 'left',
    weight = 400,
    maxWidth = width,
  ): void => {
    ctx.font = `${weight} ${size}px ${/[\u3400-\u9fff]/.test(value) ? FONT : NUMBER}`
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.textBaseline = 'alphabetic'
    let display = value
    if (ctx.measureText(display).width > maxWidth) {
      while (display.length && ctx.measureText(display + '…').width > maxWidth)
        display = display.slice(0, -1)
      display += '…'
    }
    ctx.fillText(display, x, y)
  }
  const box = (x: number, y: number, w: number, h: number, color: string, radius = 6): void => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x, y, Math.max(0, w), h, radius)
    ctx.fill()
  }
  const line = (x1: number, y1: number, x2: number, y2: number): void => {
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.strokeStyle = palette.grid
    ctx.lineWidth = 1
    ctx.stroke()
  }
  if (!transparent) {
    const background = ctx.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, palette.bg)
    background.addColorStop(1, palette.end)
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }
  const margin = 56,
    measure = o.measure ?? 'tokens'
  text(zh ? 'PEOPLE FIRST' : '以人为本', margin, 44, 13, palette.muted, 'left', 600)
  const title = replayTitle(o),
    titleWidth = portrait ? 608 : square ? 540 : 580,
    titleSize = portrait ? 34 : 38
  ctx.font = `650 ${titleSize}px ${/[\u3400-\u9fff]/.test(title) ? FONT : NUMBER}`
  const fittedTitleSize = Math.min(
    titleSize,
    (titleSize * titleWidth) / Math.max(1, ctx.measureText(title).width),
  )
  text(title, margin, 99, fittedTitleSize, palette.text, 'left', 650)
  text(
    `${o.from} — ${o.to}  ·  ${o.dimension === 'agents' ? 'Agent' : o.dimension === 'projects' ? (zh ? '项目' : 'Projects') : zh ? '模型' : 'Models'}`,
    margin,
    132,
    16,
    palette.muted,
  )
  const numberX = portrait || square ? margin : width - 306
  const numberY = portrait || square ? 226 : 102
  text(
    replayValue(entire ? (snapshot.totalValue ?? snapshot.totalTokens) : sample.total, o),
    numberX,
    numberY,
    portrait ? 64 : square ? 52 : 56,
    palette.text,
    portrait || square ? 'left' : 'right',
    650,
    portrait || square ? width - margin * 2 - 155 : 330,
  )
  text(
    `${entire ? (zh ? '区间合计' : 'Period total') : o.metric === 'cumulative' ? (zh ? '累计' : 'Cumulative') : snapshot.granularity === 'hour' ? (zh ? '当小时' : 'This hour') : zh ? '当日' : 'This day'} ${replayMeasureLabel(measure, zh)}${measure === 'cost' ? ` · ${o.currency ?? 'USD'}` : ''}`,
    numberX,
    numberY + 29,
    15,
    palette.muted,
    portrait || square ? 'left' : 'right',
  )
  const dateLabel = entire
    ? zh
      ? '完整回顾'
      : 'FULL RECAP'
    : snapshot.granularity === 'hour'
      ? `${sample.key.slice(11, 13)}:00`
      : sample.key.slice(5).replace('-', '.')
  text(
    dateLabel,
    width - margin,
    portrait || square ? 222 : 98,
    entire ? 20 : 36,
    palette.text,
    'right',
    500,
  )
  text(
    entire
      ? `${snapshot.points.length} ${snapshot.granularity === 'hour' ? (zh ? '小时' : 'hours') : zh ? '天' : 'days'}`
      : sample.key.slice(0, 4),
    width - margin,
    portrait || square ? 251 : 129,
    14,
    palette.muted,
    'right',
  )
  let top = portrait ? 354 : square ? 316 : 230
  const bottom = height - 118
  const summary = entire ? snapshot.summary : sample.summary
  if (o.template === 'summary' && summary) {
    const measures = (['tokens', 'cost', 'turns', 'calls'] as ReplayMeasure[]).filter(
      (item) => item !== measure,
    )
    const gap = 14,
      cardWidth = (width - margin * 2 - gap * 2) / 3
    const cardY = portrait || square ? 297 : 178
    measures.forEach((item, i) => {
      const x = margin + i * (cardWidth + gap)
      box(x, cardY, cardWidth, 95, palette.panel, 10)
      text(
        replayMeasureLabel(item, zh),
        x + 18,
        cardY + 30,
        portrait ? 13 : 15,
        palette.muted,
        'left',
        400,
        cardWidth - 30,
      )
      text(
        replayValue(summary[item], o, item),
        x + 18,
        cardY + 70,
        portrait ? 25 : 31,
        palette.text,
        'left',
        600,
        cardWidth - 30,
      )
    })
    top = cardY + 150
  }
  const visible = snapshot.series
    .map((series, i) => ({ ...series, i, rank: sample.ranks[i], value: sample.values[i] }))
    .filter((item) => item.rank < 6)
  if (o.template === 'race' || o.template === 'summary') {
    const rowHeight = (bottom - top) / 6
    const labelWidth = portrait ? 154 : square ? 170 : 190
    const plotLeft = margin + labelWidth,
      plotWidth = width - margin - plotLeft - 98
    const maximum = Math.max(1, ...sample.values)
    for (let i = 0; i <= 4; i++) {
      const x = plotLeft + (plotWidth * i) / 4
      line(x, top - 20, x, bottom - 7)
      text(replayValue((maximum * i) / 4, o), x, bottom + 20, 11, palette.muted, 'center')
    }
    ctx.save()
    ctx.beginPath()
    ctx.rect(margin, top - 17, width - margin * 2, bottom - top + 13)
    ctx.clip()
    for (const item of visible) {
      const y = top + item.rank * rowHeight
      const barWidth = (plotWidth * item.value) / maximum
      text(
        item.name,
        plotLeft - 18,
        y + rowHeight * 0.5,
        portrait ? 16 : 18,
        palette.text,
        'right',
        450,
        labelWidth - 24,
      )
      box(plotLeft, y + 5, barWidth, rowHeight * 0.6, item.color, 4)
      text(
        replayValue(item.value, o),
        plotLeft + barWidth + 12,
        y + rowHeight * 0.5,
        portrait ? 14 : 17,
        palette.text,
        'left',
        600,
        88,
      )
    }
    ctx.restore()
  } else if (o.template === 'trend') {
    const left = margin + 62,
      right = width - margin,
      chartTop = top - 10,
      chartBottom = bottom - 25
    const indexes = snapshot.series.slice(0, 6).map((_, i) => i)
    let max = 1
    for (const row of timeline.values) for (const i of indexes) max = Math.max(max, row[i])
    for (let i = 0; i <= 4; i++) {
      const y = chartBottom - ((chartBottom - chartTop) * i) / 4
      line(left, y, right, y)
      text(replayValue((max * i) / 4, o), left - 14, y + 5, 12, palette.muted, 'right')
    }
    for (const index of indexes) {
      ctx.beginPath()
      const last = Math.floor(sample.position)
      for (let i = 0; i <= last; i++) {
        const x = left + ((right - left) * i) / (timeline.values.length - 1),
          y = chartBottom - ((chartBottom - chartTop) * timeline.values[i][index]) / max
        if (!i) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      const x = left + ((right - left) * sample.position) / (timeline.values.length - 1),
        y = chartBottom - ((chartBottom - chartTop) * sample.values[index]) / max
      ctx.lineTo(x, y)
      ctx.strokeStyle = snapshot.series[index].color
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = snapshot.series[index].color
      ctx.fill()
    }
    text(o.from.slice(5), left, chartBottom + 25, 13, palette.muted)
    text(o.to.slice(5), right, chartBottom + 25, 13, palette.muted, 'right')
    const legendWidth = (width - margin * 2) / 3
    snapshot.series.slice(0, 6).forEach((item, i) => {
      const x = margin + (i % 3) * legendWidth,
        y = top - 63 + Math.floor(i / 3) * 23
      box(x, y - 9, 8, 8, item.color, 3)
      text(item.name, x + 16, y, 12, palette.muted, 'left', 400, legendWidth - 27)
    })
  } else {
    const centerX = portrait || square ? width / 2 : width * 0.31
    const centerY = portrait || square ? top + 150 : (top + bottom) / 2 - 5
    const radius = portrait || square ? 130 : 156
    let angle = -Math.PI / 2
    const ordered = [...visible].sort((a, b) => a.rank - b.rank)
    snapshot.series.forEach((series, i) => {
      const arc = sample.total ? (sample.values[i] / sample.total) * Math.PI * 2 : 0
      if (!arc) return
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, angle + 0.005, angle + Math.max(0.005, arc - 0.005))
      ctx.strokeStyle = series.color
      ctx.lineWidth = 38
      ctx.stroke()
      angle += arc
    })
    text(zh ? '用量构成' : 'YOUR MIX', centerX, centerY - 8, 16, palette.muted, 'center')
    text(`${snapshot.series.length}`, centerX, centerY + 39, 48, palette.text, 'center', 600)
    const legendTop = portrait || square ? centerY + radius + 58 : top + 10
    const row = portrait || square ? Math.min(49, (bottom - legendTop) / 6) : 54
    const legendLeft = portrait || square ? margin + 15 : width * 0.56
    ordered.forEach((item, i) => {
      const y = legendTop + i * row
      box(legendLeft, y - 9, 9, 9, item.color, 3)
      text(
        item.name,
        legendLeft + 24,
        y,
        17,
        palette.text,
        'left',
        450,
        width - legendLeft - margin - 102,
      )
      text(
        `${(sample.total ? (item.value / sample.total) * 100 : 0).toFixed(1)}%`,
        width - margin,
        y,
        18,
        palette.text,
        'right',
        600,
      )
    })
  }
  line(margin, height - 73, width - margin, height - 73)
  text(
    'www.OhMyToken.net',
    width - margin,
    height - 41,
    15,
    light ? '#365df5' : '#a6b7ff',
    'right',
    600,
  )
  text(
    zh ? '你的AI助手' : 'Your AI assistant',
    width - margin,
    height - 19,
    13,
    palette.muted,
    'right',
  )
  if (!still)
    box(0, height - 3, width * Math.max(0, Math.min(1, seconds / o.duration)), 3, '#587bff', 0)
  ctx.restore()
}
