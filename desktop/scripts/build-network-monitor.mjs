import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '..')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
if (process.platform === 'win32') {
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
  const cmake =
    install && join(install, 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe')
  if (!cmake || !existsSync(cmake))
    throw new Error(
      'Install Visual Studio C++ Build Tools with CMake to build the network monitor.',
    )
  const output = resolve(root, '.local/native-network-build')
  run(cmake, [
    '-S',
    'native/network-monitor/windows',
    '-B',
    output,
    '-A',
    'x64',
    `-DOMT_NETWORK_BUILD_TESTS=${process.argv.includes('--test') ? 'ON' : 'OFF'}`,
  ])
  run(cmake, ['--build', output, '--config', 'Release'])
  if (process.argv.includes('--test')) {
    run(join(cmake, '..', 'ctest.exe'), [
      '--test-dir',
      output,
      '-C',
      'Release',
      '--output-on-failure',
    ])
  }
  const target = resolve(root, 'resources/network-monitor/win32-x64')
  mkdirSync(target, { recursive: true })
  copyFileSync(
    join(output, 'Release/ohmytoken-network-monitor.exe'),
    join(target, 'ohmytoken-network-monitor.exe'),
  )
} else {
  throw new Error('Use the macOS network extension build script on a Mac with Xcode.')
}
