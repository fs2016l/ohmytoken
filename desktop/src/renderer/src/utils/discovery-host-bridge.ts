import {
  DISCOVERY_BRIDGE_CHANNEL,
  type DiscoveryHostContext,
  type DiscoveryRpcError,
} from '@shared/discovery-ui'

export interface DiscoveryOverlay {
  modal: boolean
  popovers: { x: number; y: number; width: number; height: number }[]
}
interface HostOptions {
  frame: () => HTMLIFrameElement | null
  origin: () => string | undefined
  context: () => DiscoveryHostContext
  execute: (operation: string, args: unknown) => Promise<unknown>
  ready: () => void
  failed: () => void
  overlay: (value: DiscoveryOverlay) => void
}
export function installDiscoveryHostBridge(options: HostOptions) {
  let nonce: string | undefined
  let disposed = false
  let inFlight = 0
  const ids = new Set<number>()
  function send(value: Record<string, unknown>, documentNonce = nonce): void {
    const origin = options.origin()
    if (disposed || !origin || !documentNonce || documentNonce !== nonce) return
    options
      .frame()
      ?.contentWindow?.postMessage({ channel: DISCOVERY_BRIDGE_CHANNEL, nonce, ...value }, origin)
  }
  function context(): void {
    if (nonce) send({ kind: 'context', context: options.context() })
  }
  async function receive(event: MessageEvent): Promise<void> {
    const message = event.data
    if (
      disposed ||
      !options.frame()?.contentWindow ||
      event.source !== options.frame()!.contentWindow ||
      event.origin !== options.origin() ||
      !message ||
      typeof message !== 'object' ||
      message.channel !== DISCOVERY_BRIDGE_CHANNEL ||
      typeof message.nonce !== 'string'
    )
      return
    if (message.kind === 'ready' && /^[a-f0-9-]{36}$/.test(message.nonce)) {
      nonce = message.nonce
      context()
      return
    }
    if (!nonce || message.nonce !== nonce) return
    if (message.kind === 'mounted') {
      options.ready()
      return
    }
    if (message.kind === 'failed') {
      options.failed()
      return
    }
    if (message.kind === 'overlay') {
      if (
        typeof message.modal !== 'boolean' ||
        !Array.isArray(message.popovers) ||
        message.popovers.length > 8
      )
        return
      if (
        message.popovers.some(
          (rect: Record<string, unknown>) =>
            !rect ||
            ['x', 'y', 'width', 'height'].some(
              (name) =>
                typeof rect[name] !== 'number' ||
                !Number.isFinite(rect[name]) ||
                Math.abs(Number(rect[name])) > 20000,
            ),
        )
      )
        return
      options.overlay({ modal: message.modal, popovers: message.popovers })
      return
    }
    if (
      message.kind !== 'request' ||
      !Number.isSafeInteger(message.id) ||
      message.id < 1 ||
      typeof message.operation !== 'string' ||
      ids.has(message.id)
    )
      return
    const documentNonce = nonce
    if (inFlight >= 64) {
      send({ kind: 'response', id: message.id, error: { message: 'Too many discovery requests' } })
      return
    }
    ids.add(message.id)
    inFlight++
    try {
      if (
        !message.args ||
        typeof message.args !== 'object' ||
        Array.isArray(message.args) ||
        JSON.stringify(message.args).length > 600000
      )
        throw new Error('Invalid discovery arguments')
      const value = await options.execute(message.operation, message.args)
      send({ kind: 'response', id: message.id, value }, documentNonce)
    } catch (error) {
      const source = error as { code?: unknown; status?: unknown; response?: { status?: unknown } }
      const status = source?.status ?? source?.response?.status
      const failure: DiscoveryRpcError = {
        message: error instanceof Error ? error.message.slice(0, 300) : 'Agent request unavailable',
        ...(typeof source?.code === 'string' ? { code: source.code.slice(0, 64) } : {}),
        ...(typeof status === 'number' ? { status } : {}),
      }
      send({ kind: 'response', id: message.id, error: failure }, documentNonce)
    } finally {
      inFlight--
      ids.delete(message.id)
    }
  }
  function outside(): void {
    send({ kind: 'dismiss-popovers' })
  }
  window.addEventListener('message', receive)
  document.addEventListener('pointerdown', outside, true)
  return {
    context,
    favorites: (value: unknown): void => send({ kind: 'favorites', value }),
    reset: (): void => {
      nonce = undefined
      options.overlay({ modal: false, popovers: [] })
    },
    dispose: (): void => {
      disposed = true
      window.removeEventListener('message', receive)
      document.removeEventListener('pointerdown', outside, true)
    },
  }
}
