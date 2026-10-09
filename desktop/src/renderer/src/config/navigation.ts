export const navigationGroups = [
  {
    title: ['Workspace', '工作台'],
    items: [
      { to: '/agent', title: ['Overview', '概览'], icon: 'overview' },
      { to: '/sessions', title: ['Sessions', '会话'], icon: 'sessions' },
      { to: '/projects', title: ['Projects', '项目'], icon: null },
      { to: '/token', title: ['Quota', '额度'], icon: 'quota' },
    ],
  },
  {
    title: ['Analysis', '分析'],
    items: [{ to: '/analytics', title: ['Usage analytics', '用量分析'], icon: 'analytics' }],
  },
  {
    title: ['Discover', '发现'],
    items: [
      { to: '/insight', title: ['AI insights', 'AI 信息差'], icon: 'insight' },
      { to: '/codingplan', title: ['Plan comparison', '套餐比价'], icon: 'plans' },
      { to: '/agent-download', title: ['Agent tools', 'Agent 下载'], icon: 'agents' },
    ],
  },
  {
    title: ['Tools', '工具'],
    items: [
      { to: '/network-check', title: ['Network check', '网络体检'], icon: 'globe' },
      { to: '/generation-history', title: ['Generation history', '生成历史'], icon: 'replay' },
    ],
  },
  {
    title: ['Experiments', '实验'],
    items: [
      { to: '/network-monitor', title: ['Traffic monitoring', '流量监控'], icon: 'analytics' },
    ],
  },
] as const
