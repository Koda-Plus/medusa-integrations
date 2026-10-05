/**
 * Constants of the OLX module. ZERO IMPORTS on purpose: this file is loaded
 * by the unit tests through `node --test` with type stripping, without a build.
 */

export const OLX_MODULE = "olx"

/** The only row of `olx_connection`. One OLX seller account per store. */
export const CONNECTION_ID = "default"

/** Page size of `GET /adverts`. The Partner API accepts up to 50. */
export const PAGE_SIZE = 50

/**
 * Hard ceiling for one read: 100 pages = 5 000 adverts. A loop over somebody
 * else's API must have a limit. Hitting it marks the read as incomplete.
 */
export const MAX_PAGES = 100

/** Access tokens live 24 h. We refresh them this long before they expire. */
export const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000

/** How long the `state` nonce of a connection attempt stays valid. */
export const STATE_TTL_MS = 15 * 60 * 1000

/**
 * OAuth scopes. `read` lists adverts, statistics and threads; `write` is
 * requested only when a writer is allowed in the options (`lifecycleWriter`,
 * `priceWriter`, `publishWriter`). Documented scopes: `v2`, `read`, `write`.
 */
export const OAUTH_SCOPE_READ = "read v2"
export const OAUTH_SCOPE_WRITE = "read write v2"

/** @deprecated Kept for code written against 0.1.0. Use `OAUTH_SCOPE_READ`. */
export const OAUTH_SCOPE = OAUTH_SCOPE_READ

/** Version header required by the OLX Partner API. */
export const API_VERSION = "2.0"

export const DEFAULT_REQUESTS_PER_MINUTE = 200
export const DEFAULT_TIMEOUT_MS = 20_000

/** Cron of the scheduled sync: every hour at :30. */
export const SYNC_SCHEDULE = "30 * * * *"

/** Alerts and plans from the snapshot and the Medusa catalog, no OLX request for adverts. */
export const PLAN_SCHEDULE = "5,20,35,50 * * * *"

/** Advert statistics: one request per advert, so once an hour and capped. */
export const STATS_SCHEDULE = "45 * * * *"

/** Message threads: unread counts change often, the read is a few requests. */
export const THREADS_SCHEDULE = "10,25,40,55 * * * *"

/** How many sync runs we keep for the admin history. */
export const RUNS_TO_KEEP = 50

/** How many writer runs we keep per writer. */
export const WRITER_RUNS_TO_KEEP = 30

/** Statistics of one advert are refreshed at most this often. */
export const STATS_MIN_AGE_MS = 6 * 60 * 60 * 1000
export const DEFAULT_STATS_PER_RUN = 200

/** Threads: page size asked for, and the ceiling of one read. */
export const THREADS_PAGE_SIZE = 50
export const THREADS_MAX_PAGES = 40

/** Writers: default caps of one run. */
export const DEFAULT_MAX_LIFECYCLE_PER_RUN = 20
export const DEFAULT_MAX_PRICE_PER_RUN = 20
export const DEFAULT_MAX_PUBLISH_PER_RUN = 5

/** Consecutive failures of one item before it is quarantined. */
export const QUARANTINE_AFTER = 3

/** A claimed item holds this lease. Expired, it becomes `unknown` and is looked up first. */
export const LEASE_MS = 10 * 60 * 1000

/** An unknown create is retried only when a lookup this long after it still finds nothing. */
export const UNKNOWN_GRACE_MS = 15 * 60 * 1000

/**
 * The lifecycle mass guard: a plan that would end more than this many adverts
 * at once (the larger of the two numbers) is held for a person. A stock import
 * in progress or a wrong stock location looks exactly like "everything sold out".
 */
export const MASS_GUARD_MIN = 10
export const MASS_GUARD_SHARE = 0.25

/** Price changes larger than this (percent) wait for a person. */
export const DEFAULT_MAX_PRICE_CHANGE_PERCENT = 50

/**
 * OLX blocks an IP for 30 minutes after 4 500 requests in 5 minutes and
 * answers 403 meanwhile (developer.olx.pl, "Częste pytania", point 11).
 */
export const BLOCK_PAUSE_MS = 30 * 60 * 1000

/** Category definitions read from OLX are reused this long. */
export const CATEGORY_CACHE_MS = 24 * 60 * 60 * 1000

/** Demo writes (and toggles) older than this are reset, so the shared demo stays a story. */
export const DEMO_RESET_MS = 24 * 60 * 60 * 1000

/** Bumped when the demo generator changes, so the demo snapshot is rebuilt once. */
export const DEMO_GENERATOR_VERSION = "0.2.0"

/* Live and limited statuses live in `matching.ts`, next to the rule that uses them. */

/**
 * OLX markets running the same Partner API v2. Verified in production on
 * OLX.pl; the other hosts are supported by configuration.
 */
export const OLX_MARKETS = {
  pl: "www.olx.pl",
  ro: "www.olx.ro",
  pt: "www.olx.pt",
  bg: "www.olx.bg",
  ua: "www.olx.ua",
  kz: "www.olx.kz",
  uz: "www.olx.uz",
} as const

export type OlxMarket = keyof typeof OLX_MARKETS

/** Currency of advert prices per market, lowercase as Medusa stores currency codes. */
export const MARKET_CURRENCY: Record<OlxMarket, string> = {
  pl: "pln",
  ro: "ron",
  pt: "eur",
  bg: "eur",
  ua: "uah",
  kz: "kzt",
  uz: "uzs",
}

export interface OlxUrls {
  host: string
  authorize: string
  token: string
  api: string
  /** The seller's chat inbox on the OLX website (the "Czat" link in the header of olx.pl and olx.ro). */
  chat: string
}

export function isOlxMarket(value: unknown): value is OlxMarket {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(OLX_MARKETS, value)
}

export function olxUrls(market: OlxMarket): OlxUrls {
  const host = OLX_MARKETS[market]
  return {
    host,
    authorize: `https://${host}/oauth/authorize/`,
    token: `https://${host}/api/open/oauth/token`,
    api: `https://${host}/api/partner`,
    chat: `https://${host}/myaccount/answers/`,
  }
}

/**
 * Where the SKU hides in an advert description when `external_id` is empty.
 * One capture group, matched case-insensitively. "Kod produktu" is the line
 * Polish sellers (and BaseLinker templates) put in descriptions.
 */
export const DEFAULT_SKU_PATTERNS: readonly string[] = [
  "(?:Kod\\s+produktu|Product\\s+code|SKU)\\s*:\\s*([^\\n\\r]{1,40})",
]

/** The three writers. Each one is OFF until both switches say yes. */
export const WRITERS = ["lifecycle", "price", "publish"] as const
export type WriterKey = (typeof WRITERS)[number]

export function isWriterKey(value: unknown): value is WriterKey {
  return typeof value === "string" && (WRITERS as readonly string[]).includes(value)
}
