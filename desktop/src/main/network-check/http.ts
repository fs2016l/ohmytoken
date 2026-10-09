import { net, session, type Session } from 'electron'
import type { NetworkMode } from '../../shared/network-check'
import { allowedNetworkUrl, connectionIssue, safeDestination } from './policy'
import type { NetworkFetcher, ProbeResponse } from './protocol'

const REQUEST_TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 4 * 1024 * 1024

async function proxyRoute(ses: Session, url: string): Promise<ProbeResponse['route']> {
  let timer: NodeJS.Timeout | undefined
  try {
    const resolved = await Promise.race([
      ses.resolveProxy(url),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(''), 1500)
      }),
    ])
    if (!resolved) return 'unknown'
    return resolved.trim() === 'DIRECT' ? 'direct' : 'proxy'
  } catch {
    return 'unknown'
  } finally {
    clearTimeout(timer)
  }
}

// 独立内存 session，不复用登录会话，也不修改应用的默认代理。
export async function createNetworkFetcher(mode: NetworkMode): Promise<NetworkFetcher> {
  const ses = session.fromPartition(`network-check-${mode}`, { cache: false })
  await ses.setProxy({ mode: mode === 'direct' ? 'direct' : 'system' })
  await ses.closeAllConnections()
  return async (url, signal) => {
    const startedAt = Date.now()
    const route = await proxyRoute(ses, url)
    const base: ProbeResponse = {
      url,
      destination: safeDestination(url),
      statusCode: null,
      headers: {},
      body: '',
      truncated: false,
      redirectStopped: false,
      elapsedMs: 0,
      route,
      issue: null,
    }
    if (!allowedNetworkUrl(url)) return { ...base, issue: 'unavailable' }
    if (signal.aborted) return { ...base, issue: connectionIssue('', signal) }
    return new Promise<ProbeResponse>((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | undefined
      let request: ReturnType<typeof net.request> | undefined
      const finish = (result: Partial<ProbeResponse>): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve({ ...base, ...result, elapsedMs: Date.now() - startedAt })
      }
      const onAbort = (): void => {
        finish({ issue: connectionIssue('', signal) })
        request?.abort()
      }
      try {
        request = net.request({
          url,
          session: ses,
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: {
            Accept: 'application/json,text/html;q=0.9,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
        })
        let redirects = 0
        request.on('redirect', (statusCode, _method, target, headers) => {
          base.destination = safeDestination(target)
          if (
            !allowedNetworkUrl(target) ||
            ++redirects > 5 ||
            /\/app-unavailable-in-region(?:\/|$)/i.test(new URL(target).pathname)
          ) {
            finish({
              statusCode,
              redirectStopped: true,
              headers: { location: headers.location?.[0] ?? '' },
            })
            request?.abort()
          } else {
            request?.followRedirect()
          }
        })
        request.once('error', (error) => finish({ issue: connectionIssue(error, signal) }))
        request.once('response', (response) => {
          const chunks: Buffer[] = []
          let length = 0
          base.statusCode = response.statusCode
          for (const name of ['content-type', 'cf-mitigated', 'retry-after']) {
            const value = response.headers[name]
            if (value) base.headers[name] = Array.isArray(value) ? value.join(', ') : value
          }
          if (response.statusCode === 407) {
            finish({ issue: 'proxy_auth' })
            request?.abort()
            return
          }
          response.on('data', (chunk: Buffer) => {
            const bytes = Buffer.from(chunk)
            const remaining = MAX_BODY_BYTES - length
            chunks.push(bytes.subarray(0, remaining))
            length += Math.min(bytes.length, remaining)
            if (bytes.length > remaining) {
              finish({ body: Buffer.concat(chunks).toString('utf8'), truncated: true })
              request?.abort()
            }
          })
          response.once('end', () => finish({ body: Buffer.concat(chunks).toString('utf8') }))
          response.once('error', (error) => finish({ issue: connectionIssue(error, signal) }))
          response.once('aborted', () => finish({ issue: connectionIssue('', signal) }))
        })
        timer = setTimeout(() => {
          finish({ issue: 'timeout' })
          request?.abort()
        }, REQUEST_TIMEOUT_MS)
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) onAbort()
        else request.end()
      } catch (error) {
        finish({ issue: connectionIssue(error, signal) })
        request?.abort()
      }
    })
  }
}
