import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { object, textValue } from './types'
import { antigravityResourceDirectories } from './antigravity-installations'

interface InstallationOptions {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  audience?: string
  resourceDirectories?: readonly string[]
}

export interface AntigravityInstallation {
  clientVersion?: string
  clientId?: string
  clientSecret?: string
}

interface Segment {
  address: number
  offset: number
  size: number
}

interface Executable {
  architecture: 'x64' | 'arm64'
  textAddress: number
  segments: Segment[]
}

interface OAuthClient {
  clientId: string
  clientSecret: string
}

const configFunction =
  'google3/third_party/jetski/language_server/code_assist_client/codeassistclient.getOAuth2Config'
const installationCache = new Map<string, { stamp: string; clients: OAuthClient[] }>()
const versionCache = new Map<string, { stamp: string; version?: string }>()
// Electron 将 .asar 视作虚拟目录；版本解析需要读取归档原始字节，不能使用其 patched fs。
const archiveFs = process.versions.electron
  ? (createRequire(__filename)('original-fs') as typeof import('node:fs')).promises
  : { readFile, stat }

function inRange(bytes: Buffer, offset: number, size: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(size) &&
    offset >= 0 &&
    size >= 0 &&
    offset + size <= bytes.length
  )
}

function uint64(bytes: Buffer, offset: number): number {
  const value = Number(bytes.readBigUInt64LE(offset))
  if (!Number.isSafeInteger(value)) throw new RangeError()
  return value
}

function executableLayout(bytes: Buffer): Executable | undefined {
  if (!inRange(bytes, 0, 64)) return undefined
  const segments: Segment[] = []
  let textAddress = 0
  if (bytes.readUInt16LE(0) === 0x5a4d) {
    const header = bytes.readUInt32LE(60)
    if (!inRange(bytes, header, 24) || bytes.readUInt32LE(header) !== 0x4550) return undefined
    const machine = bytes.readUInt16LE(header + 4)
    const count = bytes.readUInt16LE(header + 6)
    const optionalSize = bytes.readUInt16LE(header + 20)
    const optional = header + 24
    if (
      machine !== 0x8664 ||
      count > 128 ||
      optionalSize < 32 ||
      !inRange(bytes, optional, optionalSize + count * 40) ||
      bytes.readUInt16LE(optional) !== 0x20b
    )
      return undefined
    const imageBase = uint64(bytes, optional + 24)
    for (let index = 0; index < count; index++) {
      const row = optional + optionalSize + index * 40
      const name = bytes
        .subarray(row, row + 8)
        .toString('ascii')
        .replace(/\0.*$/, '')
      const address = imageBase + bytes.readUInt32LE(row + 12)
      const size = bytes.readUInt32LE(row + 16)
      const offset = bytes.readUInt32LE(row + 20)
      if (!inRange(bytes, offset, size)) return undefined
      segments.push({ address, offset, size })
      if (name === '.text') textAddress = address
    }
    return textAddress ? { architecture: 'x64', textAddress, segments } : undefined
  }
  if (bytes.readUInt32LE(0) !== 0xfeedfacf) return undefined
  const cpu = bytes.readUInt32LE(4)
  const architecture = cpu === 0x1000007 ? 'x64' : cpu === 0x100000c ? 'arm64' : undefined
  const count = bytes.readUInt32LE(16)
  const commandBytes = bytes.readUInt32LE(20)
  if (!architecture || count > 256 || !inRange(bytes, 32, commandBytes)) return undefined
  let row = 32
  for (let index = 0; index < count; index++) {
    if (!inRange(bytes, row, 8)) return undefined
    const command = bytes.readUInt32LE(row)
    const size = bytes.readUInt32LE(row + 4)
    if (size < 8 || !inRange(bytes, row, size) || row + size > 32 + commandBytes) return undefined
    if (command === 0x19 && size >= 72) {
      const sectionCount = bytes.readUInt32LE(row + 64)
      if (sectionCount > 128 || size < 72 + sectionCount * 80) return undefined
      for (let index = 0; index < sectionCount; index++) {
        const section = row + 72 + index * 80
        const name = bytes
          .subarray(section, section + 16)
          .toString('ascii')
          .replace(/\0.*$/, '')
        const address = uint64(bytes, section + 32)
        const sectionSize = uint64(bytes, section + 40)
        const offset = bytes.readUInt32LE(section + 48)
        const sectionType = bytes.readUInt32LE(section + 64) & 0xff
        // 零填充段没有对应文件内容，不能作为字符串或函数来源。
        if (![1, 0xc, 0x12].includes(sectionType) && inRange(bytes, offset, sectionSize))
          segments.push({ address, offset, size: sectionSize })
        if (name === '__text') textAddress = address
      }
    }
    row += size
  }
  return textAddress ? { architecture, textAddress, segments } : undefined
}

function fileOffset(layout: Executable, address: number, size = 1): number | undefined {
  for (const segment of layout.segments) {
    const relative = address - segment.address
    if (relative >= 0 && relative + size <= segment.size) return segment.offset + relative
  }
  return undefined
}

