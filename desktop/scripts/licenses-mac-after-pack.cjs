module.exports = async function afterPack(context) {
  await require('./licenses-after-pack.cjs')(context)
  await require('./network-monitor-mac-after-pack.cjs')(context)
}
