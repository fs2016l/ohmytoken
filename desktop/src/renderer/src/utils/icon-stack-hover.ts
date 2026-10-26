let activeDismiss: (() => void) | undefined

/** A window can have one expanded icon list and its own item tooltip. */
export function claimIconStackHover(dismiss: () => void): void {
  if (activeDismiss === dismiss) return
  const previous = activeDismiss
  activeDismiss = dismiss
  previous?.()
}

export function releaseIconStackHover(dismiss: () => void): void {
  if (activeDismiss === dismiss) activeDismiss = undefined
}
