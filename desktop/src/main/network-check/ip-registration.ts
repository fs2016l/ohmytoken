import { BlockList, isIP } from 'node:net'
import type { IpRegistrationResult } from '../../shared/network-check'
import { regionCode } from './ai-regions'
import { publicIp } from './policy'
import { jsonObject, parseObject, requestIssue, type ProbeResponse } from './protocol'

export function emptyIpRegistration(): IpRegistrationResult {
  return {
    state: 'pending',
    ip: null,
    countries: [],
    registries: [],
    observedAt: null,
    cached: false,
    issue: null,
  }
}

export function ipRegistrationUrl(ip: string): string {
  const address = publicIp(ip)
  if (!address) throw new Error('Invalid public IP')
  return `https://stat.ripe.net/data/rir/data.json?resource=${encodeURIComponent(address)}&lod=2`
}

function matchingPrefixLength(resource: unknown, ip: string): number | null {
  if (typeof resource !== 'string') return null
  const parts = resource.split('/')
  const family = isIP(ip)
  if (parts.length !== 2 || isIP(parts[0]) !== family || !/^\d+$/.test(parts[1])) return null
  const bits = Number(parts[1])
  if (bits > (family === 4 ? 32 : 128)) return null
  const type = family === 4 ? 'ipv4' : 'ipv6'
  const block = new BlockList()
  block.addSubnet(parts[0], bits, type)
  return block.check(ip, type) ? bits : null
}

/** RIR 登记国家仅来自地址分配记录，不用 ASN 或滥用联系人的所在国家替代。 */
export function parseIpRegistration(
  response: ProbeResponse,
  target: string,
  now = Date.now(),
): IpRegistrationResult {
  const result = emptyIpRegistration()
  result.ip = publicIp(target)
  result.observedAt = now
  result.issue =
    requestIssue(response) ??
    (response.truncated || response.redirectStopped ? 'invalid_response' : null)
  if (!result.issue) {
    const ip = result.ip
    const root = parseObject(response.body)
    const data = jsonObject(root.data)
    const exactResource =
      ip &&
      (publicIp(data.resource) === ip ||
        matchingPrefixLength(data.resource, ip) === (isIP(ip) === 4 ? 32 : 128))
    if (root.status !== 'ok' || !ip || !exactResource || !Array.isArray(data.rirs)) {
      result.issue = 'invalid_response'
    } else {
      const records = data.rirs.flatMap((value) => {
        const row = jsonObject(value)
        const bits = matchingPrefixLength(row.resource, ip)
        if (bits === null || !['ALLOCATED', 'ASSIGNED', 'LEGACY'].includes(String(row.status)))
          return []
        return [{ row, bits }]
      })
      // 有更具体的分配记录时，以该记录为准；同等具体程度的冲突保留给界面说明。
      const longest = Math.max(-1, ...records.map(({ bits }) => bits))
      const selected = records.filter(({ bits }) => bits === longest)
      result.ip = ip
      result.countries = [
        ...new Set(
          selected.flatMap(({ row }) => {
            const country = typeof row.country === 'string' ? regionCode(row.country) : null
            return country ? [country] : []
          }),
        ),
      ].sort()
      if (selected.some(({ row }) => typeof row.country !== 'string' || !regionCode(row.country)))
        result.countries = []
      result.registries = [
        ...new Set(
          selected.flatMap(({ row }) =>
            ['ARIN', 'RIPE NCC', 'RIPE', 'APNIC', 'AFRINIC', 'LACNIC'].includes(String(row.rir))
              ? [String(row.rir)]
              : [],
          ),
        ),
      ].sort()
    }
  }
  result.state = result.issue ? (result.issue === 'cancelled' ? 'cancelled' : 'failed') : 'done'
  return result
}
