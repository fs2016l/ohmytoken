import { DISCOVERY_CATALOG_KEYS, type DiscoveryCatalogRequest } from './discovery-ui'

const listKeys = new Set(['plans', 'apiModels', 'agents', 'articles'])
const detailKeys = new Set(['planTier', 'apiModel', 'agent', 'article'])
const textLimits: Record<string, number> = {
  keyword: 200,
  category: 128,
  section: 128,
  sort: 64,
  platforms: 512,
  forms: 512,
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid discovery request')
  return value as Record<string, unknown>
}

/** Remote pages can read the public catalog; they cannot choose a URL, headers or API scope. */
export function validateDiscoveryCatalog(value: unknown): DiscoveryCatalogRequest {
  const source = record(value)
  if (!DISCOVERY_CATALOG_KEYS.includes(source.key as DiscoveryCatalogRequest['key']))
    throw new Error('Unknown discovery catalog operation')
  const key = source.key as DiscoveryCatalogRequest['key']
  if (source.method !== 'GET' && !(source.method === 'POST' && listKeys.has(key)))
    throw new Error('Invalid discovery catalog method')
  const parameters = source.parameters === undefined ? {} : record(source.parameters)
  const needsId = detailKeys.has(key)
  if (
    Object.keys(parameters).some((name) => name !== 'id') ||
    (needsId
      ? !Number.isSafeInteger(parameters.id) || Number(parameters.id) <= 0
      : Object.keys(parameters).length > 0)
  )
    throw new Error('Invalid discovery catalog parameters')
  if (
    (source.method === 'GET' && source.body !== undefined) ||
    (source.method === 'POST' && source.query !== undefined)
  )
    throw new Error('Invalid discovery catalog payload')
  const input = source.method === 'GET' ? source.query : source.body
  const query: Record<string, string | number> = {}
  for (const [name, item] of Object.entries(input === undefined ? {} : record(input))) {
    if (item === undefined || item === null) continue
    if (
      (name === 'scope' &&
        key === 'discoveryConfig' &&
        ['agents', 'articles', 'comparison'].includes(String(item))) ||
      (name === 'lang' && (item === 'zh' || item === 'en')) ||
      (name === 'market' && (item === 'china' || item === 'global')) ||
      (name === 'direction' && (item === 'asc' || item === 'desc'))
    )
      query[name] = item as string
    else if (name === 'pageNum' || name === 'pageSize') {
      if (
        !listKeys.has(key) ||
        !Number.isSafeInteger(item) ||
        Number(item) < 1 ||
        Number(item) > (name === 'pageSize' ? 100 : 1_000_000)
      )
        throw new Error('Invalid discovery pagination')
      query[name] = item as number
    } else if (name === 'ids') {
      if (
        !listKeys.has(key) ||
        typeof item !== 'string' ||
        item.length > 170_000 ||
        !/^[1-9]\d*(?:,[1-9]\d*)*$/.test(item) ||
        item.split(',').length > 10000 ||
        item.split(',').some((id) => !Number.isSafeInteger(Number(id)))
      )
        throw new Error('Invalid discovery favorite selection')
      query[name] = item
    } else if (
      listKeys.has(key) &&
      textLimits[name] &&
      typeof item === 'string' &&
      item.length <= textLimits[name] &&
      !Array.from(item).some((character) => character.charCodeAt(0) < 32)
    )
      query[name] = item
    else throw new Error('Unknown discovery query field')
  }
  return {
    key,
    method: source.method,
    ...(needsId ? { parameters: { id: parameters.id as number } } : {}),
    ...(source.method === 'GET' ? { query } : { body: query }),
  }
}

/** Never expose workspace/session/settings browsing snapshots to a remote page. */
export function isDiscoveryBrowsingKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= 200 &&
    (/^discovery-(?:insights|agents)(?:-favorites)?$/.test(key) ||
      /^discovery-plans(?:-favorites)?(?:-v2)?$/.test(key) ||
      /^discovery-(?:article-navigation-v2|favorite-intent)$/.test(key) ||
      /^(?:article(?:-v2)?|agent-tool):\d+(?::(?:zh|en))?$/.test(key))
  )
}
