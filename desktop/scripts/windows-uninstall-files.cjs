const { readdirSync, lstatSync, mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function validateRelativePath(value) {
  const parts = value.split('/')
  if (
    !value ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[\\:*?"<>|$]/.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    ) ||
    /^(replays|\.ohmytoken-installation)(?:\/|$)/i.test(value)
  ) {
    throw new Error(`Unsafe packaged uninstall path: ${value}`)
  }
  return value
}

function collectInstalledFiles(appOutDir) {
  const files = []
  function visit(directory, prefix) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = validateRelativePath(prefix + entry.name)
      const absolute = join(directory, entry.name)
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) {
        throw new Error(`Packaged uninstall paths cannot contain links: ${relative}`)
      }
      if (entry.isDirectory()) visit(absolute, relative + '/')
      else if (entry.isFile()) files.push(relative)
      else throw new Error(`Unsupported packaged uninstall entry: ${relative}`)
    }
  }
  visit(appOutDir, '')
  return files.sort()
}

function renderUninstallInclude(files, { version, productFilename }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid uninstall version')
  validateRelativePath(productFilename)
  const installed = new Set(files.map(validateRelativePath))
  // NSIS adds these after afterPack, or customInstall creates them at install time.
  installed.add('resources/elevate.exe')
  installed.add('resources/installation-language')
  installed.add(`Uninstall ${productFilename}.exe`)
  installed.add('uninstallerIcon.ico')
  const ordered = [...installed].sort()
  const folded = new Set()
  for (const file of ordered) {
    const key = file.toLowerCase()
    if (folded.has(key)) throw new Error(`Case-colliding uninstall path: ${file}`)
    folded.add(key)
  }
  const directories = new Set()
  for (const file of ordered) {
    const parts = file.split('/')
    while (parts.length > 1) {
      parts.pop()
      directories.add(parts.join('/'))
    }
  }
  const windows = (value) => value.replaceAll('/', '\\')
  const lines = [
    '; Generated from the packaged application. Never read deletion paths from the install directory.',
    `!if "\${VERSION}" != "${version}"`,
    '  !error "The uninstall file list belongs to another version. Rebuild the Windows package."',
    '!endif',
    '!macro AgentPreflightInstalledFiles',
    '  ; Preflight every path before removing any file; fail closed on directory junctions.',
    ...ordered.map((file) => `  !insertmacro AgentCheckInstalledFile "${windows(file)}"`),
    '  !insertmacro AgentCheckInstalledFile ".ohmytoken-installation"',
    '!macroend',
    '!macro AgentRemoveInstalledFiles',
    '  !insertmacro AgentPreflightInstalledFiles',
    ...ordered.map((file) => `  !insertmacro AgentDeleteInstalledFile "${windows(file)}"`),
    ...[...directories]
      .sort((a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b, 'en'))
      .map((directory) => `  !insertmacro AgentRemoveInstalledDirectory "${windows(directory)}"`),
    '  !insertmacro AgentRemoveInstallationRoot',
    '!macroend',
    '',
  ]
  return lines.join('\n')
}

function writeUninstallInclude(context) {
  if (context.electronPlatformName !== 'win32') return
  if (context.arch !== 1) throw new Error('The safe Windows installer currently supports x64 only')
  const { packager } = context
  const directory = packager.info.buildResourcesDir
  mkdirSync(directory, { recursive: true })
  const script = renderUninstallInclude(collectInstalledFiles(context.appOutDir), {
    version: packager.appInfo.version,
    productFilename: packager.appInfo.productFilename,
  })
  writeFileSync(join(directory, 'windows-uninstall-files.nsh'), script)
}

module.exports = { collectInstalledFiles, renderUninstallInclude, writeUninstallInclude }
