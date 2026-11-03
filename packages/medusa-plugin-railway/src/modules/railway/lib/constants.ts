/**
 * Constants of the Railway module. NO RUNTIME IMPORTS on purpose: the unit
 * tests load this file through `node --test` with type stripping, without a
 * build, and every pure module (and the admin bundle) may read it.
 */

/**
 * Container key of the module: `container.resolve(RAILWAY_MODULE)`. With our
 * prefix, so it never collides with a store's own `railway` module.
 */
export const RAILWAY_MODULE = "koda_railway"

/** Railway's public GraphQL API v2, the only host the plugin calls. */
export const RAILWAY_API_URL = "https://backboard.railway.com/graphql/v2"

/** Railway's dashboard; links to services and deployments start here. */
export const DEFAULT_DASHBOARD_URL = "https://railway.com"

/** The environment variable the token is read from by default. */
export const DEFAULT_TOKEN_ENV = "RAILWAY_READ_TOKEN"

/** Whole reads (the overview) stay cached this long by default (seconds). */
export const DEFAULT_CACHE_SECONDS = 60
export const MIN_CACHE_SECONDS = 15
export const MAX_CACHE_SECONDS = 3_600

/** A forced refresh within this time of the last read is served from the cache. */
export const FORCE_REFRESH_MIN_MS = 15_000

/** A failed read is remembered this long, so a wrong token does not hammer Railway. */
export const ERROR_CACHE_MS = 60_000

/** The identity behind a token (project and environment) changes rarely: kept an hour. */
export const IDENTITY_CACHE_MS = 60 * 60 * 1000

/**
 * Railway's limits are per account: 100 requests an hour on Free, 1 000 on
 * Hobby (10 a second), 10 000 on Pro. The plugin keeps to a small share of
 * them: a token bucket per second and a budget per hour.
 */
export const DEFAULT_REQUESTS_PER_SECOND = 2
export const MAX_REQUESTS_PER_SECOND = 10
export const DEFAULT_REQUESTS_PER_HOUR = 300
export const MAX_REQUESTS_PER_HOUR = 5_000

export const DEFAULT_TIMEOUT_MS = 15_000
export const MIN_TIMEOUT_MS = 2_000
export const MAX_TIMEOUT_MS = 60_000

/** Retries of one request after a 429, a 5xx or a network error. */
export const MAX_RETRIES = 1
export const MAX_RETRY_WAIT_MS = 5_000

/** Deployments per service in the history. */
export const DEPLOYMENTS_LIMIT = 20

/** Log lines one read asks for, and the most a route accepts. */
export const DEFAULT_LOG_LINES = 300
export const MAX_LOG_LINES = 1_000

/** Lines read per service for the error counter of the last hour. */
export const ERROR_SCAN_LINES = 1_000
export const ERROR_SCAN_MINUTES = 60

/** Problem thresholds. */
export const MEMORY_WARN_PCT = 85
export const MEMORY_RED_PCT = 95
export const VOLUME_WARN_PCT = 85
export const VOLUME_RED_PCT = 95
export const ERRORS_WARN = 20
export const ERRORS_RED = 100

/** Board counters reuse a read this long, even when `cacheSeconds` is shorter. */
export const COUNTER_MAX_AGE_SECONDS = 900

/** Metric ranges of the panel, with the sample rate that keeps a chart under about 100 points. */
export const METRIC_RANGES = {
  "1h": { minutes: 60, sampleSeconds: 60 },
  "6h": { minutes: 360, sampleSeconds: 300 },
  "24h": { minutes: 1_440, sampleSeconds: 900 },
} as const

/** Most points one series sends to the browser. */
export const MAX_POINTS = 240

/** Log windows the panel offers, in minutes (0: the newest lines, whatever their age). */
export const LOG_WINDOWS = [15, 60, 360, 0] as const
