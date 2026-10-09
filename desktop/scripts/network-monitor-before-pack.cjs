const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
module.exports = async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return
  const result = spawnSync(
    process.execPath,
    [join(context.packager.projectDir, 'scripts/build-network-monitor.mjs')],
    {
      cwd: context.packager.projectDir,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Network collector build failed')
}
