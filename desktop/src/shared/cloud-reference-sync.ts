/** Normal checks for Cloud model prices and exchange rates share the same cadence. */
export const CLOUD_REFERENCE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Retry a failed exchange-rate check sooner without polling a healthy Cloud service. */
export const CLOUD_REFERENCE_RETRY_INTERVAL_MS = 5 * 60 * 1000
