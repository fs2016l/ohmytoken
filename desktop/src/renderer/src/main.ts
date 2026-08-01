import { createApp } from 'vue'
import type { DiagnosticErrorPayload } from '../../shared/diagnostics'
import './styles/fonts.css'
import './style.css'
import './composables/useTypography'
import App from './App.vue'
import router from './router'
import './styles/ui-layout.css'
import './styles/ui-agent.css'
import './styles/ui-token-plan.css'
import './styles/ui-insight-settings.css'
import './styles/ui-font-settings.css'
import './styles/ui-spacing.css'
import './styles/ui-typography.css'

const userAgent = navigator.userAgent.toLowerCase()
document.documentElement.dataset.platform = userAgent.includes('macintosh')
  ? 'macos'
  : userAgent.includes('windows')
    ? 'windows'
    : 'other'
document.documentElement.dataset.windowKind =
  new URLSearchParams(window.location.search).get('window') === 'floating' ? 'floating' : 'main'

function normalizeRendererError(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack }
  if (typeof reason === 'string') return { message: reason }
  try {
    return { message: JSON.stringify(reason) }
  } catch {
    return { message: String(reason) }
  }
}

function reportRendererFailure(
  reason: unknown,
  stage: string,
  context?: Record<string, unknown>,
): void {
  const normalized = normalizeRendererError(reason)
  const payload: DiagnosticErrorPayload = {
    reportType: 'renderer',
    source: 'renderer',
    stage,
    severity: 'error',
    summary: 'Agent 界面发生异常',
    message: normalized.message,
    stack: normalized.stack,
    context,
    occurredAt: Date.now(),
  }
  try {
    window.api.reportRendererError(payload)
  } catch {
    void 0
  }
}

window.addEventListener('error', (event) => {
  reportRendererFailure(event.error ?? event.message, 'window-error', {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  reportRendererFailure(event.reason, 'unhandled-rejection')
})

async function bootstrap(): Promise<void> {
  // 新项目不读取 renderer localStorage 中的历史明文 API Key。
  localStorage.removeItem('token-vendor-keys')

  const app = createApp(App)
  app.use(router)
  app.config.errorHandler = (error, _instance, info) => {
    reportRendererFailure(error, 'vue-error-handler', { info })
  }
  app.mount('#app')
}

void bootstrap()
