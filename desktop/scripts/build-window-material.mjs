import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
if (process.platform !== 'win32' && process.platform !== 'darwin') {
  console.log('Native window materials are only available on Windows and macOS.')
  process.exit(0)
}
const arch = process.argv.find((arg) => arg.startsWith('--arch='))?.slice(7) || process.arch
if (arch !== 'x64' && arch !== 'arm64')
  throw new Error(`Unsupported material architecture: ${arch}`)
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Window material build failed (${result.status})`)
}
const version = require('electron/package.json').version
const cacheRoot = join(homedir(), '.electron-gyp')
const cache = join(cacheRoot, version)
const headers = join(cache, 'include/node')
const library = join(cache, arch, 'node.lib')
if (
  !existsSync(join(headers, 'node_api.h')) ||
  (process.platform === 'win32' && !existsSync(library))
) {
  run(process.execPath, [
    require.resolve('node-gyp/bin/node-gyp.js'),
    'install',
    `--target=${version}`,
    `--arch=${arch}`,
    '--dist-url=https://electronjs.org/headers',
    `--devdir=${cacheRoot}`,
    '--ensure',
  ])
}
const destination = join(root, 'resources/window-material', `${process.platform}-${arch}`)
mkdirSync(destination, { recursive: true })
if (process.platform === 'darwin') {
  run('xcrun', [
    '--sdk',
    'macosx',
    'clang++',
    '-arch',
    arch === 'x64' ? 'x86_64' : 'arm64',
    '-std=c++17',
    '-fobjc-arc',
    '-fblocks',
    '-dynamiclib',
    '-undefined',
    'dynamic_lookup',
    '-framework',
    'AppKit',
    '-mmacosx-version-min=12.0',
    '-DNAPI_VERSION=8',
    '-Wall',
    '-Wextra',
    '-I',
    headers,
    'native/window-material/window-material-mac.mm',
    '-o',
    join(destination, 'window_material.node'),
  ])
  console.log(`macOS vibrancy mask module ready (${arch}).`)
  process.exit(0)
}
const vswhere = join(
  process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
  'Microsoft Visual Studio/Installer/vswhere.exe',
)
const detection = spawnSync(
  vswhere,
  [
    '-latest',
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property',
    'installationPath',
  ],
  { encoding: 'utf8', windowsHide: true },
)
if (detection.error) throw detection.error
const install = detection.stdout?.trim()
if (!install)
  throw new Error('Visual Studio C++ Build Tools with CMake are required for Windows materials.')
const cmake = join(install, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe')
const output = join(root, '.local', `native-window-material-${arch}`)
run(cmake, [
  '-S',
  'native/window-material',
  '-B',
  output,
  '-A',
  arch === 'arm64' ? 'ARM64' : 'x64',
  `-DNODE_HEADERS=${headers}`,
  `-DNODE_LIBRARY=${library}`,
])
run(cmake, ['--build', output, '--config', 'Release'])
copyFileSync(
  join(output, 'Release/window_material.node'),
  join(destination, 'window_material.node'),
)
console.log(`Windows material module ready (${arch}).`)
