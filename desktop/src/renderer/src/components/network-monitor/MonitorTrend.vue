<script setup lang="ts">
import { computed } from 'vue'
import type { MonitorSnapshot, MonitorFileAssociation } from '@shared/network-monitor'
import { use } from 'echarts/core'
import { MarkPointComponent } from 'echarts/components'
import WorkspaceChart from '../base/WorkspaceChart.vue'
import { useChartTokens } from '../../composables/useChartTokens'
import { useI18n } from '../../i18n/useI18n'
import { monitorBytes } from '../../utils/network-monitor-display'
import { createChartTooltip } from '../../utils/chart-tooltip'
use([MarkPointComponent])
const props = defineProps<{ points: MonitorSnapshot['trend']; events?: MonitorFileAssociation[] }>()
const { label } = useI18n()
const tokens = useChartTokens()
const option = computed(() => ({
  grid: { left: 6, right: 12, top: 18, bottom: 4, containLabel: true },
  xAxis: {
    type: 'time',
    splitNumber: 4,
    axisTick: { show: false },
    axisLine: { show: false },
    axisLabel: { color: tokens.value['--text-soft'], fontSize: 10, formatter: '{HH}:{mm}:{ss}' },
  },
  yAxis: {
    type: 'value',
    min: 0,
    splitNumber: 3,
    axisLabel: {
      color: tokens.value['--text-soft'],
      fontSize: 10,
      formatter: (value: number) => `${monitorBytes(value)}/s`,
    },
    splitLine: { lineStyle: { color: tokens.value['--border'], type: 'dotted' } },
  },
  tooltip: {
    trigger: 'axis',
    renderMode: 'html',
    confine: true,
    borderWidth: 0,
    padding: 0,
    backgroundColor: 'transparent',
    extraCssText: 'box-shadow:none',
    formatter: (params: Array<{ data: [number, number]; seriesName: string; color: string }>) =>
      createChartTooltip({
        title: new Date(params[0]?.data[0]).toLocaleTimeString(),
        rows: params.map((row) => ({
          label: row.seriesName,
          value: `${monitorBytes(row.data[1])}/s`,
          color: row.color,
        })),
      }),
  },
  series: [
    ['sent', label('Upload', '上传'), tokens.value['--chart-primary']],
    ['received', label('Download', '下载'), '#25866a'],
  ].map(([key, name, color]) => ({
    id: key,
    name,
    type: 'line',
    showSymbol: false,
    smooth: 0.2,
    connectNulls: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    areaStyle: { color, opacity: 0.06 },
    markPoint:
      key === 'sent'
        ? {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: '#de941c' },
            label: {
              show: true,
              position: 'top',
              formatter: label('Suspected', '疑似事件'),
              color: '#ad6915',
              fontSize: 10,
            },
            data: (props.events ?? [])
              .filter(
                (event) =>
                  event.lastUploadAt >= props.points[0]?.at &&
                  event.lastUploadAt <= props.points.at(-1)!.at,
              )
              .map((event) => {
                const point = props.points.reduce((closest, row) =>
                  Math.abs(row.at - event.lastUploadAt) < Math.abs(closest.at - event.lastUploadAt)
                    ? row
                    : closest,
                )
                return { coord: [point.at, point.sent] }
              }),
          }
        : undefined,
    data: props.points.map((point) => [point.at, key === 'sent' ? point.sent : point.received]),
  })),
}))
</script>
<template>
  <WorkspaceChart
    :option="option"
    :label="label('Network speed over the last 60 seconds', '最近 60 秒网络速率')"
  />
</template>
