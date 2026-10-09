import type { ReplayOptions } from '@shared/replay'

export function replayRecordTitle(
  options: ReplayOptions,
  label: (en: string, zh: string) => string,
): string {
  return (
    options.title?.trim() ||
    replayTemplates(label).find((item) => item.value === options.template)?.title ||
    ''
  )
}

export function replayTemplates(label: (en: string, zh: string) => string) {
  return [
    {
      value: 'race' as const,
      title: label('Ranking race', '动态排行'),
      description: label('Watch the rankings change', '看排名随时间变化'),
    },
    {
      value: 'summary' as const,
      title: label('Overview card', '总览卡片'),
      description: label('Your whole period on one card', '一张卡片，回顾全部投入'),
    },
    {
      value: 'trend' as const,
      title: label('Usage journey', '用量轨迹'),
      description: label('See your usage take shape', '让用量趋势徐徐展开'),
    },
    {
      value: 'share' as const,
      title: label('Share in motion', '占比演变'),
      description: label('Discover your changing mix', '回顾 Agent 与模型占比'),
    },
  ]
}
