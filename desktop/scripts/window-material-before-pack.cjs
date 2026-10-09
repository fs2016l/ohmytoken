const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const process = require('node:process')
module.exports = async function beforePack(context) {
  await require('./network-monitor-before-pack.cjs')(context)
  if (!['win32', 'darwin'].includes(context.electronPlatformName)) return
  if (context.electronPlatformName !== process.platform)
    throw new Error('Window materials must be built on the target operating system')
  const arch = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : null
  if (!arch) throw new Error('Unsupported window material target architecture')
  const result = spawnSync(
    process.execPath,
    [join(context.packager.projectDir, 'scripts/build-window-material.mjs'), `--arch=${arch}`],
    {
      cwd: context.packager.projectDir,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Window material build failed')
}
