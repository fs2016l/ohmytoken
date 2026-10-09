import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

if (process.platform !== 'darwin')
  throw new Error('The macOS network extension must be compiled on a Mac with Xcode.')
const root = resolve(import.meta.dirname, '..'),
  source = join(root, 'native/network-monitor/macos')
const arch = process.env.OMT_NETWORK_ARCH || process.arch
if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported macOS architecture')
const team = process.env.OMT_NETWORK_TEAM_ID
if (!team || !/^[A-Z0-9]{10}$/.test(team))
  throw new Error(
    'Set OMT_NETWORK_TEAM_ID to the Apple Developer Team ID enabled for the network extension.',
  )
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const target = `${arch === 'x64' ? 'x86_64' : 'arm64'}-apple-macos13.0`
const output = join(root, `resources/network-monitor/darwin-${arch}`),
  temp = join(root, `.local/native-network-mac-${arch}`)
const extension = join(output, 'net.ohmytoken.desktop.network-filter.systemextension', 'Contents')
mkdirSync(join(extension, 'MacOS'), { recursive: true })
mkdirSync(temp, { recursive: true })
function run(tool, args) {
  const result = spawnSync('/usr/bin/xcrun', [tool, ...args], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
const object = join(temp, 'ProcessInfo.o')
run('clang', [
  '-std=c11',
  '-D_DARWIN_C_SOURCE',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-target',
  target,
  '-c',
  join(source, 'ProcessInfo.c'),
  '-o',
  object,
])
const shared = [
  '-parse-as-library',
  '-swift-version',
  '5',
  '-O',
  '-target',
  target,
  '-import-objc-header',
  join(source, 'ProcessInfo.h'),
  join(source, 'ProcessMetadata.swift'),
  join(source, 'MonitorIPC.swift'),
  object,
  '-lbsm',
  '-framework',
  'Foundation',
  '-framework',
  'NetworkExtension',
  '-framework',
  'SystemExtensions',
]
run('swiftc', [
  ...shared,
  '-module-name',
  'OMTNetwork',
  join(source, 'FilterDataProvider.swift'),
  join(source, 'ExtensionMain.swift'),
  '-framework',
  'Network',
  '-framework',
  'Security',
  '-o',
  join(extension, 'MacOS/ohmytoken-network-filter'),
])
run('swiftc', [
  ...shared,
  '-module-name',
  'OMTNetworkBridge',
  join(source, 'BridgeMain.swift'),
  '-o',
  join(output, 'ohmytoken-network-monitor'),
])
function expand(name, target) {
  const text = readFileSync(join(source, name), 'utf8')
    .replaceAll('__TEAM__', team)
    .replaceAll('__VERSION__', version)
  writeFileSync(target, text)
}
expand('Extension-Info.plist', join(extension, 'Info.plist'))
expand('Extension.entitlements.plist', join(output, 'extension.entitlements.plist'))
expand('Bridge.entitlements.plist', join(output, 'bridge.entitlements.plist'))
writeFileSync(join(output, 'build.json'), JSON.stringify({ version, arch, team }))
console.log(
  `Built unsigned macOS collector (${arch}). A provisioned, signed app bundle is required before activation.`,
)
