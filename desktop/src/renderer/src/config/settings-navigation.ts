export const settingsNavigationGroups = [
  {
    title: ['Basic settings', '基础设置'],
    items: [
      {
        to: '/settings/general',
        title: ['General', '通用'],
        subtitle: [
          'Language and window behavior that fit your habits.',
          '让界面与窗口行为更符合你的习惯',
        ],
        icon: 'settingsGeneral',
      },
      {
        to: '/settings/appearance',
        title: ['Appearance and fonts', '外观与字体'],
        subtitle: ['Adjust the theme and typography.', '调整界面主题与字体样式'],
        icon: 'settingsAppearance',
      },
    ],
  },
  {
    title: ['Account', '账户'],
    items: [
      {
        to: '/settings/account',
        title: ['Account management', '账号管理'],
        subtitle: ['Manage your sign-in status and account.', '管理登录状态与账号信息'],
        icon: 'person',
      },
    ],
  },
  {
    title: ['Support and updates', '支持与更新'],
    items: [
      {
        to: '/settings/diagnostics',
        title: ['Diagnostic logs', '诊断日志'],
        subtitle: [
          'Review application logs to help locate problems.',
          '查看运行日志，帮助定位异常',
        ],
        icon: 'settingsLogs',
      },
      {
        to: '/settings/feedback',
        title: ['Suggestions and feedback', '建议与反馈'],
        subtitle: [
          'Share your ideas to help improve Oh My Token.',
          '告诉我们你的想法，一起让 Oh My Token 更好用',
        ],
        icon: 'settingsFeedback',
      },
      {
        to: '/settings/about',
        title: ['About and updates', '关于与更新'],
        subtitle: [
          'Version information, product overview and updates.',
          '版本信息、产品介绍与更新',
        ],
        icon: 'settingsAbout',
      },
    ],
  },
] as const
type SettingsDestination = (typeof settingsNavigationGroups)[number]['items'][number]
export const settingsDestinations = settingsNavigationGroups.flatMap<SettingsDestination>(
  (group) => [...group.items],
)
export function isSettingsPath(path: string): boolean {
  return settingsDestinations.some((item) => item.to === path)
}
