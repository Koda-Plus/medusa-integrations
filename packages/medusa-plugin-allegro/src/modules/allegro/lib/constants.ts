/**
 * Constants of the Allegro module. ZERO IMPORTS on purpose: this file is
 * loaded by the unit tests through `node --test` with type stripping, without
 * a build.
 */

export const ALLEGRO_MODULE = "allegro"

/** The only row of `allegro_connection`. One Allegro seller account per store. */
export const CONNECTION_ID = "default"

/** Page size of `GET /sale/offers`. Allegro accepts 1 to 1000. */
export const OFFERS_PAGE_SIZE = 1000

/**
 * Hard ceiling for one offer read: 100 pages = 100 000 offers. A loop over
 * somebody else's API must have a limit. Hitting it marks the read incomplete.
 */
export const MAX_OFFER_PAGES = 100

/** Page size of `GET /order/checkout-forms`. Allegro accepts up to 100. */
export const ORDERS_PAGE_SIZE = 100

/** Ceiling for one order read: 50 pages = 5 000 orders changed since the last read. */
export const MAX_ORDER_PAGES = 50

/**
 * Orders are read by "updated since": the start of the last complete read
 * minus this overlap, so an order changed in the same second as the previous
 * read is never lost. Re-reading a few orders costs nothing, they are upserted.
 */
export const ORDERS_OVERLAP_MS = 10 * 60 * 1000

/** The first order read looks this many days back. */
export const ORDERS_FIRST_READ_DAYS = 7

/** Orders older than this (by purchase date) are pruned from the journal. */
export const ORDERS_KEEP_DAYS = 90

/**
 * Access tokens live 12 h. We refresh them this long before they expire.
 * After a refresh the OLD refresh token keeps working for 60 s only, which is
 * why refreshes are serialized and retried inside that window.
 */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000

/** Media type of the Allegro REST API, for Accept. */
export const MEDIA_TYPE = "application/vnd.allegro.public.v1+json"

/** Read scopes only. Nothing the plugin asks for can change the account. */
export const OFFERS_SCOPE = "allegro:api:sale:offers:read"
export const ORDERS_SCOPE = "allegro:api:orders:read"

/** Device flow grant type (RFC 8628). */
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

export const DEFAULT_REQUESTS_PER_MINUTE = 300
export const DEFAULT_TIMEOUT_MS = 20_000

/** Offers once an hour at :45 (OLX by Koda Plus runs at :30). */
export const OFFERS_SCHEDULE = "45 * * * *"

/** Orders every ten minutes. */
export const ORDERS_SCHEDULE = "*/10 * * * *"

/** How many runs of each kind we keep for the admin history. */
export const RUNS_TO_KEEP = 50

export const ALLEGRO_ENVIRONMENTS = {
  production: {
    auth: "https://allegro.pl/auth/oauth",
    api: "https://api.allegro.pl",
    web: "https://allegro.pl",
  },
  sandbox: {
    auth: "https://allegro.pl.allegrosandbox.pl/auth/oauth",
    api: "https://api.allegro.pl.allegrosandbox.pl",
    web: "https://allegro.pl.allegrosandbox.pl",
  },
} as const

export type AllegroEnvironment = keyof typeof ALLEGRO_ENVIRONMENTS

export interface AllegroUrls {
  /** Device code request: POST, `client_id` in the query. */
  device: string
  /** Token endpoint: device code, refresh. */
  token: string
  api: string
  web: string
  /** Page where the seller types the code. */
  link: string
}

export function isAllegroEnvironment(value: unknown): value is AllegroEnvironment {
  return value === "production" || value === "sandbox"
}

export function allegroUrls(env: AllegroEnvironment): AllegroUrls {
  const e = ALLEGRO_ENVIRONMENTS[env]
  return {
    device: `${e.auth}/device`,
    token: `${e.auth}/token`,
    api: e.api,
    web: e.web,
    link: `${e.web}/skojarz-aplikacje`,
  }
}

/** Public page of an offer. Allegro redirects the bare id to the full address. */
export function offerUrl(env: AllegroEnvironment, offerId: string): string {
  return `${ALLEGRO_ENVIRONMENTS[env].web}/oferta/${encodeURIComponent(offerId)}`
}
