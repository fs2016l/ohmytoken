interface IdleWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  destroy(): void
}

export function releaseHiddenWindow(
  window: IdleWindow,
  canRelease: () => Promise<boolean>,
  beforeRelease: () => void,
  delay = 5_000,
  retryDelay = 30_000,
  checkTimeout = 2_000,
): () => void {
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const hidden = (): boolean => !cancelled && !window.isDestroyed() && !window.isVisible()
  function schedule(wait: number): void {
    timer = setTimeout(check, wait)
    timer.unref()
  }
  function check(): void {
    void (async () => {
      if (!hidden()) return
      try {
        const allowed = await Promise.race([
          canRelease(),
          new Promise<boolean>((resolve) => {
            deadline = setTimeout(() => resolve(false), checkTimeout)
            deadline.unref()
          }),
        ])
        if (!allowed || !hidden()) return
        beforeRelease()
        window.destroy()
      } catch {
        /* 无法确认页面状态时保留窗口。 */
      } finally {
        clearTimeout(deadline)
        if (hidden()) schedule(retryDelay)
      }
    })()
  }
  schedule(delay)
  return () => {
    cancelled = true
    clearTimeout(timer)
    clearTimeout(deadline)
  }
}

// 只有业务表单明确标记的草稿或提交任务会阻止释放，筛选条件不属于未保存内容。
export const MAIN_WINDOW_RELEASE_CHECK = `document.querySelector('[data-window-retain="true"]') === null`
