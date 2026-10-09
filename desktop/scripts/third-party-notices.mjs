import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const bundledRoots = [
  '@vuepic/vue-datepicker',
  'axios',
  'date-fns',
  'echarts',
  'vue',
  'vue-echarts',
  'gifenc',
  'mediabunny',
]
const hash = (value) => createHash('sha256').update(value).digest('hex')
const json = (file) => JSON.parse(readFileSync(file, 'utf8'))
const safeUrl = (value) => {
  if (!value) return ''
  const url = String(value)
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '')
  return /^https?:\/\//.test(url)
    ? url
    : /^[\w.-]+\/[\w.-]+$/.test(url)
      ? `https://github.com/${url}`
      : ''
}

export function findPackage(name, from, root) {
  let current = from
  for (;;) {
    const folder = join(current, 'node_modules', name)
    if (existsSync(join(folder, 'package.json'))) return folder
    if (current === root || dirname(current) === current) return null
    current = dirname(current)
  }
}

function legalFiles(folder, nested = false) {
  return readdirSync(folder, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.isFile() && (nested || /^(licen[cs]e|notice|copying|copyright)/i.test(entry.name)))
        return [entry.name]
      if (entry.isDirectory() && /^(licen[cs]es?|notices?)$/i.test(entry.name))
        return legalFiles(join(folder, entry.name), true).map((file) => `${entry.name}/${file}`)
      return []
    })
    .sort()
}

