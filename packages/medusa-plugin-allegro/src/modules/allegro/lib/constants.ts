/**
 * Constants of the Allegro module. ZERO IMPORTS on purpose: this file is
 * loaded by the unit tests through `node --test` with type stripping, without
 * a build.
 *
 * Every Allegro fact below is verified in the official documentation; the
 * sources are listed in `docs/allegro-api-notes.md`.
 */

export const ALLEGRO_MODULE = "allegro"

/** Version of the plugin, part of the User-Agent Allegro asks for. */
export const PLUGIN_VERSION = "0.2.0"

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
 * why refreshes are serialized (inside a process by a queue, across
 * processes by a lease on the connection row) and retried inside that window.
 */
export const REFRESH_MARGIN_MS = 10 * 60 * 1000

/** How long one process may hold the refresh lease of the connection row. */
export const REFRESH_LEASE_MS = 45_000

/** Media type of the Allegro REST API, for Accept and Content-Type. */
export const MEDIA_TYPE = "application/vnd.allegro.public.v1+json"

/** Beta resources (customer returns, post-purchase issues) answer only this one. */
export const BETA_MEDIA_TYPE = "application/vnd.allegro.beta.v1+json"

/* ------------------------------------------------------------------ */
/* Scopes (verified per operation in the official OpenAPI file)        */
/* ------------------------------------------------------------------ */

/** Offers: list, catalog products. */
export const OFFERS_SCOPE = "allegro:api:sale:offers:read"
/** Quantity, price and publication commands, new product offers. */
export const OFFERS_WRITE_SCOPE = "allegro:api:sale:offers:write"
/** Orders, order events, parcels list, invoices list, customer returns. */
export const ORDERS_SCOPE = "allegro:api:orders:read"
/** Parcels, seller status, invoice files. */
export const ORDERS_WRITE_SCOPE = "allegro:api:orders:write"
/** Post-purchase issues. There is no read-only variant of this scope. */
export const DISPUTES_SCOPE = "allegro:api:disputes"
/** Message threads. There is no read-only variant of this scope. */
export const MESSAGING_SCOPE = "allegro:api:messaging"

/** Device flow grant type (RFC 8628). */
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code"

export const DEFAULT_REQUESTS_PER_MINUTE = 300
export const DEFAULT_TIMEOUT_MS = 20_000

/* ------------------------------------------------------------------ */
/* Schedules                                                           */
/* ------------------------------------------------------------------ */

/** Offers once an hour at :45 (OLX by Koda Plus runs at :30). */
export const OFFERS_SCHEDULE = "45 * * * *"

/** Orders every ten minutes. */
export const ORDERS_SCHEDULE = "*/10 * * * *"

/** Stock plan (and the push when armed) every fifteen minutes. */
export const STOCK_SCHEDULE = "7-59/15 * * * *"

/** Price plan (and the push when armed) once an hour, after the offer sync. */
export const PRICES_SCHEDULE = "52 * * * *"

/** Order import: the event journal every two minutes. */
export const IMPORT_SCHEDULE = "*/2 * * * *"

/** Parcels and seller status every five minutes. */
export const SHIPPING_SCHEDULE = "1-59/5 * * * *"

/** Invoices: their own sweep, every five minutes, never riding the order import. */
export const INVOICES_SCHEDULE = "3-59/5 * * * *"

/** Customer issues (returns, disputes, claims, unread messages) twice an hour. */
export const ISSUES_SCHEDULE = "20,50 * * * *"

/** Publish by EAN: the plan once an hour. */
export const PUBLISH_SCHEDULE = "57 * * * *"

/** How many runs of each kind we keep for the admin history. */
export const RUNS_TO_KEEP = 50

/* ------------------------------------------------------------------ */
/* Writers                                                             */
/* ------------------------------------------------------------------ */

/** Consecutive systemic failures after which a writer disarms itself. */
export const DEFAULT_BREAKER_THRESHOLD = 5

/** Failed attempts of one item (an offer, an order, a parcel) before it is quarantined. */
export const QUARANTINE_AFTER = 3

/** Offers one stock run may change. */
export const DEFAULT_STOCK_CAP = 50

/** Offers one price run may change. */
export const DEFAULT_PRICE_CAP = 20

/** Draft offers one publish run may create. */
export const DEFAULT_PUBLISH_CAP = 5

/** A planned price change bigger than this share of the current price is refused. */
export const DEFAULT_MAX_PRICE_CHANGE_PERCENT = 30

/** Allegro: "Set of offers. You can add up to 1000 offers." per command criterion. */
export const COMMAND_MAX_OFFERS = 1000

/** Offers re-read by `offer.id` in one request before a command. */
export const REREAD_CHUNK = 50

