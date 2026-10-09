import {
  AI_NETWORK_SERVICES,
  IP_QUALITY_SOURCES,
  type ExitObservation,
  type IpQualityResult,
  type IpRegistrationResult,
  type NetworkCheckSnapshot,
  type NetworkMode,
  type NetworkCheckTarget,
  type DnsObservation,
} from '../../shared/network-check'
import { emptyEndpoint } from './ai-probes'
import { inspectAiEndpoint } from './ai-inspection'
import { emptyIpQuality, ipQualityUrl, parseIpQuality } from './ip-quality'
import { emptyIpRegistration, ipRegistrationUrl, parseIpRegistration } from './ip-registration'
import { emptyDnsObservation, inspectDns } from './dns-observation'
import { inspectDnsGeolocation } from './dns-geolocation'
import { connectionIssue, isDnsProbeUrl, publicIp, safeDestination } from './policy'
import { parseObject, requestIssue, type NetworkFetcher, type ProbeResponse } from './protocol'

const endpoints = AI_NETWORK_SERVICES.flatMap((service) => service.endpoints)
const CACHE_MS = 10 * 60_000
const DEFAULT_RETRY_MS = 30_000

function retryDelay(header: string | undefined, now: number): number {
  const value = header?.trim()
  if (!value) return DEFAULT_RETRY_MS
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : /^[a-z]{3}[a-z ,]/i.test(value)
      ? Date.parse(value) - now
      : NaN
  return Number.isSafeInteger(delay) ? Math.max(0, delay) : DEFAULT_RETRY_MS
}

function emptyObservation(source: string): ExitObservation {
  return { state: 'pending', ip: null, source, route: 'unknown', issue: null }
}

function initialState(mode: NetworkMode = 'system'): NetworkCheckSnapshot {
  return {
    revision: 0,
    runId: 0,
    status: 'idle',
    cancelling: false,
    mode,
    startedAt: null,
    finishedAt: null,
    completed: 0,
    total: endpoints.length + IP_QUALITY_SOURCES.length + 3,
    exit: emptyObservation('IPinfo'),
    ipv6: emptyObservation('ipify IPv6'),
    dns: emptyDnsObservation(),
    registration: emptyIpRegistration(),
    sources: IP_QUALITY_SOURCES.map((item) => emptyIpQuality(item.id)),
    endpoints: endpoints.map((item) => emptyEndpoint(item.id)),
  }
}

interface EngineOptions {
  createFetcher: (mode: NetworkMode) => Promise<NetworkFetcher>
  onChange?: (snapshot: NetworkCheckSnapshot) => void
  now?: () => number
  storage?: {
    load: () => NetworkCheckSnapshot | null
    save: (snapshot: NetworkCheckSnapshot) => void
  }
}

/** 只在用户请求时运行；所有网络错误局限于单项检测，缓存不保存账号数据。 */
export class NetworkCheckEngine {
  private state = initialState()
  private controller: AbortController | null = null
  private running: Promise<void> | null = null
  private revision = 0
  private cache = new Map<string, IpQualityResult>()
  private registrationCache = new Map<string, IpRegistrationResult>()
  private cooldowns = new Map<string, { until: number; response: ProbeResponse }>()
  private readonly now: () => number
  private readonly options: EngineOptions

  constructor(options: EngineOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.state = options.storage?.load() ?? initialState()
    this.revision = this.state.revision
  }

  get(): NetworkCheckSnapshot {
    return structuredClone(this.state)
  }

  start(mode: NetworkMode, target: NetworkCheckTarget = 'all'): NetworkCheckSnapshot {
    if (mode !== 'system' && mode !== 'direct') throw new Error('Unsupported network mode')
    if (!['all', 'ip', 'dns', ...AI_NETWORK_SERVICES.map((service) => service.id)].includes(target))
      throw new Error('Unsupported network target')
    if (this.running) return this.get()
    const runId = this.state.runId + 1
    this.state = {
      ...(target === 'all' ? initialState(mode) : this.state),
      runId,
      mode,
      target,
      issue: null,
      status: 'running',
      cancelling: false,
      startedAt: this.now(),
      finishedAt: null,
      completed: 0,
      total:
        target === 'all'
          ? initialState().total
          : target === 'ip'
            ? IP_QUALITY_SOURCES.length + 2
            : target === 'dns'
              ? 1
              : AI_NETWORK_SERVICES.find((service) => service.id === target)!.endpoints.length,
    }
    this.controller = new AbortController()
    this.publish()
    this.running = (
      target === 'all'
        ? this.execute(this.controller.signal)
        : this.executeTarget(target, this.controller.signal)
    ).finally(() => {
      this.running = null
      this.controller = null
    })
    return this.get()
  }

