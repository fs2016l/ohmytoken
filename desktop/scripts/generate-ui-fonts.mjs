import { Buffer } from 'node:buffer'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const fontRoot = new URL('../src/renderer/src/assets/fonts/ui/', import.meta.url)
const licenseRoot = new URL('../third-party-licenses/', import.meta.url)
const notoRoot = new URL('noto-sans-sc/', fontRoot)
const headers = {
  Accept: 'text/css,application/octet-stream,*/*;q=0.1',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
}

const IBM_PLEX_SHA = '2f9ba1b25957d958db71a849e85d72e3ecfb845a'
const SOURCE_CODE_PRO_SHA = '803b7e23ec97ae58b6232ea76519a76d428ba268'

function rawGitHub(owner, repo, ref, path) {
  return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`
}

const fontFiles = [
  {
    output: 'inter/InterVariable.woff2',
    url: rawGitHub('rsms', 'inter', 'v4.1', 'docs/font-files/InterVariable.woff2'),
    expectedBytes: 352_240,
  },
  {
    output: 'inter/InterVariable-Italic.woff2',
    url: rawGitHub('rsms', 'inter', 'v4.1', 'docs/font-files/InterVariable-Italic.woff2'),
    expectedBytes: 387_976,
  },
  ...[
    ['Regular', 92_164],
    ['Medium', 93_824],
    ['SemiBold', 94_472],
  ].map(([weight, expectedBytes]) => ({
    output: `jetbrains-mono/JetBrainsMono-${weight}.woff2`,
    url: rawGitHub(
      'JetBrains',
      'JetBrainsMono',
      'v2.304',
      `fonts/webfonts/JetBrainsMono-${weight}.woff2`,
    ),
    expectedBytes,
  })),
  ...[
    ['Regular', 63_020],
    ['Medium', 66_740],
    ['SemiBold', 67_060],
    ['Italic', 67_220],
    ['MediumItalic', 71_204],
    ['SemiBoldItalic', 70_664],
  ].map(([weight, expectedBytes]) => ({
    output: `ibm-plex-sans/IBMPlexSans-${weight}.woff2`,
    url: rawGitHub(
      'IBM',
      'plex',
      IBM_PLEX_SHA,
      `packages/plex-sans/fonts/complete/woff2/IBMPlexSans-${weight}.woff2`,
    ),
    expectedBytes,
  })),
  ...[
    ['Regular', 49_248],
    ['Medium', 50_400],
    ['SemiBold', 50_600],
  ].map(([weight, expectedBytes]) => ({
    output: `ibm-plex-mono/IBMPlexMono-${weight}.woff2`,
    url: rawGitHub(
      'IBM',
      'plex',
      IBM_PLEX_SHA,
      `packages/plex-mono/fonts/complete/woff2/IBMPlexMono-${weight}.woff2`,
    ),
    expectedBytes,
  })),
  {
    output: 'source/source-sans-3-upright.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-sans',
      '3.052R',
      'WOFF2/VF/SourceSans3VF-Upright.otf.woff2',
    ),
    expectedBytes: 164_736,
  },
  {
    output: 'source/source-sans-3-italic.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-sans',
      '3.052R',
      'WOFF2/VF/SourceSans3VF-Italic.otf.woff2',
    ),
    expectedBytes: 132_332,
  },
  {
    output: 'source/source-han-sans-cn.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-han-sans',
      '2.005R',
      'Variable/WOFF2/TTF/Subset/SourceHanSansCN-VF.ttf.woff2',
    ),
    expectedBytes: 7_711_988,
  },
  {
    output: 'source/source-han-serif-cn.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-han-serif',
      '2.003R',
      'Variable/WOFF2/TTF/Subset/SourceHanSerifCN-VF.ttf.woff2',
    ),
    expectedBytes: 11_035_128,
  },
  {
    output: 'source/source-serif-4-roman.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-serif',
      '4.005R',
      'WOFF2/VAR/SourceSerif4Variable-Roman.otf.woff2',
    ),
    expectedBytes: 426_716,
  },
  {
    output: 'source/source-code-pro-upright.woff2',
    url: rawGitHub(
      'adobe-fonts',
      'source-code-pro',
      SOURCE_CODE_PRO_SHA,
      'WOFF2/VF/SourceCodeVF-Upright.otf.woff2',
    ),
    expectedBytes: 89_520,
  },
]

const licenseFiles = [
  {
    output: 'inter-OFL.txt',
    url: rawGitHub('rsms', 'inter', 'v4.1', 'LICENSE.txt'),
  },
  {
    output: 'jetbrains-mono-OFL.txt',
    url: rawGitHub('JetBrains', 'JetBrainsMono', 'v2.304', 'OFL.txt'),
  },
  {
    output: 'ibm-plex-OFL.txt',
    url: rawGitHub('IBM', 'plex', IBM_PLEX_SHA, 'LICENSE.txt'),
  },
  {
    output: 'noto-sans-sc-OFL.txt',
    url: rawGitHub('google', 'fonts', 'main', 'ofl/notosanssc/OFL.txt'),
  },
  {
    output: 'source-han-sans-OFL.txt',
    url: rawGitHub('adobe-fonts', 'source-han-sans', '2.005R', 'LICENSE.txt'),
  },
  {
    output: 'source-han-serif-OFL.txt',
    url: rawGitHub('adobe-fonts', 'source-han-serif', '2.003R', 'LICENSE.txt'),
  },
  {
    output: 'source-sans-3-OFL.md',
    url: rawGitHub('adobe-fonts', 'source-sans', '3.052R', 'LICENSE.md'),
  },
  {
    output: 'source-serif-4-OFL.md',
    url: rawGitHub('adobe-fonts', 'source-serif', '4.005R', 'LICENSE.md'),
  },
  {
    output: 'source-code-pro-OFL.md',
    url: rawGitHub('adobe-fonts', 'source-code-pro', SOURCE_CODE_PRO_SHA, 'LICENSE.md'),
  },
]

async function fetchOk(url) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`)
  return response
}

