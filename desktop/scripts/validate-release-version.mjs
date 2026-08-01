import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const version = String(packageJson.version ?? '')
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)

if (!match) {
  throw new Error(
    'package.json version 必须是严格的 x.y.z，不能有第四段、前导零、v 前缀或预发布标签：' + version,
  )
}

const major = Number(match[1])
const minor = Number(match[2])
const patch = Number(match[3])
if (major >= 10000 || minor >= 100 || patch >= 100) {
  throw new Error(
    'package.json version 超出 com versionCode 范围：major<10000、minor<100、patch<100；当前 ' +
      version,
  )
}

console.log('发布版本校验通过：' + version)
console.log('Windows: ohmytoken-' + version + '-windows-x64-setup.exe')
console.log('macOS: ohmytoken-' + version + '-macos-{x64|arm64}.{dmg|zip}')
