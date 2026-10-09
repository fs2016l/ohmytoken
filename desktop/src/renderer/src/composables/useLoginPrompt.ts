import { readonly, ref } from 'vue'
import { useAuth } from './useAuth'

const open = ref(false)
const busy = ref(false)
const failed = ref(false)
type LoginRequest = {
  start: () => Promise<void>
  result: Promise<void>
  resolve: () => void
}
let request: LoginRequest | undefined

function finish(): void {
  const current = request
  request = undefined
  open.value = false
  busy.value = false
  failed.value = false
  current?.resolve()
}

function cancel(): void {
  if (!busy.value) finish()
}

async function confirm(): Promise<void> {
  const current = request
  if (!current || busy.value) return
  busy.value = true
  failed.value = false
  try {
    await current.start()
    if (request === current) finish()
  } catch {
    if (request === current) failed.value = true
  } finally {
    if (request === current) busy.value = false
  }
}

/** Shared prompt for features requiring an account; opening it never starts browser login. */
export function useLoginPrompt() {
  const auth = useAuth()

  /** Only opens sign-in; it never records or replays the triggering feature action. */
  function requestLogin(): Promise<void> {
    if (auth.isLoggedIn.value) return Promise.resolve()
    if (request) return request.result
    let resolve!: LoginRequest['resolve']
    const result = new Promise<void>((done) => {
      resolve = done
    })
    request = { start: auth.login, result, resolve }
    failed.value = false
    open.value = true
    return result
  }

  return {
    open: readonly(open),
    busy: readonly(busy),
    failed: readonly(failed),
    requestLogin,
    confirm,
    cancel,
  }
}