function nativeConfigFunction(
  bytes: Buffer,
  layout: Executable,
): { code: Buffer; address: number } | undefined {
  const marker = Buffer.from('f1ffffff00000108', 'hex')
  if (layout.architecture === 'arm64') marker[6] = 4
  let cursor = 0
  while (cursor < bytes.length) {
    const header = bytes.indexOf(marker, cursor)
    if (header < 0) return undefined
    cursor = header + 8
    if (!inRange(bytes, header, 72)) continue
    const count = uint64(bytes, header + 8)
    const nameTable = header + uint64(bytes, header + 32)
    const table = header + uint64(bytes, header + 64)
    const textAddress = uint64(bytes, header + 24) || layout.textAddress
    if (count < 1 || count > 500000 || !inRange(bytes, table, (count + 1) * 8)) continue
    const name = bytes.indexOf(Buffer.from(`${configFunction}\0`), nameTable)
    if (name < nameTable || name >= table) continue
    const nameOffset = name - nameTable
    for (let index = 0; index < count; index++) {
      const row = table + index * 8
      const metadata = table + bytes.readUInt32LE(row + 4)
      if (!inRange(bytes, metadata, 8) || bytes.readInt32LE(metadata + 4) !== nameOffset) continue
      const start = bytes.readUInt32LE(row)
      const end = bytes.readUInt32LE(row + 8)
      const length = end - start
      if (length <= 0 || length > 65536) return undefined
      const address = textAddress + start
      const offset = fileOffset(layout, address, length)
      return offset === undefined
        ? undefined
        : { address, code: bytes.subarray(offset, offset + length) }
    }
  }
  return undefined
}

function readGoString(
  bytes: Buffer,
  layout: Executable,
  address: number,
  length: number,
): string | undefined {
  if (!Number.isInteger(length) || length < 8 || length > 256) return undefined
  const offset = fileOffset(layout, address, length)
  if (offset === undefined) return undefined
  return bytes.subarray(offset, offset + length).toString('ascii')
}

function x64Strings(code: Buffer, address: number): Array<{ address: number; length: number }> {
  const strings: Array<{ address: number; length: number }> = []
  for (let index = 12; index + 15 <= code.length; index++) {
    const rex = code[index]
    if ((rex !== 0x48 && rex !== 0x4c) || code[index + 1] !== 0x8d) continue
    const register = (code[index + 2] >> 3) & 7
    if ((code[index + 2] & 0xc7) !== 5) continue
    if (!code.subarray(index - 12, index - 8).equals(Buffer.from('48c78424', 'hex'))) continue
    if (
      code[index + 7] !== rex ||
      code[index + 8] !== 0x89 ||
      code[index + 9] !== (0x84 | (register << 3)) ||
      code[index + 10] !== 0x24
    )
      continue
    const lengthSlot = code.readUInt32LE(index - 8)
    const pointerSlot = code.readUInt32LE(index + 11)
    if (pointerSlot + 8 !== lengthSlot) continue
    strings.push({
      address: address + index + 7 + code.readInt32LE(index + 3),
      length: code.readUInt32LE(index - 4),
    })
  }
  return strings
}

function arm64Strings(code: Buffer, address: number): Array<{ address: number; length: number }> {
  const strings: Array<{ address: number; length: number }> = []
  for (let index = 0; index + 8 <= code.length; index += 4) {
    const page = code.readUInt32LE(index)
    if ((page & 0x9f000000) >>> 0 !== 0x90000000) continue
    const register = page & 31
    let relative = (((page >>> 5) & 0x7ffff) << 2) | ((page >>> 29) & 3)
    if (relative & 0x100000) relative -= 0x200000
    const pageAddress = Math.floor((address + index) / 4096) * 4096 + relative * 4096
    const add = code.readUInt32LE(index + 4)
    if ((add & 0xffc00000) >>> 0 !== 0x91000000 || ((add >>> 5) & 31) !== register) continue
    const pointerRegister = add & 31
    const constantAddress = pageAddress + ((add >>> 10) & 0xfff)
    for (let storeAt = index + 8; storeAt < Math.min(code.length, index + 48); storeAt += 4) {
      const store = code.readUInt32LE(storeAt)
      if (
        (store & 0xffc00000) >>> 0 !== 0xa9000000 ||
        (store & 31) !== pointerRegister ||
        ((store >>> 5) & 31) !== 31
      )
        continue
      const lengthRegister = (store >>> 10) & 31
      for (let literalAt = Math.max(0, index - 16); literalAt < storeAt; literalAt += 4) {
        const literal = code.readUInt32LE(literalAt)
        if ((literal & 0xffe00000) >>> 0 !== 0xd2800000 || (literal & 31) !== lengthRegister)
          continue
        strings.push({ address: constantAddress, length: (literal >>> 5) & 0xffff })
      }
    }
  }
  return strings
}

