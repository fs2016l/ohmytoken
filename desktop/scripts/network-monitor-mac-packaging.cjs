// Opt-in macOS packaging. The ordinary signed app build does not acquire new
// entitlements until the matching Developer ID profiles have been supplied.
const { spawnSync } = require('node:child_process')
const { readFileSync, writeFileSync, mkdirSync, cpSync, copyFileSync } = require('node:fs')
const { join, resolve, sep } = require('node:path')
const prepared = new Map()
const hostId = 'net.ohmytoken.desktop'
const extensionId = `${hostId}.network-filter`
const capability = 'content-filter-provider-systemextension'

function run(command, args, input) {
  const result = spawnSync(command, args, { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (result.error || result.status !== 0)
    throw new Error(`Network extension preparation failed: ${command}`)
  return result.stdout
}
function readPlist(xml) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], xml))
}
function validateProfile(profile, team, bundle, host = false, now = Date.now()) {
  const entitlement = profile.Entitlements || {}
  if (!/^[A-Z0-9]{10}$/.test(team) || !profile.TeamIdentifier?.includes(team))
    throw new Error('Network extension profile belongs to a different Apple team')
  if (entitlement['com.apple.application-identifier'] !== `${team}.${bundle}`)
    throw new Error('Network extension profile has the wrong application identifier')
  if (!entitlement['com.apple.developer.networking.networkextension']?.includes(capability))
    throw new Error('Network extension capability is missing from the provisioning profile')
  if (!entitlement['com.apple.security.application-groups']?.includes(`${team}.${hostId}.network`))
    throw new Error('Network extension application group is missing from the provisioning profile')
  if (host && entitlement['com.apple.developer.system-extension.install'] !== true)
    throw new Error('System extension installation capability is missing from the host profile')
  if (
    entitlement['get-task-allow'] ||
    entitlement['com.apple.security.get-task-allow'] ||
    !profile.ProvisionsAllDevices
  )
    throw new Error('Use a Developer ID distribution provisioning profile')
  if (
    !Number.isFinite(Date.parse(profile.ExpirationDate)) ||
    Date.parse(profile.ExpirationDate) <= now
  )
    throw new Error('Network extension provisioning profile is expired')
}
function escapeXML(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
function xmlValue(value) {
  if (typeof value === 'boolean') return value ? '<true/>' : '<false/>'
  if (typeof value === 'string') return `<string>${escapeXML(value)}</string>`
  if (Array.isArray(value)) return `<array>${value.map(xmlValue).join('')}</array>`
  if (value && typeof value === 'object')
    return `<dict>${Object.entries(value)
      .map(([key, item]) => `<key>${escapeXML(key)}</key>${xmlValue(item)}`)
      .join('')}</dict>`
  throw new Error('Unsupported entitlement value')
}
function writePlist(path, values) {
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0">${xmlValue(values)}</plist>`,
  )
}
function identifiedEntitlements(values, team, bundle) {
  return {
    ...values,
    'com.apple.application-identifier': `${team}.${bundle}`,
    'com.apple.developer.team-identifier': team,
  }
}
async function prepareBundle(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin')
    throw new Error('Network extension packaging requires macOS')
  const arch = { 1: 'x64', 3: 'arm64' }[context.arch]
  if (!arch) throw new Error('Build the network extension separately for x64 or arm64')
  const root = context.packager.projectDir
  const output = join(root, `resources/network-monitor/darwin-${arch}`)
  const manifest = JSON.parse(readFileSync(join(output, 'build.json'), 'utf8'))
  const team = process.env.OMT_NETWORK_TEAM_ID
  if (
    manifest.team !== team ||
    manifest.arch !== arch ||
    manifest.version !== context.packager.appInfo.version
  )
    throw new Error('Rebuild the macOS network extension for this team, version and architecture')
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const contents = join(app, 'Contents')
  const extension = join(contents, 'Library/SystemExtensions', `${extensionId}.systemextension`)
  const hostProfile = process.env.OMT_NETWORK_HOST_PROFILE
  const filterProfile = process.env.OMT_NETWORK_EXTENSION_PROFILE
  if (!hostProfile || !filterProfile)
    throw new Error('Provide OMT_NETWORK_HOST_PROFILE and OMT_NETWORK_EXTENSION_PROFILE')
  for (const [path, bundle, host] of [
    [hostProfile, hostId, true],
    [filterProfile, extensionId, false],
  ]) {
    const profile = readPlist(run('/usr/bin/security', ['cms', '-D', '-i', path]))
    validateProfile(profile, team, bundle, host)
  }
  mkdirSync(join(contents, 'Library/SystemExtensions'), { recursive: true })
  cpSync(join(output, `${extensionId}.systemextension`), extension, { recursive: true })
  copyFileSync(
    join(output, 'ohmytoken-network-monitor'),
    join(contents, 'MacOS/ohmytoken-network-monitor'),
  )
  copyFileSync(hostProfile, join(contents, 'embedded.provisionprofile'))
  copyFileSync(filterProfile, join(extension, 'Contents/embedded.provisionprofile'))
  run('/usr/bin/plutil', [
    '-insert',
    'NSSystemExtensionUsageDescription',
    '-string',
    'Measure application network usage without reading request contents.',
    join(contents, 'Info.plist'),
  ])
  const bridge = readPlist(readFileSync(join(output, 'bridge.entitlements.plist'), 'utf8'))
  const host = readPlist(readFileSync(join(root, 'build/entitlements.mac.plist'), 'utf8'))
  const filter = readPlist(readFileSync(join(output, 'extension.entitlements.plist'), 'utf8'))
  const staging = join(root, `.local/network-signing-${arch}`)
  mkdirSync(staging, { recursive: true })
  writePlist(
    join(staging, 'host.plist'),
    identifiedEntitlements({ ...host, ...bridge }, team, hostId),
  )
  // The auxiliary executable is part of the containing app and uses its exact
  // application identifier/profile, rather than an unprovisioned helper ID.
  writePlist(join(staging, 'bridge.plist'), identifiedEntitlements(bridge, team, hostId))
  writePlist(join(staging, 'filter.plist'), identifiedEntitlements(filter, team, extensionId))
  prepared.set(resolve(app), { staging, extension })
}
async function signBundle(options) {
  const app = resolve(options.app)
  const metadata = prepared.get(app)
  if (!metadata) throw new Error('Network extension bundle has not passed provisioning checks')
  if (!options.identity || options.identity === '-')
    throw new Error('A Developer ID signing identity is required')
  const { signAsync } = await import('@electron/osx-sign')
  const inherited = options.optionsForFile
  const bridge = join(app, 'Contents/MacOS/ohmytoken-network-monitor')
  await signAsync({
    ...options,
    preAutoEntitlements: false,
    // osx-sign discovers Mach-O files but does not discover .systemextension
    // bundles; include the bundle so its resources are sealed before the app.
    binaries: [...(options.binaries || []), metadata.extension],
    optionsForFile(file) {
      const defaults = inherited?.(file) || {}
      if (file === app) return { ...defaults, entitlements: join(metadata.staging, 'host.plist') }
      if (file === bridge)
        return {
          ...defaults,
          entitlements: join(metadata.staging, 'bridge.plist'),
          additionalArguments: [...(defaults.additionalArguments || []), '--identifier', hostId],
        }
      if (file === metadata.extension || file.startsWith(`${metadata.extension}${sep}`))
        return { ...defaults, entitlements: join(metadata.staging, 'filter.plist') }
      return defaults
    },
  })
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
}
module.exports = { prepareBundle, signBundle, validateProfile }
