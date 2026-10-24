import { init, use, registerPostUpdate, type ECharts } from 'echarts/core'
import type { ChartRect } from './chart-label-layout'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
} from 'echarts/components'
import { LabelLayout } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  DataZoomComponent,
  LabelLayout,
  CanvasRenderer,
])

interface BarLayout {
  bandWidth: number
  bars: Array<ChartRect | undefined>
}

const barLayouts = new WeakMap<HTMLElement, Map<string, BarLayout>>()
// Read final data layouts through ECharts' extension API, independent of entrance animations
// and of whether a particular label has been created or hidden.
registerPostUpdate((model, api) => {
  const layouts = new Map<string, BarLayout>()
  model.eachSeriesByType('bar', (series) => {
    const data = series.getData()
    const bars = Array.from({ length: data.count() }, (_, index) => {
      const rect = data.getItemLayout(index) as ChartRect | undefined
      if (!rect) return undefined
      return {
        x: Math.min(rect.x, rect.x + rect.width),
        y: Math.min(rect.y, rect.y + rect.height),
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
      }
    })
    layouts.set(series.id, { bars, bandWidth: data.getLayout('bandWidth') as number })
  })
  barLayouts.set(api.getDom(), layouts)
})

export function getBarLayout(chart: ECharts, seriesId: string): BarLayout | undefined {
  return barLayouts.get(chart.getDom())?.get(seriesId)
}

export { init }
export type { ECharts } from 'echarts/core'
