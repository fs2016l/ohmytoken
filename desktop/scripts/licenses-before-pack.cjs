module.exports = async function beforePack(context) {
  const { writeOrCheckNotices } = await import('./third-party-notices.mjs')
  const { catalogue } = writeOrCheckNotices({ root: context.packager.projectDir, check: true })
  const electron = catalogue.entries.find((entry) => entry.name === 'Electron')
  if (context.packager.info.framework.version !== electron?.version)
    throw new Error('Packaged Electron version differs from the reviewed runtime notices')
  await require('./window-material-before-pack.cjs')(context)
}
