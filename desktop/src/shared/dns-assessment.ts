import { DNS_PROBE_COUNT, type DnsObservation } from './network-check'

export interface DnsAssessment {
  status: 'pending' | 'checking' | 'consistent' | 'review' | 'unknown'
  reason:
    | 'not_checked'
    | 'checking'
    | 'region_mismatch'
    | 'matching_regions'
    | 'no_resolvers'
    | 'incomplete'
    | 'missing_location'
    | 'exit_unavailable'
    | 'location_unavailable'
  exitCountry: string | null
  resolverCountries: string[]
  locatedResolvers: number
  mismatchedResolvers: number
}

/** 只评估地区一致性。相同国家、相同 ASN 或公共 DNS 均不能证明没有泄漏。 */
export function assessDns(dns: DnsObservation | null | undefined): DnsAssessment {
  const geo = dns?.geolocation
  const locations = new Map(geo?.locations.map((location) => [location.ip, location]))
  const exitCountry = (geo?.exit?.ip && locations.get(geo.exit.ip)?.countryCode) || null
  const countries = (dns?.resolvers ?? [])
    .map((resolver) => locations.get(resolver.ip)?.countryCode)
    .filter((country): country is string => Boolean(country))
  const evidence = {
    exitCountry,
    resolverCountries: [...new Set(countries)].sort(),
    locatedResolvers: countries.length,
    mismatchedResolvers: exitCountry
      ? countries.filter((country) => country !== exitCountry).length
      : 0,
  }
  const result = (
    status: DnsAssessment['status'],
    reason: DnsAssessment['reason'],
  ): DnsAssessment => ({ status, reason, ...evidence })
  if (!dns || dns.state === 'pending') return result('pending', 'not_checked')
  if (dns.state === 'checking' || geo?.state === 'checking') return result('checking', 'checking')
  if (!dns.resolvers.length) return result('unknown', 'no_resolvers')
  if (!geo || geo.state !== 'done') return result('unknown', 'location_unavailable')
  if (geo.exit?.state !== 'done' || !exitCountry) return result('unknown', 'exit_unavailable')
  if (evidence.mismatchedResolvers) return result('review', 'region_mismatch')
  if (dns.state !== 'done' || dns.issue || dns.completedProbes < DNS_PROBE_COUNT)
    return result('unknown', 'incomplete')
  if (countries.length !== dns.resolvers.length) return result('unknown', 'missing_location')
  return result('consistent', 'matching_regions')
}