  cancel(): NetworkCheckSnapshot {
    if (this.controller && this.state.status === 'running') {
      this.state.cancelling = true
      this.controller.abort('cancelled')
      this.publish()
    }
    return this.get()
  }

  async settled(): Promise<NetworkCheckSnapshot> {
    await this.running
    return this.get()
  }

  private publish(): void {
    this.state.revision = ++this.revision
    if (this.state.status === 'completed') this.options.storage?.save(this.get())
    this.options.onChange?.(this.get())
  }

  private protectedFetcher(
    fetch: NetworkFetcher,
    exitIp: () => string | null = () => this.state.exit.ip,
  ): NetworkFetcher {
    return async (url, signal) => {
      // 出口尚未确认时只在本轮复用，避免把旧网络的限流带到新出口。
      // DNS 的随机探测域名不能绕过同一来源已返回的 429。
      const sourceKey = isDnsProbeUrl(url)
        ? 'ipleak-dns'
        : new URL(url).hostname === 'api.ipquery.io'
          ? 'ipquery'
          : url
      const key = `${this.state.mode}:${exitIp() ?? `run-${this.state.runId}`}:${sourceKey}`
      const cooldown = this.cooldowns.get(key)
      if (cooldown && this.now() < cooldown.until) return { ...cooldown.response }
      this.cooldowns.delete(key)
      let response: ProbeResponse
      try {
        response = await fetch(url, signal)
      } catch (error) {
        return {
          url,
          destination: safeDestination(url),
          statusCode: null,
          headers: {},
          body: '',
          truncated: false,
          redirectStopped: false,
          elapsedMs: 0,
          route: 'unknown',
          issue: connectionIssue(error, signal),
        }
      }
      response = { ...response, observedAt: this.now() }
      if (response.statusCode === 429) {
        const receivedAt = this.now()
        response.retryAt = receivedAt + retryDelay(response.headers['retry-after'], receivedAt)
        this.cooldowns.set(key, {
          until: response.retryAt,
          response,
        })
        if (this.cooldowns.size > 64) this.cooldowns.delete(this.cooldowns.keys().next().value!)
      }
      return response
    }
  }

  private async discoverExit(fetch: NetworkFetcher, signal: AbortSignal): Promise<void> {
    this.state.exit.state = 'checking'
    this.state.sources[0].state = 'checking'
    this.publish()
    // 先观察出口，再应用按出口隔离的来源限流；重新体检始终能发现已切换的网络。
    const observation = await fetch('https://api.ipify.org/?format=json', signal)
    if (signal.aborted) return
    const observationIssue = requestIssue(observation)
    const observedIp = observationIssue ? null : publicIp(parseObject(observation.body).ip)
    if (observedIp) {
      this.state.exit = {
        state: 'done',
        ip: observedIp,
        source: 'ipify',
        route: observation.route,
        issue: null,
      }
      this.publish()
    }
    const response = await fetch('https://ipinfo.io/json', signal)
    const source = parseIpQuality('ipinfo', response, observedIp, response.observedAt ?? this.now())
    this.state.sources[0] = source
    if (!observedIp) {
      this.state.exit = {
        state: source.state,
        ip: source.ip,
        source: 'IPinfo',
        route: response.route,
        issue: source.issue,
      }
    }
    this.state.completed += 1
    this.publish()
  }

  private async inspectIpv6(fetch: NetworkFetcher, signal: AbortSignal): Promise<void> {
    this.state.ipv6.state = 'checking'
    this.publish()
    const response = await fetch('https://api6.ipify.org/?format=json', signal)
    const issue = requestIssue(response)
    const address = issue ? null : publicIp(parseObject(response.body).ip)
    const ip = address?.includes(':') ? address : null
    this.state.ipv6 = {
      state: ip ? 'done' : issue === 'cancelled' ? 'cancelled' : 'failed',
      ip,
      source: 'ipify IPv6',
      route: response.route,
      issue: issue ?? (ip ? null : 'invalid_response'),
    }
  }

