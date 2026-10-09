import type { UsageCostGroup, UsageCostRollup } from './usage-cost'

/** Preserve coverage when a record lacks a valid cached price, without assigning it a fee. */
export function unpricedCostRollup(
  agent: string,
  model: string,
  tokens: number,
  records: number,
  catalogVersion: string,
): UsageCostRollup {
  return summarizeCostGroups(
    [
      {
        agent,
        model,
        tokens,
        records,
        identity: { vendor: 'unknown', vendorBasis: 'unknown' },
        status: 'unpriced',
      },
    ],
    catalogVersion,
  )
}

export function combineCostRollups(
  rollups: readonly UsageCostRollup[],
  catalogVersion: string,
): UsageCostRollup {
  const accumulator = createCostAccumulator(catalogVersion)
  for (const rollup of rollups) accumulator.add(rollup)
  return accumulator.finish()
}

/** Merge streamed aggregates once; avoids repeatedly sorting the growing global summary. */
export function createCostAccumulator(catalogVersion: string) {
  const groups = new Map<string, UsageCostGroup>()
  let legacyRecords = 0
  function add(rollup: UsageCostRollup): void {
    if (rollup.catalogVersion !== catalogVersion) throw new Error('Cost revisions do not match')
    legacyRecords += rollup.legacyRecords
    for (const group of rollup.groups) {
      const key = JSON.stringify([
        group.agent,
        group.model,
        group.identity,
        group.status,
        group.reason,
        group.currency,
        group.priceCard,
        group.source,
        group.pricingPeriod,
        group.pricingEffectiveFrom,
      ])
      const existing = groups.get(key)
      if (!existing) groups.set(key, { ...group })
      else {
        existing.records += group.records
        existing.tokens += group.tokens
        if (group.min !== undefined) existing.min = (existing.min ?? 0) + group.min
        if (group.max !== undefined) existing.max = (existing.max ?? 0) + group.max
      }
    }
  }
  return {
    add,
    finish: (): UsageCostRollup =>
      summarizeCostGroups([...groups.values()], catalogVersion, legacyRecords),
  }
}

export function summarizeCostGroups(
  groups: UsageCostGroup[],
  catalogVersion: string,
  legacyRecords = 0,
): UsageCostRollup {
  const result: UsageCostRollup = {
    catalogVersion,
    legacyRecords,
    totalRecords: 0,
    pricedRecords: 0,
    totalTokens: 0,
    pricedTokens: 0,
    vendorRecords: 0,
    totals: [],
    groups,
  }
  for (const group of groups) {
    result.totalRecords += group.records
    result.totalTokens += group.tokens
    if (group.identity.vendor !== 'unknown') result.vendorRecords += group.records
    if (
      group.status === 'unpriced' ||
      !group.currency ||
      group.min === undefined ||
      group.max === undefined
    )
      continue
    result.pricedRecords += group.records
    result.pricedTokens += group.tokens
    let total = result.totals.find((item) => item.currency === group.currency)
    if (!total) {
      total = { currency: group.currency, min: 0, max: 0 }
      result.totals.push(total)
    }
    total.min += group.min
    total.max += group.max
  }
  result.totals.sort((a, b) => a.currency.localeCompare(b.currency))
  result.groups.sort(
    (a, b) =>
      b.tokens - a.tokens || a.agent.localeCompare(b.agent) || a.model.localeCompare(b.model),
  )
  return result
}
