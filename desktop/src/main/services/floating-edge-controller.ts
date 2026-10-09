import type { BrowserWindow } from 'electron'
import { FLOATING_EDGE_MOTION_MS, type FloatingEdgeState } from '../../shared/floating-window'
import {
  containsPoint,
  dockEdge,
  edgeClip,
  edgeStrip,
  fitEdgeBounds,
  hiddenEdgeBounds,
  type EdgeBounds,
  type EdgePoint,
} from './floating-edge-geometry'

interface EdgeDisplay {
  id: number
  workArea: EdgeBounds
}
interface EdgeOptions {
  enabled: boolean
  display: (bounds: EdgeBounds) => EdgeDisplay
  displays: () => EdgeDisplay[]
  cursor: () => EdgePoint
  changed: (state: FloatingEdgeState) => void
  restoreLimits: () => void
  now?: () => number
  reducedMotion?: () => boolean
  inset?: () => number
  platform?: NodeJS.Platform
  compositorMotion?: boolean
}

/** Slide one unchanged surface; transparent Windows use compositor-only transforms. */
export class FloatingEdgeController {
  private window: BrowserWindow
  private options: EdgeOptions
  private state: FloatingEdgeState
  private normal: EdgeBounds
  private area: EdgeBounds
  private visibleStrip: EdgeBounds | null = null
  private displayId: number | null = null
  private internal = false
  private pendingMove = false
  private movedAt = 0
  private leaveSince: number | null = null
  private interacting = false
  private timer: ReturnType<typeof setInterval> | undefined
  private animationTimer: ReturnType<typeof setInterval> | undefined
  private animationStartedAt = 0
  private animationFrom: EdgeBounds
  private animationTo: EdgeBounds
  private motionId = 0