  private async inspectSource(
    index: number,
    fetch: NetworkFetcher,
    signal: AbortSignal,
  ): Promise<void> {
    const id = this.state.sources[index].id
    const ip = this.state.exit.ip
    if (!ip) {
      this.state.sources[index] = { ...emptyIpQuality(id), state: 'failed', issue: 'no_ip' }
      return
    }
    const key = `${id}:${ip}`
    const cached = this.cache.get(key)
    if (cached?.observedAt != null && this.now() - cached.observedAt < CACHE_MS) {
      this.state.sources[index] = { ...structuredClone(cached), cached: true }
      return
    }
    this.state.sources[index].state = 'checking'
    this.publish()
    const response = await fetch(ipQualityUrl(id, ip), signal)
    const result = parseIpQuality(id, response, ip, response.observedAt ?? this.now())
    this.state.sources[index] = result
    if (result.state === 'done') {
      this.cache.set(key, structuredClone(result))
      if (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
    }
  }

  private async inspectRegistration(fetch: NetworkFetcher, signal: AbortSignal): Promise<void> {
    const ip = this.state.exit.ip
    if (!ip) {
      this.state.registration = { ...emptyIpRegistration(), state: 'failed', issue: 'no_ip' }
      return
    }
    const cached = this.registrationCache.get(ip)
    if (cached?.observedAt != null && this.now() - cached.observedAt < CACHE_MS) {
      this.state.registration = { ...structuredClone(cached), cached: true }
      return
    }
    this.state.registration.state = 'checking'
    this.publish()
    const response = await fetch(ipRegistrationUrl(ip), signal)
    const result = parseIpRegistration(response, ip, response.observedAt ?? this.now())
    this.state.registration = result
    if (result.state === 'done') {
      this.registrationCache.set(ip, structuredClone(result))
      if (this.registrationCache.size > 64)
        this.registrationCache.delete(this.registrationCache.keys().next().value!)
    }
  }

  private async inspectDns(
    fetch: NetworkFetcher,
    signal: AbortSignal,
    exit: ExitObservation,
    onProgress?: (dns: DnsObservation) => void,
  ): Promise<DnsObservation> {
    const result = await inspectDns(fetch, signal, this.now, onProgress)
    result.geolocation = { ...result.geolocation, state: 'checking', exit: { ...exit } }
    onProgress?.(structuredClone(result))
    result.geolocation = await inspectDnsGeolocation(result, exit, fetch, signal, this.now)
    return result
  }

  private async executeTarget(target: NetworkCheckTarget, signal: AbortSignal): Promise<void> {
    const timer = setTimeout(() => this.controller?.abort('timeout'), 60_000)
    try {
      let dnsExit = emptyObservation('ipify')
      const fetch = this.protectedFetcher(
        await this.options.createFetcher(this.state.mode),
        target === 'dns' ? () => dnsExit.ip : undefined,
      )
      const jobs: Array<() => Promise<void>> = []
      if (target === 'ip') {
        const empty = initialState(this.state.mode)
        this.state.exit = empty.exit
        this.state.ipv6 = empty.ipv6
        this.state.registration = empty.registration
        this.state.sources = empty.sources
        await this.discoverExit(fetch, signal)
        jobs.push(
          () => this.inspectIpv6(fetch, signal),
          () => this.inspectRegistration(fetch, signal),
        )
        jobs.push(
          ...IP_QUALITY_SOURCES.slice(1).map(
            (_, index) => () => this.inspectSource(index + 1, fetch, signal),
          ),
        )
      } else if (target === 'dns') {
        jobs.push(async () => {
          // DNS 重测单独采集当次公网出口，避免使用切换代理前的 IP 来源结果。
          const response = await fetch('https://api.ipify.org/?format=json', signal)
          const issue = requestIssue(response)
          const ip =
            issue || response.truncated || response.redirectStopped
              ? null
              : publicIp(parseObject(response.body).ip)
          dnsExit = {
            state: ip ? 'done' : issue === 'cancelled' ? 'cancelled' : 'failed',
            ip,
            source: 'ipify',
            route: response.route,
            issue: issue ?? (ip ? null : 'invalid_response'),
          }
          const result = await this.inspectDns(fetch, signal, dnsExit)
          if (signal.reason !== 'cancelled') this.state.dns = result
        })
      } else {
        const service = AI_NETWORK_SERVICES.find((item) => item.id === target)!
        jobs.push(
          ...service.endpoints.map((endpoint) => async () => {
            const result = await inspectAiEndpoint(endpoint, fetch, signal, this.now)
            // A cancelled retry must not erase the last completed observation.
            if (signal.reason !== 'cancelled') {
              const index = this.state.endpoints.findIndex((item) => item.id === endpoint.id)
              this.state.endpoints[index] = result
            }
          }),
        )
      }
      let cursor = 0
      await Promise.all(
        Array.from({ length: Math.min(4, jobs.length) }, async () => {
          while (cursor < jobs.length && !signal.aborted) {
            try {
              await jobs[cursor++]()
            } catch {
              this.state.issue = connectionIssue('', signal)
            }
            if (signal.reason !== 'cancelled') this.state.completed++
            this.publish()
          }
        }),
      )
    } catch {
      this.state.issue = connectionIssue('', signal)
    } finally {
      clearTimeout(timer)
      if (signal.aborted) this.state.issue = connectionIssue('', signal)
      if (target === 'ip') {
        for (const result of [
          this.state.exit,
          this.state.ipv6,
          this.state.registration,
          ...this.state.sources,
        ]) {
          if (result.state === 'checking' || result.state === 'pending') {
            result.issue = connectionIssue('', signal)
            result.state = signal.reason === 'cancelled' ? 'cancelled' : 'failed'
          }
        }
      }
      this.state.status = signal.reason === 'cancelled' ? 'cancelled' : 'completed'
      this.state.cancelling = false
      this.state.finishedAt = this.now()
      this.publish()
    }
  }

  private async execute(signal: AbortSignal): Promise<void> {
    const timer = setTimeout(() => this.controller?.abort('timeout'), 60_000)
    try {
      const fetch = this.protectedFetcher(await this.options.createFetcher(this.state.mode))
      await this.discoverExit(fetch, signal)
      const jobs: Array<() => Promise<void>> = [
        () => this.inspectIpv6(fetch, signal),
        () => this.inspectRegistration(fetch, signal),
        async () => {
          this.state.dns.state = 'checking'
          this.publish()
          this.state.dns = await this.inspectDns(fetch, signal, this.state.exit, (result) => {
            this.state.dns = result
            this.publish()
          })
        },
        ...IP_QUALITY_SOURCES.slice(1).map(
          (_, index) => () => this.inspectSource(index + 1, fetch, signal),
        ),
        ...endpoints.map((endpoint, index) => async () => {
          this.state.endpoints[index].state = 'checking'
          this.publish()
          this.state.endpoints[index] = await inspectAiEndpoint(endpoint, fetch, signal, this.now)
        }),
      ]
      let cursor = 0
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (cursor < jobs.length && !signal.aborted) {
            const job = jobs[cursor++]
            try {
              await job()
            } catch {
              /* 保留待处理状态，由末尾统一归为连接失败。 */
            }
            this.state.completed += 1
            this.publish()
          }
        }),
      )
    } catch {
      /* 创建传输层或查询出口失败时仍返回明确的部分结果。 */
    } finally {
      clearTimeout(timer)
      const issue = connectionIssue('', signal)
      for (const result of [
        this.state.exit,
        this.state.ipv6,
        this.state.dns,
        this.state.registration,
        ...this.state.sources,
        ...this.state.endpoints,
      ]) {
        if (result.state === 'pending' || result.state === 'checking') {
          result.state = issue === 'cancelled' ? 'cancelled' : 'failed'
          result.issue = issue
        }
      }
      this.state.status = signal.reason === 'cancelled' ? 'cancelled' : 'completed'
      this.state.cancelling = false
      this.state.finishedAt = this.now()
      this.state.completed = [
        this.state.ipv6,
        this.state.dns,
        this.state.registration,
        ...this.state.sources,
        ...this.state.endpoints,
      ].filter((result) => result.state === 'done' || result.state === 'failed').length
      this.publish()
    }
  }
}