async function fetchBytes(url) {
  return Buffer.from(await (await fetchOk(url)).arrayBuffer())
}

function assertWoff2(bytes, source) {
  if (bytes.subarray(0, 4).toString('ascii') !== 'wOF2') {
    throw new Error(
      `Expected WOFF2 from ${source}, received ${bytes.subarray(0, 4).toString('hex')}`,
    )
  }
}

async function writeDownload(root, file, validateFont = false) {
  const bytes = await fetchBytes(file.url)
  if (file.expectedBytes && bytes.length !== file.expectedBytes) {
    throw new Error(
      `Unexpected size for ${file.output}: ${bytes.length} (expected ${file.expectedBytes})`,
    )
  }
  if (validateFont) assertWoff2(bytes, file.url)

  const destination = new URL(file.output, root)
  await mkdir(new URL('./', destination), { recursive: true })
  await writeFile(destination, bytes)
  return { output: file.output, bytes: bytes.length, source: file.url }
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

async function downloadNotoSansSc() {
  const cssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap'
  const css = await (await fetchOk(cssUrl)).text()
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)\s]+/g) ?? [])]
  if (urls.length < 50) throw new Error(`Unexpected Noto Sans SC shard count: ${urls.length}`)

  const names = new Map(
    urls.map((url, index) => [url, `noto-sans-sc-${String(index).padStart(3, '0')}.woff2`]),
  )
  const files = await mapLimit(urls, 8, async (url) => {
    const bytes = await fetchBytes(url)
    assertWoff2(bytes, url)
    const output = names.get(url)
    await writeFile(new URL(output, notoRoot), bytes)
    return { output: `noto-sans-sc/${output}`, bytes: bytes.length, source: url }
  })

  const total = files.reduce((sum, file) => sum + file.bytes, 0)
  if (total < 3_000_000) throw new Error(`Unexpected Noto Sans SC total size: ${total}`)

  let localCss = css.replaceAll("font-family: 'Noto Sans SC'", "font-family: 'OMT Noto Sans SC'")
  for (const [url, name] of names) localCss = localCss.replaceAll(url, `./${name}`)
  await writeFile(
    new URL('font.css', notoRoot),
    `/* Generated by scripts/generate-ui-fonts.mjs from ${cssUrl}. */\n${localCss}`,
    'utf8',
  )
  return files
}

const resolvedRoot = fileURLToPath(fontRoot)
if (!/[\\/]assets[\\/]fonts[\\/]ui[\\/]?$/.test(resolvedRoot)) {
  throw new Error(`Refusing to replace unexpected font directory: ${resolvedRoot}`)
}

await rm(fontRoot, { recursive: true, force: true })
await mkdir(notoRoot, { recursive: true })
await mkdir(licenseRoot, { recursive: true })

const directFonts = await mapLimit(fontFiles, 6, (file) => writeDownload(fontRoot, file, true))
const notoFonts = await downloadNotoSansSc()
await mapLimit(licenseFiles, 6, (file) => writeDownload(licenseRoot, file))

const manifest = {
  scope: 'Simplified Chinese and English UI font bundle',
  files: [...directFonts, ...notoFonts],
  totalBytes: [...directFonts, ...notoFonts].reduce((sum, file) => sum + file.bytes, 0),
}
await writeFile(new URL('font-manifest.json', fontRoot), `${JSON.stringify(manifest, null, 2)}\n`)

console.log(
  `Generated ${manifest.files.length} font files in ${resolvedRoot} (${manifest.totalBytes} bytes)`,
)