export function buildNotices(root = projectRoot) {
  const pkg = json(join(root, 'package.json'))
  const lockBytes = readFileSync(join(root, 'package-lock.json'))
  const lock = JSON.parse(lockBytes)
  const base = join(root, 'third-party-licenses')
  const documents = new Map()
  const entries = []
  const seen = new Set()
  const doc = (name, text, source = '') => {
    if (!text.trim()) throw new Error(`Empty license: ${name}`)
    const digest = hash(text)
    const file = `documents/${digest}.txt`
    documents.set(file, text)
    return { name, file, sha256: digest, source }
  }
  function visit(name, from = root, optional = false) {
    const folder = findPackage(name, from, root)
    if (!folder) {
      if (optional) return
      throw new Error(`Missing installed dependency: ${name}`)
    }
    if (seen.has(folder)) return
    seen.add(folder)
    const data = json(join(folder, 'package.json'))
    const lockKey = relative(root, folder).replaceAll('\\', '/')
    const locked = lock.packages[lockKey]
    if (!locked || locked.version !== data.version)
      throw new Error(`Lockfile/installation mismatch: ${data.name}@${data.version}`)
    if (!data.license || typeof data.license !== 'string')
      throw new Error(`Review missing license declaration: ${data.name}@${data.version}`)
    const id = `${data.name}@${data.version}`
    const source = safeUrl(locked.resolved)
    const files = legalFiles(folder).map((file) =>
      doc(file, readFileSync(join(folder, file), 'utf8'), source),
    )
    if (!files.length) {
      const override = {
        '@vue/devtools-api@6.6.4': [
          'vue-devtools-api-6.6.4-LICENSE.txt',
          'https://raw.githubusercontent.com/vuejs/vue-devtools/df6ab6bb7791a7a525a97990de73b3ea5e9a1941/LICENSE',
        ],
        'lazy-val@1.0.5': [
          'lazy-val-1.0.5-NOTICE.txt',
          'https://registry.npmjs.org/lazy-val/1.0.5',
        ],
      }[id]
      if (override)
        files.push(
          doc(override[0], readFileSync(join(base, 'overrides', override[0]), 'utf8'), override[1]),
        )
      else {
        const readme = readdirSync(folder).find((file) => /^readme\.md$/i.test(file))
        const text = readme ? readFileSync(join(folder, readme), 'utf8') : ''
        const match = /(?:^|\n)(?:#+\s*License\s*|License\s*\n[-=]+)[\s\S]*$/i.exec(text)
        if (!match || !match[0].includes('Permission is hereby granted'))
          throw new Error(`Review missing license text: ${id}`)
        files.push(doc(`${readme} — License`, match[0].trim(), source))
      }
    }
    for (const [expected, extra] of [
      ['gifenc@1.0.3', 'gifenc-NOTICE.txt'],
      ['mediabunny@1.58.0', 'mediabunny-NOTICE.txt'],
    ]) {
      if (data.name === expected.split('@')[0] && id !== expected)
        throw new Error(`Review export notices for upgraded ${id}`)
      if (id === expected) files.push(doc(extra, readFileSync(join(base, extra), 'utf8'), source))
    }
    entries.push({
      id,
      name: data.name,
      version: data.version,
      license: data.license,
      category: 'package',
      project: safeUrl(data.homepage || data.repository?.url || data.repository),
      source,
      packagePath: lockKey,
      documents: files,
    })
    const optionalDeps = data.optionalDependencies || {}
    for (const dep of Object.keys({ ...data.dependencies, ...optionalDeps }).sort())
      visit(dep, folder, Object.hasOwn(optionalDeps, dep))
    for (const peer of Object.keys(data.peerDependencies || {}).sort()) {
      // Electron's binary is handled separately; its npm downloader and Vue's
      // optional TypeScript tooling are not redistributed runtime libraries.
      if (
        peer === 'electron' ||
        (peer === 'typescript' && data.peerDependenciesMeta?.[peer]?.optional)
      )
        continue
      if (findPackage(peer, folder, root)) visit(peer, folder)
      else if (!data.peerDependenciesMeta?.[peer]?.optional)
        throw new Error(`Missing runtime peer: ${id} → ${peer}`)
    }
  }
  for (const name of [...Object.keys(pkg.dependencies), ...bundledRoots].sort()) visit(name)

  const fonts = [
    ['Inter', '4.1', 'inter-OFL.txt', 'https://github.com/rsms/inter'],
    [
      'JetBrains Mono',
      '2.304',
      'jetbrains-mono-OFL.txt',
      'https://github.com/JetBrains/JetBrainsMono',
    ],
    [
      'IBM Plex',
      '2f9ba1b25957d958db71a849e85d72e3ecfb845a',
      'ibm-plex-OFL.txt',
      'https://github.com/IBM/plex',
    ],
    [
      'Noto Sans SC',
      'bundled subset',
      'noto-sans-sc-OFL.txt',
      'https://github.com/google/fonts/tree/main/ofl/notosanssc',
    ],
    [
      'Source Han Sans',
      '2.005R',
      'source-han-sans-OFL.txt',
      'https://github.com/adobe-fonts/source-han-sans',
    ],
    [
      'Source Han Serif',
      '2.003R',
      'source-han-serif-OFL.txt',
      'https://github.com/adobe-fonts/source-han-serif',
    ],
    [
      'Source Sans 3',
      '3.052R',
      'source-sans-3-OFL.md',
      'https://github.com/adobe-fonts/source-sans',
    ],
    [
      'Source Serif 4',
      '4.005R',
      'source-serif-4-OFL.md',
      'https://github.com/adobe-fonts/source-serif',
    ],
    [
      'Source Code Pro',
      '803b7e23ec97ae58b6232ea76519a76d428ba268',
      'source-code-pro-OFL.md',
      'https://github.com/adobe-fonts/source-code-pro',
    ],
    [
      'Material Symbols',
      'bundled font',
      'material-symbols-Apache-2.0.txt',
      'https://github.com/google/material-design-icons',
    ],
  ]
  for (const [name, version, file, project] of fonts)
    entries.push({
      id: `font:${name}`,
      name,
      version,
      license: file.includes('Apache') ? 'Apache-2.0' : 'OFL-1.1',
      category: 'font',
      project,
      source: project,
      documents: [doc(file, readFileSync(join(base, file), 'utf8'), project)],
    })

  const electronFolder = findPackage('electron', root, root)
  const electron = json(join(electronFolder, 'package.json'))
  if (electron.version !== lock.packages['node_modules/electron']?.version)
    throw new Error('Electron version mismatch')
  const chromium = readFileSync(join(electronFolder, 'dist/LICENSES.chromium.html'))
  entries.push({
    id: `electron@${electron.version}`,
    name: 'Electron',
    version: electron.version,
    license: 'MIT',
    category: 'runtime',
    project: 'https://www.electronjs.org',
    source: `https://github.com/electron/electron/tree/v${electron.version}`,
    documents: [doc('LICENSE', readFileSync(join(electronFolder, 'dist/LICENSE'), 'utf8'))],
  })
  entries.push({
    id: 'chromium',
    name: 'Chromium / Node.js and runtime components',
    version: `Electron ${electron.version}`,
    license: 'Multiple licenses',
    category: 'runtime',
    project: 'https://www.electronjs.org',
    source: `https://github.com/electron/electron/releases/tag/v${electron.version}`,
    documents: [],
    external: 'chromium',
  })
  const sqlite = readFileSync(
    join(root, 'node_modules/better-sqlite3/deps/sqlite3/sqlite3.c'),
    'utf8',
  )
  const sqliteVersion = /#define SQLITE_VERSION\s+"([^"]+)"/.exec(sqlite)?.[1]
  const sqliteNotice = /\/\*\s*\n\*\*[^]*?The author disclaims[^]*?\*\//.exec(sqlite)?.[0]
  if (!sqliteVersion || !sqliteNotice) throw new Error('Review SQLite source notice')
  entries.push({
    id: `sqlite@${sqliteVersion}`,
    name: 'SQLite',
    version: sqliteVersion,
    license: 'Public domain',
    category: 'runtime',
    project: 'https://sqlite.org',
    source: 'https://sqlite.org/copyright.html',
    documents: [doc('SQLite source header', sqliteNotice)],
  })
  entries.sort(
    (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
  )
  const fontAssets = {}
  const fontRoot = join(root, 'src/renderer/src/assets/fonts')
  function scanFonts(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, 'en'),
    )) {
      const file = join(directory, item.name)
      if (item.isDirectory()) scanFonts(file)
      else if (/\.(woff2?|ttf|otf)$/i.test(item.name)) {
        const name = relative(fontRoot, file).replaceAll('\\', '/')
        if (
          !/^(material-symbols-outlined\.woff2|ui\/(inter|jetbrains-mono|ibm-plex-(sans|mono)|noto-sans-sc)\/|ui\/source\/source-(sans-3|serif-4|han-sans|han-serif|code-pro)-)/.test(
            name,
          )
        )
          throw new Error(`Review license for new font: ${name}`)
        fontAssets[name] = hash(readFileSync(file))
      }
    }
  }
  scanFonts(fontRoot)
  const uniqueEntries = []
  for (const entry of entries) {
    const previous = uniqueEntries.find((item) => item.id === entry.id)
    if (previous) {
      if (previous.license !== entry.license)
        throw new Error(`Conflicting license declarations: ${entry.id}`)
      for (const document of entry.documents)
        if (
          !previous.documents.some(
            (item) => item.file === document.file && item.name === document.name,
          )
        )
          previous.documents.push(document)
    } else uniqueEntries.push(entry)
  }
  const catalogue = {
    schemaVersion: 1,
    applicationVersion: pkg.version,
    lockfileSha256: hash(lockBytes),
    fontAssets,
    entries: uniqueEntries,
  }
  const markdown =
    '# Third-party software notices / 第三方开源软件声明\n\n' +
    '本文件覆盖生产依赖树、显式配置的前端与导出依赖树、字体、图标字体及 Electron 运行时；依赖树中部分文件会被构建裁剪。构建工具本身不因参与编译而被列为运行时组件。完整版权、许可及 NOTICE 原文见对应文件。\n\n' +
    'This inventory covers production dependency trees, configured renderer/export dependency trees, fonts, icon fonts, and the Electron runtime. Some portions of these dependency trees may be removed during bundling. Original copyright, license and NOTICE texts are preserved below. Third-party terms are independent of the application license.\n\n' +
    'Mediabunny source is available at the exact version archive linked below, under MPL-2.0. Its original source is unmodified. gifenc uses only its encoder and palette mapping; the PnnQuant-derived quantizer must not enter the output. See the component notices for details.\n\n' +
    'Chromium、Node.js 及运行时内嵌组件的完整原文随安装包提供于 `runtime/LICENSES.chromium.html`，应用内“开源软件声明”也可打开该文件。源仓可在安装依赖后查看 `node_modules/electron/dist/LICENSES.chromium.html`。\n\n' +
    '| Component | Version | License | Source | License / NOTICE |\n| --- | --- | --- | --- | --- |\n' +
    uniqueEntries
      .map(
        (entry) =>
          `| ${entry.name} | ${entry.version} | ${entry.license} | ${entry.source ? `[source](${entry.source})` : '—'} | ${entry.documents.map((d) => `[${d.name.replaceAll('|', '\\|')}](generated/${d.file})`).join(', ') || 'runtime/LICENSES.chromium.html'} |`,
      )
      .join('\n') +
    '\n'
  return { catalogue, documents, markdown, chromiumSha256: hash(chromium) }
}

export function writeOrCheckNotices({ root = projectRoot, check = false } = {}) {
  const result = buildNotices(root)
  const outputs = new Map([
    ['generated/catalogue.json', JSON.stringify(result.catalogue, null, 2) + '\n'],
    ['THIRD_PARTY_NOTICES.md', result.markdown],
    ...[...result.documents].map(([file, text]) => [`generated/${file}`, text]),
  ])
  for (const [file, text] of outputs) {
    const target = join(root, 'third-party-licenses', file)
    if (check) {
      if (!existsSync(target) || readFileSync(target, 'utf8') !== text)
        throw new Error(
          `Third-party notices are missing or stale: ${file}. Run npm run licenses:generate and review the changes.`,
        )
    } else {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text)
    }
  }
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = writeOrCheckNotices({ check: process.argv.includes('--check') })
  console.log(
    `Third-party notices verified: ${result.catalogue.entries.length} components, ${result.documents.size} original documents.`,
  )
}