  constructor(window: BrowserWindow, options: EdgeOptions) {
    this.window = window
    this.options = options
    // macOS prevents native windows from moving above the menu bar. Keep the same
    // surface there too, translating the renderer in a fixed virtual viewport.
    this.state = {
      enabled: options.enabled,
      edge: null,
      hidden: false,
      nativeMotion:
        !options.compositorMotion && (options.platform ?? process.platform) !== 'darwin',
    }
    this.normal = window.getBounds()
    this.animationFrom = this.animationTo = this.normal
    this.area = options.display(this.normal).workArea
    window.on('will-move', this.manualMove)
    window.on('resized', this.resized)
    if (options.enabled && dockEdge(this.normal, this.area)) this.manualMove()
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
  private get inset(): number {
    return this.options.inset?.() ?? 0
  }
  get snapshot(): FloatingEdgeState {
    return { ...this.state, ...(this.state.viewport && { viewport: { ...this.state.viewport } }) }
  }
  get adjusting(): boolean {
    return this.internal || this.state.hidden || !!this.state.transition
  }
  private publish(): void {
    this.options.changed(this.snapshot)
  }
  private poll(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(), 100)
      this.timer.unref()
    }
  }
  private stop(): void {
    clearInterval(this.timer)
    this.timer = undefined
  }
  private place(bounds: EdgeBounds): void {
    this.internal = true
    try {
      this.window.setBounds(bounds)
    } finally {
      this.internal = false
    }
  }
  private placeNative(bounds: EdgeBounds, hidden = false): void {
    const clip = edgeClip(bounds, hidden && this.visibleStrip ? this.visibleStrip : this.area)
    const previous = edgeClip(this.window.getBounds(), this.area)
    const x = Math.max(previous.x, clip.x),
      y = Math.max(previous.y, clip.y)
    // Narrow before moving, widen afterwards: neither direction can paint on the
    // adjacent monitor between SetWindowRgn and SetWindowPos.
    this.window.setShape?.([
      {
        x,
        y,
        width: Math.max(0, Math.min(previous.x + previous.width, clip.x + clip.width) - x),
        height: Math.max(0, Math.min(previous.y + previous.height, clip.y + clip.height) - y),
      },
    ])
    this.place(bounds)
    this.window.setShape?.([clip])
  }
  private setViewport(hidden = false): void {
    if (this.state.nativeMotion) return
    const bounds =
      hidden && this.visibleStrip && !this.options.compositorMotion
        ? this.visibleStrip
        : this.normal
    this.state.viewport = {
      width: this.normal.width,
      height: this.normal.height,
      x: bounds.x - this.normal.x,
      y: bounds.y - this.normal.y,
    }
  }
  private placeHidden(): void {
    if (!this.state.edge) return
    this.visibleStrip = edgeStrip(this.normal, this.state.edge, this.inset)
    if (this.options.compositorMotion) {
      // Keep the native viewport fixed. Clip input/paint once, after the renderer
      // confirms its final frame, instead of moving/reclipping the HWND each frame.
      this.place(this.normal)
      this.window.setShape([edgeClip(this.normal, this.visibleStrip)])
      this.setViewport()
    } else if (this.state.nativeMotion) {
      this.placeNative(hiddenEdgeBounds(this.normal, this.state.edge, this.inset), true)
    } else {
      this.window.setMinimumSize(1, 1)
      this.window.setMaximumSize(900, 1100)
      this.place(this.visibleStrip)
      this.setViewport(true)
    }
  }
  private manualMove = (): void => {
    if (!this.state.enabled || this.internal || this.state.hidden) return
    if (this.state.transition) this.reveal(false)
    this.pendingMove = true
    this.movedAt = this.now()
    this.leaveSince = null
    this.poll()
  }
  private resized = (): void => {
    if (!this.adjusting && this.state.edge) this.reanchor()
  }

  setEnabled(enabled: boolean): FloatingEdgeState {
    if (!enabled) {
      this.reveal(false)
      this.state.edge = null
      this.pendingMove = false
      this.stop()
    }
    this.state.enabled = enabled
    if (
      enabled &&
      dockEdge(this.window.getBounds(), this.options.display(this.window.getBounds()).workArea)
    )
      this.manualMove()
    this.publish()
    return this.snapshot
  }
  setInteracting(value: boolean): void {
    this.interacting = value
    this.leaveSince = null
    if (value && this.state.transition === 'hiding') this.reveal()
  }
  reanchor(): void {
    if (this.adjusting || !this.state.edge) return
    const bounds = this.window.getBounds(),
      display = this.options.display(bounds)
    this.displayId = display.id
    this.area = display.workArea
    this.normal = fitEdgeBounds(bounds, this.area, this.state.edge)
    if (bounds.x !== this.normal.x || bounds.y !== this.normal.y) this.place(this.normal)
  }

  tick(): void {
    if (!this.state.enabled || this.window.isDestroyed() || !this.window.isVisible()) return
    const now = this.now()
    if (this.state.transition) {
      if (
        this.state.transition === 'hiding' &&
        (this.interacting || containsPoint(this.normal, this.options.cursor()))
      )
        this.reveal()
      else this.advanceAnimation(now)
      return
    }
    if (this.pendingMove) {
      if (now - this.movedAt < 250) return
      this.pendingMove = false
      const bounds = this.window.getBounds(),
        display = this.options.display(bounds)
      this.area = display.workArea
      this.state.edge = dockEdge(bounds, this.area)
      this.displayId = display.id
      this.normal = fitEdgeBounds(bounds, this.area, this.state.edge)
      if (this.state.edge) this.place(this.normal)
      else this.stop()
      this.publish()
    }
    if (!this.state.edge) return
    const inside = containsPoint(
      this.state.hidden && this.visibleStrip ? this.visibleStrip : this.window.getBounds(),
      this.options.cursor(),
    )
    if (this.state.hidden) {
      // Renderer mouseenter normally reveals immediately; polling is a fallback
      // for native clipping changes that do not deliver a new pointer event.
      if (inside) this.reveal()
      return
    }
    if (inside || this.interacting) this.leaveSince = null
    else {
      this.leaveSince ??= now
      if (now - this.leaveSince >= 500) this.hide()
    }
  }
  private hide(): void {
    if (!this.state.edge) return
    this.reanchor()
    if (this.state.nativeMotion || this.options.compositorMotion) {
      // Keep native frame metrics stable during the slide. Lock resizing through
      // size constraints instead of toggling the Windows frame style mid-animation.
      this.window.setMinimumSize(this.normal.width, this.normal.height)
      this.window.setMaximumSize(this.normal.width, this.normal.height)
    } else this.window.setResizable(false)
    this.setViewport()
    if (this.options.reducedMotion?.()) this.finishHide()
    else this.animate('hiding')
  }
  private animate(transition: 'hiding' | 'revealing'): void {
    clearInterval(this.animationTimer)
    this.state.transition = transition
    this.state.motionDuration = FLOATING_EDGE_MOTION_MS
    if (this.options.compositorMotion) this.state.motionId = ++this.motionId
    this.animationStartedAt = this.now()
    this.animationFrom = this.window.getBounds()
    this.animationTo =
      transition === 'hiding' && this.state.edge
        ? hiddenEdgeBounds(this.normal, this.state.edge, this.inset)
        : this.normal
    this.publish()
    // The existing hover poll also handles the renderer watchdog. No native frame
    // timer competes with Chromium's compositor in this mode.
    if (this.options.compositorMotion) return
    this.animationTimer = setInterval(() => this.tick(), this.state.nativeMotion ? 16 : 32)
    this.animationTimer.unref()
  }
  private advanceAnimation(now: number): void {
    const duration = this.state.motionDuration ?? FLOATING_EDGE_MOTION_MS
    if (this.options.compositorMotion) {
      // A stalled/crashed renderer must leave a usable window, never clip early.
      if (now - this.animationStartedAt > duration + 1500) this.reveal(false)
      return
    }
    const progress = Math.min(1, Math.max(0, (now - this.animationStartedAt) / duration))
    if (this.state.nativeMotion) {
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
      this.placeNative({
        ...this.normal,
        x: Math.round(this.animationFrom.x + (this.animationTo.x - this.animationFrom.x) * eased),
        y: Math.round(this.animationFrom.y + (this.animationTo.y - this.animationFrom.y) * eased),
      })
    }
    if (now - this.animationStartedAt < duration + (this.state.nativeMotion ? 0 : 32)) return
    if (this.state.transition === 'hiding') this.finishHide()
    else this.finishReveal()
  }
  private clearAnimation(): void {
    clearInterval(this.animationTimer)
    this.animationTimer = undefined
    delete this.state.transition
    delete this.state.motionDuration
    delete this.state.motionId
  }
  completeMotion(id: number): void {
    if (!this.options.compositorMotion || id !== this.state.motionId) return
    if (this.state.transition === 'hiding') this.finishHide()
    else if (this.state.transition === 'revealing') this.finishReveal()
  }
  private finishHide(): void {
    this.clearAnimation()
    this.state.hidden = true
    this.placeHidden()
    this.publish()
  }
  private finishReveal(): void {
    this.place(this.normal)
    if (this.state.nativeMotion || this.options.compositorMotion) this.window.setShape?.([])
    this.options.restoreLimits()
    if (!this.state.nativeMotion && !this.options.compositorMotion) this.window.setResizable(true)
    this.clearAnimation()
    delete this.state.viewport
    this.visibleStrip = null
    this.publish()
  }
  reveal(animate = true): void {
    this.leaveSince = null
    if (this.state.transition === 'revealing' && animate) return
    if (!this.state.hidden && !this.state.transition) return
    if (this.state.hidden) {
      if (this.options.compositorMotion) this.window.setShape([])
      else if (!this.state.nativeMotion) this.place(this.normal)
      this.window.showInactive()
    }
    this.state.hidden = false
    this.setViewport()
    if (animate && !this.options.reducedMotion?.()) this.animate('revealing')
    else this.finishReveal()
  }
  displaysChanged(): void {
    if (this.window.isDestroyed()) return
    if (this.state.transition) this.reveal(false)
    const available = this.options.displays()
    if (!available.length) return
    const display = available.find((item) => item.id === this.displayId)
    if (!display) {
      this.reveal(false)
      this.state.edge = null
      this.stop()
    }
    this.area = (display ?? this.options.display(this.normal)).workArea
    this.normal = fitEdgeBounds(
      this.state.hidden ? this.normal : this.window.getBounds(),
      this.area,
      this.state.edge,
    )
    if (this.state.hidden && this.state.edge) this.placeHidden()
    else this.place(this.normal)
    this.publish()
  }
  dispose(): void {
    this.clearAnimation()
    this.stop()
    this.window.removeListener('will-move', this.manualMove)
    this.window.removeListener('resized', this.resized)
  }
}
