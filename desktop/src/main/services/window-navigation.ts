import type { WebContents } from 'electron'

interface WindowNavigationOptions {
  rendererUrl?: string
  openExternal: (url: string) => Promise<void>
  isAllowedFrame?: (url: string) => boolean
}

function isRendererUrl(url: string, rendererUrl?: string): boolean {
  try {
    const target = new URL(url)
    return rendererUrl ? target.origin === new URL(rendererUrl).origin : target.protocol === 'file:'
  } catch {
    return false
  }
}

/** Internal renderer addresses must never be handed to the system browser. */
export function getExternalWebUrl(url: string, rendererUrl?: string): string | null {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('只允许打开不含凭据的 HTTP(S) 外部链接')
  }
  return isRendererUrl(parsed.href, rendererUrl) ? null : parsed.href
}

export function registerWindowNavigation(
  webContents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
  { rendererUrl, openExternal, isAllowedFrame }: WindowNavigationOptions,
): void {
  function openExternalLink(url: string): void {
    let externalUrl: string | null
    try {
      externalUrl = getExternalWebUrl(url, rendererUrl)
    } catch {
      return
    }
    if (externalUrl) void openExternal(externalUrl)
  }

  webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url, rendererUrl)) return
    event.preventDefault()
    openExternalLink(url)
  })
  webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && !isAllowedFrame?.(event.url)) event.preventDefault()
  })
  webContents.setWindowOpenHandler(({ url }) => {
    // 中键 / Ctrl+点击也会请求新窗口，内部路由不能交给系统浏览器。
    openExternalLink(url)
    return { action: 'deny' }
  })
}