/** How long the plugin waits for a command report before it reads the tasks anyway. */
export const COMMAND_POLL_ATTEMPTS = 6
export const COMMAND_POLL_INTERVAL_MS = 1500

/** Orders one import run creates at most. */
export const DEFAULT_IMPORT_PER_RUN = 25

/** Lease of one import attempt, and of one outbox item. */
export const IMPORT_LEASE_MS = 5 * 60 * 1000
export const OUTBOX_LEASE_MS = 3 * 60 * 1000

/** A run lease (one stock or price run across processes). */
export const RUN_LEASE_MS = 10 * 60 * 1000

/** Order events read per page. Allegro accepts 1 to 1000. */
export const EVENTS_PAGE_SIZE = 100

/** Event pages one import run reads at most. */
export const MAX_EVENT_PAGES = 20

/** Allegro keeps order events for 60 days ("Możesz pobrać zdarzenia z ostatnich 60 dni"). */
export const EVENT_RETENTION_DAYS = 60

/** A form not ready for processing after this long is skipped. */
export const NOT_READY_GIVE_UP_DAYS = 7

/** Import attempts that fail on an unexpected error before the form is held for a person. */
export const IMPORT_MAX_ATTEMPTS = 5

/** Outbox attempts before an item needs a person. */
export const OUTBOX_MAX_ATTEMPTS = 6

/** The operator import window reads at most this many checkout forms. */
export const WINDOW_MAX_FORMS = 3000
export const WINDOW_MAX_DAYS = 62

/** Allegro: "The file is too large. Max file size is 3MB". */
export const INVOICE_MAX_BYTES = 3 * 1024 * 1024

/** Invoice kinds attached by default. Proformas are not tax documents. */
export const DEFAULT_INVOICE_KINDS = ["vat", "correction"] as const

/** Unread threads are counted among this many newest threads (5 pages of 20). */
export const THREADS_SCANNED = 100

/** Order metadata key shared with other integrations (BaseLinker writes the same key). */
export const MARKETPLACE_REF_KEY = "marketplace_order_ref"

export function marketplaceRef(checkoutFormId: string): string {
  return `allegro:${checkoutFormId}`
}

/**
 * The lock every Koda Plus importer of a marketplace order takes through the
 * Medusa Locking module before it looks the reference up and creates the
 * order (BaseLinker uses the same key), so two plugins never both create it.
 */
export function refLockKey(ref: string): string {
  return `marketplace-order-ref:${ref}`
}

/** How long a reference lock lives if its process dies (seconds). */
export const REF_LOCK_SECONDS = 300

/** Name of the sales channel the demo creates for simulated Allegro orders. */
export const DEMO_SALES_CHANNEL = "Allegro (demo)"

/** At most this many simulated checkout forms a day. */
export const DEMO_FORMS_PER_DAY = 5

/* ------------------------------------------------------------------ */
/* Environments                                                        */
/* ------------------------------------------------------------------ */

export const ALLEGRO_ENVIRONMENTS = {
  production: {
    auth: "https://allegro.pl/auth/oauth",
    api: "https://api.allegro.pl",
    web: "https://allegro.pl",
    apps: "https://apps.developer.allegro.pl",
  },
  sandbox: {
    auth: "https://allegro.pl.allegrosandbox.pl/auth/oauth",
    api: "https://api.allegro.pl.allegrosandbox.pl",
    web: "https://allegro.pl.allegrosandbox.pl",
    apps: "https://apps.developer.allegro.pl.allegrosandbox.pl",
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
  /** Developer portal where the app is registered. */
  apps: string
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
    apps: e.apps,
  }
}

/** Public page of an offer. Allegro redirects the bare id to the full address. */
export function offerUrl(env: AllegroEnvironment, offerId: string): string {
  return `${ALLEGRO_ENVIRONMENTS[env].web}/oferta/${encodeURIComponent(offerId)}`
}

/**
 * Seller panel sections, as Allegro help documents them. The sandbox panel
 * addresses are not documented, so the sandbox links go to its web root.
 */
export function sellerPanel(env: AllegroEnvironment): { orders: string; returns: string; discussions: string; messages: string } {
  if (env === "sandbox") {
    const root = ALLEGRO_ENVIRONMENTS.sandbox.web
    return { orders: root, returns: root, discussions: root, messages: root }
  }
  return {
    orders: "https://salescenter.allegro.com/orders/",
    returns: "https://salescenter.allegro.com/returns",
    discussions: "https://salescenter.allegro.com/discussions-with-buyers",
    messages: "https://allegro.pl/moje-allegro/moje-konto/centrum-wiadomosci/wiadomosci",
  }
}
