const { createHash } = require('node:crypto')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function prepareWindowsShortcutIcon(context) {
  if (context.electronPlatformName !== 'win32' || context.arch !== 1) return

  const version = context.packager.appInfo.version
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid Windows shortcut icon version')
  const directory = join(context.appOutDir, 'resources', 'brand')
  const icon = readFileSync(join(directory, 'app-icon.ico'))
  const hash = createHash('sha256').update(icon).digest('hex')
  const filename = `app-icon-${hash}.ico`
  const relative = `resources\\brand\\${filename}`
  writeFileSync(join(directory, filename), icon)

  const buildResources = context.packager.info.buildResourcesDir
  mkdirSync(buildResources, { recursive: true })
  writeFileSync(
    join(buildResources, 'windows-shortcut-icon.nsh'),
    [
      '; Generated from the packaged brand icon. Its content hash gives Windows a fresh icon path.',
      `!if "\${VERSION}" != "${version}"`,
      '  !error "The shortcut icon belongs to another version. Rebuild the Windows package."',
      '!endif',
      `!define AGENT_SHORTCUT_ICON_SHA256 "${hash}"`,
      `!define AGENT_SHORTCUT_ICON_RELATIVE "${relative}"`,
      '',
    ].join('\n'),
  )

  return { relative, hash }
}

module.exports = { prepareWindowsShortcutIcon }
