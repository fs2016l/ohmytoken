import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const outputUrl = new URL(
  '../src/renderer/src/assets/fonts/material-symbols-outlined.woff2',
  import.meta.url,
)
const headers = {
  Accept: 'text/css,*/*;q=0.1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
}

async function fetchOk(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

const family = 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0'
const cssUrl = `https://fonts.googleapis.com/css2?family=${family}&display=block`
const css = await (await fetchOk(cssUrl)).text()
const fontUrl = css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/)?.[0]
if (!fontUrl) throw new Error('Google Fonts response did not contain a font URL')

const bytes = Buffer.from(await (await fetchOk(fontUrl)).arrayBuffer())
if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2') {
  throw new Error(`Expected WOFF2, received ${bytes.subarray(0, 4).toString('hex')}`)
}

await writeFile(outputUrl, bytes)
console.log(
  `Downloaded complete Material Symbols font to ${fileURLToPath(outputUrl)} (${bytes.length} bytes)`,
)
