const { join } = require('node:path')
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const options = context.packager.platformSpecificBuildOptions
  if (options.signAndEditExecutable === false || options.signExecutable === false) return
  // electron-builder 26 only discovers nested EXEs under app.asar.unpacked.
  // This helper lives in extraResources and needs the same signing pipeline.
  await context.packager.signIf(
    join(context.appOutDir, 'resources/network-monitor/win32-x64/ohmytoken-network-monitor.exe'),
  )
}
