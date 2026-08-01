import { Buffer } from 'node:buffer'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = new URL('../src/renderer/src/', import.meta.url)
const outputUrl = new URL(
  '../src/renderer/src/assets/fonts/material-symbols-outlined-subset.woff2',
  import.meta.url,
)
const codepointsUrl =
  'https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints'
const headers = {
  Accept: 'text/css,*/*;q=0.1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
}

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const url = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(url)))
    } else if (['.css', '.ts', '.vue'].includes(extname(entry.name))) {
      files.push(url)
    }
  }

  return files
}

async function fetchOk(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

const codepoints = await (await fetchOk(codepointsUrl)).text()
const knownIcons = new Set(
  codepoints
    .split('\n')
    .map((line) => line.trim().match(/^([a-z][a-z0-9_]*)\s+[0-9a-f]+$/i)?.[1])
    .filter(Boolean),
)

const usedIcons = new Set()
for (const file of await collectSourceFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8')
  for (const [token] of source.matchAll(/\b[a-z][a-z0-9_]{1,}\b/g)) {
    if (knownIcons.has(token)) usedIcons.add(token)
  }
}

const icons = [...usedIcons].sort()
if (icons.length < 50) throw new Error(`Unexpectedly small Material Symbols set: ${icons.length}`)

const family = 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,400..600,0..1,0'
const cssUrl = `https://fonts.googleapis.com/css2?family=${family}&icon_names=${encodeURIComponent(icons.join(','))}&display=block`
const css = await (await fetchOk(cssUrl)).text()
const fontUrl = css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/)?.[0]
if (!fontUrl) throw new Error('Google Fonts response did not contain a font URL')

const bytes = Buffer.from(await (await fetchOk(fontUrl)).arrayBuffer())
if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2') {
  throw new Error(`Expected WOFF2, received ${bytes.subarray(0, 4).toString('hex')}`)
}

await writeFile(outputUrl, bytes)
console.log(`Generated ${fileURLToPath(outputUrl)} (${icons.length} icons, ${bytes.length} bytes)`)
