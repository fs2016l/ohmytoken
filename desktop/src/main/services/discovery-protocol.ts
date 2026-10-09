import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import type { DiscoveryFonts } from './discovery-fonts'

export const DISCOVERY_CONTENT_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data: blob:",
  'font-src omt-discovery://fonts data:',
  'media-src https: blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join('; ')

/** Before ready; deliberately no CSP bypass or service workers. */
export function registerDiscoveryScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'omt-discovery',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: 'omt-model-icon',
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

interface Resources {
  font: () => Promise<DiscoveryFonts>
  resource: (release: string, path: string) => Promise<{ bytes: Buffer; contentType: string }>
}

export function discoveryProtocolHandler(
  resources: Resources,
): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      const url = new URL(request.url)
      if (
        !['GET', 'HEAD'].includes(request.method) ||
        url.search ||
        url.username ||
        url.password ||
        url.port
      )
        return new Response(null, { status: 403 })
      if (url.hostname === 'fonts') {
        const font = (await resources.font()).files.get(url.pathname.slice(1))
        if (!font) return new Response(null, { status: 404 })
        return new Response(
          request.method === 'HEAD' ? null : Uint8Array.from(await readFile(font)),
          {
            headers: {
              'Content-Type': 'font/woff2',
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Access-Control-Allow-Origin': '*',
              'X-Content-Type-Options': 'nosniff',
            },
          },
        )
      }
      const match = url.hostname === 'bundle' && /^\/([a-z0-9-]+)\/(.+)$/.exec(url.pathname)
      if (!match) return new Response(null, { status: 404 })
      const resource = await resources.resource(match[1], match[2])
      return new Response(request.method === 'HEAD' ? null : Uint8Array.from(resource.bytes), {
        headers: {
          'Content-Type': resource.contentType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Content-Security-Policy': DISCOVERY_CONTENT_POLICY,
          'Referrer-Policy': 'no-referrer',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
        },
      })
    } catch {
      return new Response('Discovery resource unavailable', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      })
    }
  }
}
