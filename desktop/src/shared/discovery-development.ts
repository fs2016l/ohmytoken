interface DevelopmentContext {
  packaged: boolean
  rendererUrl?: string
  apiBase: string
  override?: string
}

/** Local source development uses the companion Cloud UI server; releases always use com. */
export function resolveDiscoveryDevelopmentUrl(context: DevelopmentContext): string | null {
  if (context.packaged) return null
  let input = context.override
  if (!input && context.rendererUrl) {
    const api = new URL(context.apiBase)
    if (api.protocol === 'http:' && isLoopback(api.hostname)) input = 'http://127.0.0.1:5175/'
  }
  if (!input) return null
  const url = new URL(input)
  if (
    url.protocol !== 'http:' ||
    !isLoopback(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Discovery development URL must be a loopback HTTP page')
  return url.href
}

function isLoopback(host: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(host)
}
