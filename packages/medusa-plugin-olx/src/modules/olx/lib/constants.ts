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

/** OAuth scope. `read` is enough to list adverts; we never ask for more. */
export const OAUTH_SCOPE = "read v2"

/** Version header required by the OLX Partner API. */
export const API_VERSION = "2.0"

export const DEFAULT_REQUESTS_PER_MINUTE = 200
export const DEFAULT_TIMEOUT_MS = 20_000

/** Cron of the scheduled sync: every hour at :30. */
export const SYNC_SCHEDULE = "30 * * * *"

/** How many sync runs we keep for the admin history. */
export const RUNS_TO_KEEP = 50

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

export interface OlxUrls {
  host: string
  authorize: string
  token: string
  api: string
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
