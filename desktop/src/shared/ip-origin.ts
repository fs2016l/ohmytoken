import type { IpQualityResult, IpRegistrationResult } from './network-check'

export interface IpOriginAssessment {
  status: 'native' | 'cross_region' | 'unknown'
  reason:
    | 'country_match'
    | 'country_mismatch'
    | 'registration_missing'
    | 'registration_conflict'
    | 'location_missing'
    | 'location_conflict'
  locatedCountries: string[]
}

/** 国家一致性只是原生 / 广播的参考，不能证明物理位置、路由方式或住宅属性。 */
export function assessIpOrigin(
  registration: IpRegistrationResult | null | undefined,
  sources: readonly IpQualityResult[],
): IpOriginAssessment {
  const locatedCountries = [
    ...new Set(
      sources.flatMap((source) =>
        source.state === 'done' && source.ip === registration?.ip && source.countryCode
          ? [source.countryCode]
          : [],
      ),
    ),
  ].sort()
  const unknown = (reason: IpOriginAssessment['reason']): IpOriginAssessment => ({
    status: 'unknown',
    reason,
    locatedCountries,
  })
  if (registration?.state !== 'done' || !registration.ip || !registration.countries.length)
    return unknown('registration_missing')
  if (registration.countries.length > 1) return unknown('registration_conflict')
  if (!locatedCountries.length) return unknown('location_missing')
  if (locatedCountries.length > 1) return unknown('location_conflict')
  const matches = locatedCountries[0] === registration.countries[0]
  return {
    status: matches ? 'native' : 'cross_region',
    reason: matches ? 'country_match' : 'country_mismatch',
    locatedCountries,
  }
}
