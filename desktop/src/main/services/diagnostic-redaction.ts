export interface DiagnosticRedactionOptions {
  homeDirectory?: string
  appDirectories?: string[]
}

const QUOTED_SECRET_PATTERN =
  /(["']?\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|password|passwd|secret|client[_-]?secret|api[_ -]?key|code[_-]?verifier|code[_-]?challenge|session[_-]?id|cookie|set-cookie|private[_ -]?key)\b["']?\s*[=:]\s*)(["'])(.*?)\2/gi
const QUOTED_AUTH_PARAMETER_PATTERN = /(["']?\b(?:code|state)\b["']?\s*[=:]\s*)(["'])(.*?)\2/gi
const UNQUOTED_SECRET_PATTERN =
  /(["']?\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|password|passwd|secret|client[_-]?secret|api[_ -]?key|code[_-]?verifier|code[_-]?challenge|session[_-]?id|cookie|set-cookie|private[_ -]?key)\b["']?\s*[=:]\s*)[^\s,"'}&;]+/gi
const QUERY_SECRET_PATTERN =
  /([?&](?:token|access_token|refresh_token|id_token|code|state|session_id|code_verifier|code_challenge|client_secret|api_key|sign|q-signature|x-cos-security-token)=)[^&#\s]+/gi

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function flexiblePathPattern(path: string): RegExp | null {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (!trimmed) return null

  const unc = /^\\\\/.test(trimmed)
  const unix = /^\//.test(trimmed)
  const segments = trimmed.split(/[\\/]+/).filter(Boolean)
  if (segments.length === 0) return null

  const prefix = unc ? '[\\\\/]{2}' : unix ? '[\\\\/]' : ''
  return new RegExp(`${prefix}${segments.map(escapeRegExp).join('[\\\\/]')}`, 'gi')
}

function replaceKnownPath(text: string, path: string | undefined, marker: string): string {
  if (!path) return text
  const pattern = flexiblePathPattern(path)
  return pattern ? text.replace(pattern, marker) : text
}

/**
 * 对写盘和上传文本做统一脱敏。已知的软件根目录会折叠为 <APP>，因此开发
 * 栈只保留软件内部相对位置，不暴露工作区前缀；用户主目录折叠为 <HOME>。
 */
export function redactDiagnosticText(
  value: string,
  options: DiagnosticRedactionOptions = {},
): string {
  let text = value

  const appDirectories = [...new Set(options.appDirectories?.filter(Boolean) ?? [])].sort(
    (left, right) => right.length - left.length,
  )
  for (const directory of appDirectories) text = replaceKnownPath(text, directory, '<APP>')
  text = replaceKnownPath(text, options.homeDirectory, '<HOME>')

  // 兜底识别开发目录，即使 Electron 启动时 cwd 不是 desktop，也不暴露其上级工作区。
  text = text.replace(
    /(?:[A-Za-z]:[\\/]|\/)[^:\r\n"'<>|]*?[\\/]ohmyagent[\\/]desktop(?=[\\/):\s]|$)/gi,
    '<APP>',
  )

  text = text.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gi,
    '<PRIVATE_KEY_REDACTED>',
  )
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer <REDACTED>')
  text = text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1<REDACTED>@')
  text = text.replace(QUOTED_SECRET_PATTERN, '$1$2<REDACTED>$2')
  text = text.replace(UNQUOTED_SECRET_PATTERN, '$1<REDACTED>')
  text = text.replace(QUOTED_AUTH_PARAMETER_PATTERN, '$1$2<REDACTED>$2')
  text = text.replace(QUERY_SECRET_PATTERN, '$1<REDACTED>')
  text = text.replace(/(\b(?:cookie|set-cookie)\s*:\s*)[^\r\n]+/gi, '$1<REDACTED>')
  text = text.replace(
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    '<JWT_REDACTED>',
  )
  text = text.replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '<API_KEY_REDACTED>')
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '<EMAIL_REDACTED>')
  return text
}
