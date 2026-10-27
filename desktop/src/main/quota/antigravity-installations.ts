import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve, win32 } from 'node:path'

interface Options {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  resourceDirectories?: readonly string[]
}

const registryScript = String.raw`
$ErrorActionPreference = 'Stop'
$roots = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
@(Get-ItemProperty -Path $roots -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Antigravity(?:\s+[0-9].*)?$' } | Select-Object InstallLocation,DisplayIcon) | ConvertTo-Json -Compress
`

function readMetadata(file: string, args: string[]): Promise<string> {
  return new Promise((complete) =>
    execFile(
      file,
      args,
      { encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true },
      (error, stdout) => complete(error ? '' : stdout),
    ),
  )
}

export function antigravityRegistryRoots(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    return rows.flatMap((value) => {
      if (!value || typeof value !== 'object') return []
      const row = value as Record<string, unknown>
      const paths: string[] = []
      if (typeof row.InstallLocation === 'string' && win32.isAbsolute(row.InstallLocation.trim()))
        paths.push(win32.join(row.InstallLocation.trim(), 'resources'))
      if (typeof row.DisplayIcon === 'string') {
        const file = row.DisplayIcon.replace(/,\s*-?\d+\s*$/, '')
          .trim()
          .replace(/^"|"$/g, '')
        if (win32.isAbsolute(file) && win32.basename(file).toLowerCase() === 'antigravity.exe')
          paths.push(win32.join(win32.dirname(file), 'resources'))
      }
      return paths
    })
  } catch {
    return []
  }
}

export async function antigravityResourceDirectories(options: Options): Promise<string[]> {
  if (options.resourceDirectories) return [...options.resourceDirectories]
  const paths: string[] = []
  const comparable = (home: string): string =>
    options.platform === 'win32' ? resolve(home).toLowerCase() : resolve(home)
  const realUser = comparable(options.home) === comparable(homedir())
  if (options.platform === 'win32') {
    if (realUser) {
      const shell = join(
        options.env.SystemRoot || options.env.WINDIR || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      paths.push(
        ...antigravityRegistryRoots(
          await readMetadata(shell, [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(registryScript, 'utf16le').toString('base64'),
          ]),
        ),
      )
    }
    for (const directory of (options.env.PATH || options.env.Path || '').split(';')) {
      if (!directory) continue
      const path = directory.trim().replace(/^"|"$/g, '')
      if (!win32.isAbsolute(path)) continue
      const root = win32.basename(path).toLowerCase() === 'bin' ? win32.dirname(path) : path
      paths.push(win32.join(root, 'resources'))
    }
    paths.push(
      join(
        options.env.LOCALAPPDATA || join(options.home, 'AppData', 'Local'),
        'Programs',
        'antigravity',
        'resources',
      ),
    )
  } else if (options.platform === 'darwin') {
    paths.push(join(options.home, 'Applications', 'Antigravity.app', 'Contents', 'Resources'))
    if (realUser) {
      paths.push('/Applications/Antigravity.app/Contents/Resources')
      const found = await readMetadata('/usr/bin/mdfind', ["kMDItemFSName == 'Antigravity.app'"])
      paths.push(
        ...found
          .trim()
          .split('\n')
          .filter((path) => path.endsWith('/Antigravity.app'))
          .map((path) => join(path, 'Contents', 'Resources')),
      )
    }
  }
  return [...new Set(paths)]
}
