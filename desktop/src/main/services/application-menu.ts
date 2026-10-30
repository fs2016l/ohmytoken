import type { MenuItemConstructorOptions } from 'electron'

export type SettingsSection = 'general' | 'about' | 'feedback'

interface ApplicationMenuActions {
  openSettings: (section: SettingsSection) => void
  showMainWindow: () => void
  toggleFloatingWindow: () => void
  checkForUpdates: () => void
  openWebsite: () => void
  quit: () => void
}

/** Explicit labels follow the product language; native roles retain macOS shortcuts. */
export function applicationMenuTemplate(
  language: 'zh' | 'en',
  floatingVisible: boolean,
  actions: ApplicationMenuActions,
): MenuItemConstructorOptions[] {
  const label = (zh: string, en: string): string => (language === 'zh' ? zh : en)
  return [
    {
      label: 'ohmytoken',
      submenu: [
        {
          label: label('关于 ohmytoken', 'About ohmytoken'),
          click: () => actions.openSettings('about'),
        },
        { label: label('检查更新', 'Check for Updates'), click: actions.checkForUpdates },
        {
          label: label('设置…', 'Settings…'),
          accelerator: 'Command+,',
          click: () => actions.openSettings('general'),
        },
        { type: 'separator' },
        { role: 'hide', label: label('隐藏 ohmytoken', 'Hide ohmytoken') },
        { role: 'hideOthers', label: label('隐藏其他', 'Hide Others') },
        { role: 'unhide', label: label('显示全部', 'Show All') },
        { type: 'separator' },
        {
          label: label('退出 ohmytoken', 'Quit ohmytoken'),
          accelerator: 'Command+Q',
          click: actions.quit,
        },
      ],
    },
    {
      label: label('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: label('撤销', 'Undo') },
        { role: 'redo', label: label('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: label('剪切', 'Cut') },
        { role: 'copy', label: label('复制', 'Copy') },
        { role: 'paste', label: label('粘贴', 'Paste') },
        { role: 'selectAll', label: label('全选', 'Select All') },
      ],
    },
    {
      role: 'windowMenu',
      label: label('窗口', 'Window'),
      submenu: [
        { label: label('打开主窗口', 'Open Main Window'), click: actions.showMainWindow },
        {
          label: floatingVisible
            ? label('关闭小窗', 'Close Mini Window')
            : label('显示小窗', 'Show Mini Window'),
          click: actions.toggleFloatingWindow,
        },
        { type: 'separator' },
        { role: 'minimize', label: label('最小化', 'Minimize') },
        { role: 'close', label: label('关闭窗口', 'Close Window') },
        { role: 'front', label: label('前置全部窗口', 'Bring All to Front') },
      ],
    },
    {
      role: 'help',
      label: label('帮助', 'Help'),
      submenu: [
        { label: label('前往官网', 'Visit Official Website'), click: actions.openWebsite },
        {
          label: label('问题反馈', 'Send Feedback'),
          click: () => actions.openSettings('feedback'),
        },
      ],
    },
  ]
}
