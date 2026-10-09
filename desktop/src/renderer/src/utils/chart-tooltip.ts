export interface ChartTooltipData {
  title?: string
  subtitle?: string
  summary?: { label: string; value: string }
  rows: Array<{ label: string; value: string; color?: string }>
  note?: string
}

/** DOM text nodes keep local model/project names out of ECharts' HTML parser. */
export function createChartTooltip(data: ChartTooltipData): HTMLElement {
  const element = document.createElement('div')
  element.className = 'chart-tooltip-content'
  element.setAttribute('role', 'tooltip')
  function text(parent: HTMLElement, tag: string, className: string, value: string): HTMLElement {
    const child = document.createElement(tag)
    child.className = className
    child.textContent = value
    parent.appendChild(child)
    return child
  }
  if (data.title) text(element, 'div', 'chart-tooltip-title', data.title)
  if (data.subtitle) text(element, 'div', 'chart-tooltip-subtitle', data.subtitle)
  function row(item: { label: string; value: string; color?: string }, summary = false): void {
    const row = document.createElement('div')
    row.className = `chart-tooltip-row${summary ? ' chart-tooltip-summary' : ''}`
    const name = document.createElement('span')
    name.className = 'chart-tooltip-name'
    if (item.color) {
      const dot = document.createElement('i')
      dot.className = 'chart-tooltip-dot'
      dot.style.backgroundColor = item.color
      name.appendChild(dot)
    }
    text(name, 'span', 'chart-tooltip-label', item.label)
    row.appendChild(name)
    text(row, 'b', 'chart-tooltip-value', item.value)
    element.appendChild(row)
  }
  if (data.summary) row(data.summary, true)
  data.rows.forEach((item) => row(item))
  if (data.note) text(element, 'div', 'chart-tooltip-note', data.note)
  return element
}

/** The viewport, rather than the small chart canvas, bounds both kinds of tooltip. */
export function chartTooltipPosition(
  point: { x: number; y: number },
  size: { width: number; height: number },
): { left: number; top: number } {
  const edge = 12,
    gap = 16
  const left =
    point.x + gap + size.width <= innerWidth - edge ? point.x + gap : point.x - size.width - gap
  const top =
    point.y + gap + size.height <= innerHeight - edge ? point.y + gap : point.y - size.height - gap
  return {
    left: Math.max(edge, Math.min(left, innerWidth - size.width - edge)),
    top: Math.max(edge, Math.min(top, innerHeight - size.height - edge)),
  }
}
