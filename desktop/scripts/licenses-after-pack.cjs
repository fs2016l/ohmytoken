const { join } = require('node:path')
module.exports = async function afterPack(context) {
  const { verifyPackagedNotices } = await import('./verify-packaged-notices.mjs')
  const resources =
    context.electronPlatformName === 'darwin'
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          'Contents',
          'Resources',
        )
      : join(context.appOutDir, 'resources')
  verifyPackagedNotices(context.packager.projectDir, resources)
  await require('./network-monitor-after-pack.cjs')(context)
}