/** 仅接受已命名 OAuth 配置函数中有明确 GoString 指针/长度的唯一默认客户端。 */
export function parseAntigravityOAuthClient(bytes: Buffer): OAuthClient | undefined {
  try {
    if (inRange(bytes, 0, 8) && [0xcafebabe, 0xcafebabf].includes(bytes.readUInt32BE(0))) {
      const wide = bytes.readUInt32BE(0) === 0xcafebabf
      const count = bytes.readUInt32BE(4)
      const rowSize = wide ? 32 : 20
      if (count < 1 || count > 8 || !inRange(bytes, 8, count * rowSize)) return undefined
      const clients = new Map<string, OAuthClient>()
      for (let index = 0; index < count; index++) {
        const row = 8 + index * rowSize
        const offset = wide ? Number(bytes.readBigUInt64BE(row + 8)) : bytes.readUInt32BE(row + 8)
        const size = wide ? Number(bytes.readBigUInt64BE(row + 16)) : bytes.readUInt32BE(row + 12)
        if (!inRange(bytes, offset, size) || offset < 8 + count * rowSize) return undefined
        const slice = bytes.subarray(offset, offset + size)
        // 每个 slice 必须是独立的薄 Mach-O，不递归解释嵌套容器。
        if (!inRange(slice, 0, 4) || slice.readUInt32LE(0) !== 0xfeedfacf) continue
        const client = parseAntigravityOAuthClient(slice)
        if (client) clients.set(JSON.stringify(client), client)
      }
      return clients.size === 1 ? [...clients.values()][0] : undefined
    }
    const layout = executableLayout(bytes)
    if (!layout) return undefined
    const fn = nativeConfigFunction(bytes, layout)
    if (!fn) return undefined
    const strings =
      layout.architecture === 'x64'
        ? x64Strings(fn.code, fn.address)
        : arm64Strings(fn.code, fn.address)
    const ids = new Set<string>()
    const secrets = new Set<string>()
    for (const item of strings) {
      const value = readGoString(bytes, layout, item.address, item.length)
      if (!value) continue
      if (/^\d{8,20}-[A-Za-z0-9_-]{10,70}\.apps\.googleusercontent\.com$/.test(value))
        ids.add(value)
      if (/^GOCSPX-[A-Za-z0-9_-]{20,60}$/.test(value)) secrets.add(value)
    }
    if (ids.size !== 1 || secrets.size !== 1) return undefined
    return { clientId: [...ids][0], clientSecret: [...secrets][0] }
  } catch {
    return undefined
  }
}

export function parseAntigravityAsarVersion(bytes: Buffer): string | undefined {
  try {
    if (!inRange(bytes, 0, 16) || bytes.readUInt32LE(0) !== 4) return undefined
    const headerSize = bytes.readUInt32LE(4)
    const jsonSize = bytes.readUInt32LE(12)
    if (headerSize > 1024 * 1024 || jsonSize > headerSize - 8 || !inRange(bytes, 16, jsonSize))
      return undefined
    const header = object(JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8')))
    const packageEntry = object(object(header.files)['package.json'])
    if (packageEntry.unpacked) return undefined
    const offset = Number(packageEntry.offset)
    const size = Number(packageEntry.size)
    const start = 8 + headerSize + offset
    if (size > 64 * 1024 || !inRange(bytes, start, size)) return undefined
    const metadata = object(JSON.parse(bytes.subarray(start, start + size).toString('utf8')))
    const version = textValue(metadata.version)
    return metadata.name === 'antigravity' &&
      version &&
      /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)
      ? version
      : undefined
  } catch {
    return undefined
  }
}

export async function readAntigravityInstallation(
  options: InstallationOptions,
): Promise<AntigravityInstallation> {
  const resources = await antigravityResourceDirectories(options)
  let fallback: AntigravityInstallation = {}
  for (const root of resources) {
    const archive = join(root, 'app.asar')
    let clientVersion: string | undefined
    try {
      const file = await archiveFs.stat(archive)
      if (!file.isFile() || file.size > 32 * 1024 * 1024) continue
      const stamp = `${file.size}:${file.mtimeMs}`
      let cached = versionCache.get(archive)
      if (!cached || cached.stamp !== stamp) {
        cached = { stamp, version: parseAntigravityAsarVersion(await archiveFs.readFile(archive)) }
        versionCache.set(archive, cached)
      }
      clientVersion = cached.version
      if (!clientVersion) continue
      if (!fallback.clientVersion) fallback = { clientVersion }
    } catch {
      continue
    }
    if (!options.audience) return { clientVersion }
    try {
      const binary = join(
        root,
        'bin',
        options.platform === 'win32' ? 'language_server.exe' : 'language_server',
      )
      const file = await stat(binary)
      if (!file.isFile() || file.size > 256 * 1024 * 1024) continue
      const stamp = `${file.size}:${file.mtimeMs}`
      let cached = installationCache.get(binary)
      if (!cached || cached.stamp !== stamp) {
        const client = parseAntigravityOAuthClient(await readFile(binary))
        cached = { stamp, clients: client ? [client] : [] }
        installationCache.set(binary, cached)
      }
      const client = cached.clients.find((item) => item.clientId === options.audience)
      if (client) return { clientVersion, ...client }
    } catch {
      continue
    }
  }
  return fallback
}
