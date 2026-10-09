/** 只输出连接状态，不把请求头、认证信息或底层堆栈带到界面。 */
export function remoteUnavailableMessage(apiBase: string, error: unknown): string {
  const url = new URL(apiBase)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  const detail = error instanceof Error ? error : null
  const code = (detail?.cause as { code?: string } | undefined)?.code
  if (detail?.name === 'AbortError' || detail?.name === 'TimeoutError') {
    return '配套服务连接超时，本地扫描与统计仍可使用'
  }
  if (detail?.message === 'fetch failed' || code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return local
      ? `本机配套服务未连接（${url.host}），请启动 Cloud 服务；本地扫描与统计仍可使用`
      : '暂时无法连接配套服务，请检查网络；本地扫描与统计仍可使用'
  }
  return '配套服务暂不可用，本地扫描与统计仍可使用'
}
