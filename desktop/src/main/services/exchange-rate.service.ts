import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { getAppDataDir } from '../lib/paths'
import { ExchangeRateStore } from '../cost/exchange-rates'
import { getAgentIdentityHeaders } from './client-registration.service'
import { getOhmytokenApiBase } from './server-config.service'
import { resolveDesktopApiUrl } from './runtime-config.service'
import type { ExchangeRateState } from '../../shared/cost-currency'

let store: ExchangeRateStore | undefined

function rateStore(): ExchangeRateStore {
  if (store) return store
  const base = getOhmytokenApiBase()
  const scope = createHash('sha256').update(base).digest('hex').slice(0, 16)
  const filename = `exchange-rates-com-${scope}.json`
  store = new ExchangeRateStore({
    url: () => resolveDesktopApiUrl('exchangeRates'),
    // 汇率接口已纳入设备凭证准入，请求必须携带身份头。
    headers: () => getAgentIdentityHeaders(null),
    read: async () => JSON.parse(await readFile(join(getAppDataDir(), filename), 'utf8')),
    write: async (cache) => {
      const directory = getAppDataDir()
      await mkdir(directory, { recursive: true })
      const destination = join(directory, filename)
      await writeFile(`${destination}.tmp`, JSON.stringify(cache), 'utf8')
      await rename(`${destination}.tmp`, destination)
    },
  })
  return store
}

export function getExchangeRates(refresh = false): Promise<ExchangeRateState> {
  return rateStore().get(refresh === true)
}
