import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import type { UpdateAsset } from '../../shared/updater'
import { validateUpdateAsset } from './resumable-update-download'

/** Keep electron-updater's native signature verification and installation through its public API. */
export async function startUpdateInstallerBridge(
  asset: UpdateAsset,
  path: string,
): Promise<{
  feedUrl: string
  close(): Promise<void>
}> {
  validateUpdateAsset(asset)
  const prefix = '/' + randomBytes(32).toString('hex') + '/'
  const filePath = prefix + asset.fileName
  const manifest = Buffer.from(
    JSON.stringify({
      version: asset.version,
      files: [{ url: asset.fileName, sha512: asset.sha512, size: asset.size }],
      path: asset.fileName,
      sha512: asset.sha512,
      releaseDate: asset.releaseDate,
      releaseNotes: asset.releaseNotes,
    }),
  )
  let authority = ''
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.headers.host !== authority || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(403).end()
      return
    }
    const pathname = (request.url ?? '').split('?')[0]
    if ([prefix + 'latest.yml', prefix + 'latest-mac.yml'].includes(pathname)) {
      response.writeHead(200, {
        'Content-Type': 'application/yaml',
        'Content-Length': manifest.length,
      })
      response.end(request.method === 'HEAD' ? undefined : manifest)
      return
    }
    if (pathname !== filePath) {
      response.writeHead(404).end()
      return
    }
    let start = 0
    let end = asset.size - 1
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range)
      if (
        !range ||
        Number(range[1]) >= asset.size ||
        (range[2] && (Number(range[2]) < Number(range[1]) || Number(range[2]) >= asset.size))
      ) {
        response.writeHead(416, { 'Content-Range': `bytes */${asset.size}` }).end()
        return
      }
      start = Number(range[1])
      end = range[2] ? Number(range[2]) : end
      response.setHeader('Content-Range', `bytes ${start}-${end}/${asset.size}`)
    }
    response.writeHead(request.headers.range ? 206 : 200, {
      'Content-Type': 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    const stream = createReadStream(path, { start, end })
    stream.on('error', () => response.destroy())
    response.on('close', () => stream.destroy())
    stream.pipe(response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to start installer bridge')
  authority = `127.0.0.1:${address.port}`
  return {
    feedUrl: `http://${authority}${prefix}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}
