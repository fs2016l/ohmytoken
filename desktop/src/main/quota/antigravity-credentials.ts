import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { TokenPlanDiscoveryIssue } from '../../shared/token-plan'
import {
  readAntigravityInstallation,
  type AntigravityInstallation,
} from './antigravity-oauth-client'
import { jwtClaims, object, textValue, timestamp, type AntigravityOAuthGrant } from './types'

interface CredentialDiscoveryOptions {
  home: string
  env: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  runner?: (file: string, args: readonly string[]) => Promise<string>
  installationReader?: (options: {
    home: string
    env: NodeJS.ProcessEnv
    platform: NodeJS.Platform
    audience?: string
  }) => Promise<AntigravityInstallation>
}

interface CredentialDiscoveryResult {
  grants: Array<{ source: string; grant: AntigravityOAuthGrant }>
  issues: TokenPlanDiscoveryIssue[]
  checkedSources: string[]
}

const source = 'Antigravity'
const maxCredentialBytes = 64 * 1024

// 只读取这个应用的单项通用凭据；原生存储由 Antigravity 自己维护。
const windowsCredentialScript = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AntigravityStoredCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Credential {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint BlobSize;
    public IntPtr Blob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }

  [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ReadCredential(string target, uint type, uint flags, out IntPtr value);

  [DllImport("advapi32.dll")]
  private static extern void CredFree(IntPtr value);

  public static string Read() {
    IntPtr value;
    if (!ReadCredential("gemini:antigravity", 1, 0, out value)) {
      int error = Marshal.GetLastWin32Error();
      if (error == 1168) return "";
      throw new Win32Exception(error);
    }
    try {
      Credential credential = (Credential)Marshal.PtrToStructure(value, typeof(Credential));
      if (credential.BlobSize == 0) return "";
      if (credential.BlobSize > 65536) throw new InvalidOperationException();
      byte[] bytes = new byte[credential.BlobSize];
      Marshal.Copy(credential.Blob, bytes, 0, bytes.Length);
      return Convert.ToBase64String(bytes);
    } finally {
      CredFree(value);
    }
  }
}
'@
  [Console]::Write([AntigravityStoredCredential]::Read())
} catch {
  exit 1
}
`

function runCredentialReader(file: string, args: readonly string[]): Promise<string> {
  return new Promise((complete, fail) => {
    execFile(
      file,
      [...args],
      { encoding: 'utf8', timeout: 5000, maxBuffer: maxCredentialBytes * 2, windowsHide: true },
      (error, stdout) => {
        if (error) fail(error)
        else complete(stdout)
      },
    )
  })
}

function decodeCredential(value: string, encoding?: 'base64' | 'hex'): string | undefined {
  if (Buffer.byteLength(value, 'utf8') > maxCredentialBytes * 2) return undefined
  if (!encoding) return value
  const valid =
    encoding === 'base64'
      ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
      : /^(?:[A-Fa-f0-9]{2})*$/.test(value)
  if (!valid) return undefined
  const bytes = Buffer.from(value, encoding)
  return bytes.length <= maxCredentialBytes ? bytes.toString('utf8') : undefined
}

function parseGrant(
  value: string,
): { grant: AntigravityOAuthGrant; audience?: string } | undefined {
  const stored = object(JSON.parse(value.replace(/^\uFEFF/, '')))
  const token = object(stored.token)
  const accessToken = textValue(token.access_token)
  const refreshToken = textValue(token.refresh_token)
  const tokenType = textValue(token.token_type)
  if (
    !accessToken ||
    accessToken.length > 32768 ||
    /\s/.test(accessToken) ||
    (refreshToken !== undefined && (refreshToken.length > 32768 || /\s/.test(refreshToken))) ||
    (tokenType !== undefined && tokenType.toLowerCase() !== 'bearer')
  )
    return undefined
  const expiresAt = timestamp(token.expiry) ?? undefined
  if (token.expiry !== undefined && token.expiry !== null && expiresAt === undefined)
    return undefined
  // aud 仅用于选择安装程序内确证的客户端配置，不作为已验证的账户身份。
  const audience = textValue(jwtClaims(textValue(stored.id_token) ?? '').aud)
  return {
    grant: {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
    ...(audience && audience.length <= 256 ? { audience } : {}),
  }
}

export async function discoverAntigravityGrants(
  options: CredentialDiscoveryOptions,
): Promise<CredentialDiscoveryResult> {
  const result: CredentialDiscoveryResult = { grants: [], issues: [], checkedSources: [source] }
  // 系统凭据属于当前 OS 用户；隔离目录的扫描不能混入当前用户的真实登录。
  const normalizeHome = (home: string): string => {
    const path = resolve(home)
    return options.platform === 'win32' ? path.toLowerCase() : path
  }
  if (!options.runner && normalizeHome(options.home) !== normalizeHome(homedir())) return result
  if (options.platform !== 'win32' && options.platform !== 'darwin') return result

  const reader = options.runner ?? runCredentialReader
  let value: string
  try {
    if (options.platform === 'win32') {
      const file = join(
        options.env.SystemRoot || options.env.WINDIR || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      )
      value = await reader(file, [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(windowsCredentialScript, 'utf16le').toString('base64'),
      ])
      if (!value.trim()) return result
      const decoded = decodeCredential(value.trim(), 'base64')
      if (decoded === undefined) throw new SyntaxError()
      value = decoded
    } else {
      value = await reader('/usr/bin/security', [
        'find-generic-password',
        '-s',
        'gemini',
        '-a',
        'antigravity',
        '-w',
      ])
      value = value.trim()
      if (!value) return result
      for (const [prefix, encoding] of [
        ['go-keyring-base64:', 'base64'],
        ['go-keyring-encoded:', 'hex'],
      ] as const) {
        if (!value.startsWith(prefix)) continue
        const decoded = decodeCredential(value.slice(prefix.length), encoding)
        if (decoded === undefined) throw new SyntaxError()
        value = decoded
        break
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    // security 的 44 表示没有该项；不转发子进程输出或凭据解析异常文本。
    if (options.platform === 'darwin' && Number(code) === 44) return result
    result.issues.push({
      source,
      reason: error instanceof SyntaxError ? 'invalid_config' : 'unreadable',
    })
    return result
  }

  try {
    if (Buffer.byteLength(value, 'utf8') > maxCredentialBytes) throw new SyntaxError()
    const parsed = parseGrant(value)
    if (parsed) {
      const installationReader = options.installationReader ?? readAntigravityInstallation
      const installation =
        !options.runner || options.installationReader
          ? await installationReader({ ...options, audience: parsed.audience })
          : {}
      result.grants.push({ source, grant: { ...parsed.grant, ...installation } })
    } else result.issues.push({ source, reason: 'invalid_config' })
  } catch {
    result.issues.push({ source, reason: 'invalid_config' })
  }
  return result
}
