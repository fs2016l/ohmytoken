import { readFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const envFile = fileURLToPath(new URL('../.env.production', import.meta.url))

function readEnvValue(name) {
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith(`${name}=`))
  return line ? line.slice(line.indexOf('=') + 1).trim() : ''
}

// TODO: 发布 Agent 前只注入这个公开 API Base；禁止放入任何 COS/CDN/CAM/数据库密钥。
const raw = process.env.MAIN_VITE_OHMYTOKEN_API_BASE || readEnvValue('MAIN_VITE_OHMYTOKEN_API_BASE')
let url
try {
  url = new URL(raw)
} catch {
  throw new Error('MAIN_VITE_OHMYTOKEN_API_BASE 未配置或不是合法 URL')
}
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
  throw new Error('生产 Agent API Base 必须是无凭据、query、fragment 的 HTTPS URL')
}
if (
  url.hostname === 'example.com' ||
  url.hostname.endsWith('.example.com') ||
  url.hostname.endsWith('.invalid') ||
  raw.includes('TODO')
) {
  throw new Error('MAIN_VITE_OHMYTOKEN_API_BASE 仍是 TODO/占位地址，拒绝生成生产 Agent')
}

console.log(`production Agent API Base validated: ${url.origin}${url.pathname.replace(/\/+$/, '')}`)
