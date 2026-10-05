/**
 * WRITE BARRIER AND SECRET MASKING. Zero imports, so the unit tests load it
 * without a build.
 *
 * Reads (GET, HEAD) always pass. Everything else must be on an ALLOWLIST:
 * an exact method and an exact path pattern that belongs to one writer, and
 * that writer must be ARMED for this very call. Nothing else reaches the
 * Allegro REST API:
 *
 *   stock     PUT  /sale/offer-quantity-change-commands/{uuid}
 *             PUT  /sale/offer-publication-commands/{uuid}   (action END only)
 *   prices    PUT  /sale/offer-price-change-commands/{uuid}
 *   shipping  POST /order/checkout-forms/{uuid}/shipments
 *             PUT  /order/checkout-forms/{uuid}/fulfillment
 *   invoices  POST /order/{uuid}/billing-documents/files
 *   publish   POST /sale/product-offers                       (drafts only)
 *   orders    nothing (it writes Medusa orders, not Allegro)
 *
 * The two OAuth POSTs (device code and token) are allowed by exact address.
 * A bug in our code ends with an exception here, never with a changed offer
 * or order on the seller's account. A body check closes the two places where
 * a path alone is not enough: a publication command can only END offers
 * (never ACTIVATE), and a new product offer can only be a draft.
 */

export type Verdict = { ok: true } | { ok: false; reason: string }

const READ_METHODS = new Set(["GET", "HEAD"])

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"

export interface WriteRoute {
  method: "POST" | "PUT"
  pattern: RegExp
  /** Whether a query string is allowed (only `checkoutForm.revision` on the seller status). */
  query?: RegExp
  /** Returns a reason when the body is not allowed. */
  body?: (body: unknown) => string | null
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {}
}

export const WRITE_ROUTES: Readonly<Record<string, readonly WriteRoute[]>> = {
  stock: [
    {
      method: "PUT",
      pattern: new RegExp(`^/sale/offer-quantity-change-commands/${UUID}$`),
      body: (b) => {
        const m = obj(obj(b).modification)
        if (m.changeType !== "FIXED") return "a quantity command must be FIXED"
        const value = Number(m.value)
        return Number.isInteger(value) && value > 0 ? null : "a FIXED quantity must be a whole number above zero"
      },
    },
    {
      method: "PUT",
      pattern: new RegExp(`^/sale/offer-publication-commands/${UUID}$`),
      body: (b) => (obj(obj(b).publication).action === "END" ? null : "the stock writer may only END offers, never activate them"),
    },
  ],
  prices: [
    {
      method: "PUT",
      pattern: new RegExp(`^/sale/offer-price-change-commands/${UUID}$`),
      body: (b) => (obj(obj(b).modification).type === "FIXED_PRICE" ? null : "a price command must be FIXED_PRICE"),
    },
  ],
  shipping: [
    { method: "POST", pattern: new RegExp(`^/order/checkout-forms/${UUID}/shipments$`) },
    {
      method: "PUT",
      pattern: new RegExp(`^/order/checkout-forms/${UUID}/fulfillment$`),
      query: /^checkoutForm\.revision=[A-Za-z0-9_-]{1,64}$/,
      body: (b) => {
        const status = obj(b).status
        return status === "READY_FOR_SHIPMENT" || status === "SENT" ? null : "the shipping writer sets only READY_FOR_SHIPMENT or SENT"
      },
    },
  ],
  invoices: [{ method: "POST", pattern: new RegExp(`^/order/${UUID}/billing-documents/files$`) }],
  publish: [
    {
      method: "POST",
      pattern: /^\/sale\/product-offers$/,
      body: (b) => (obj(obj(b).publication).status === "INACTIVE" ? null : "the publish writer creates drafts only (publication.status INACTIVE)"),
    },
  ],
  orders: [],
}

/** The address without its query string: the device request carries `client_id` there. */
function base(url: string): string {
  const i = url.indexOf("?")
  return i === -1 ? url : url.slice(0, i)
}

function queryOf(url: string): string {
  const i = url.indexOf("?")
  return i === -1 ? "" : url.slice(i + 1)
}

export function isRequestAllowed(args: {
  method: string
  url: string
  /** OAuth endpoints, the only POST targets outside the allowlist: device code request and token. */
  oauthUrls: readonly string[]
  /** API root, e.g. https://api.allegro.pl. Required for writes. */
  apiBase?: string
  /** The writer making this call. */
  writer?: string | null
  /** Writers armed for this call (read from the database at the start of the run). */
  armed?: ReadonlySet<string>
  /** JSON body, checked against the route when the route has a body rule. */
  body?: unknown
}): Verdict {
  const method = args.method.trim().toUpperCase()
  if (READ_METHODS.has(method)) return { ok: true }
  const address = base(args.url)
  if (method === "POST" && args.oauthUrls.includes(address)) return { ok: true }

  const refuse = (why: string): Verdict => ({ ok: false, reason: `${method} ${address}: ${why}` })
  const writer = args.writer ?? null
  if (!writer) return refuse("blocked by the write barrier, no writer is making this call.")
  const routes = WRITE_ROUTES[writer]
  if (!routes) return refuse(`blocked by the write barrier, "${writer}" is not a writer.`)
  if (!args.armed || !args.armed.has(writer)) return refuse(`blocked by the write barrier, the ${writer} writer is not armed.`)
  const apiBase = (args.apiBase ?? "").replace(/\/+$/, "")
  if (!apiBase || !address.startsWith(`${apiBase}/`)) return refuse("blocked by the write barrier, not the configured Allegro API.")
  const path = address.slice(apiBase.length)
  const query = queryOf(args.url)
  const route = routes.find((r) => r.method === method && r.pattern.test(path))
  if (!route) return refuse(`blocked by the write barrier, not on the allowlist of the ${writer} writer.`)
  if (query && !(route.query && route.query.test(query))) return refuse("blocked by the write barrier, query parameters are not allowed here.")
  if (route.body) {
    const problem = route.body(args.body)
    if (problem) return refuse(`blocked by the write barrier, ${problem}.`)
  }
  return { ok: true }
}

export class AllegroWriteBlockedError extends Error {
  readonly method: string
  readonly url: string
  constructor(method: string, url: string, reason: string) {
    super(reason)
    this.name = "AllegroWriteBlockedError"
    this.method = method
    this.url = url
  }
}

/**
 * Masks secrets in text that goes to logs, the database or the admin.
 *
 * First every known secret literally (split/join, no regex), then every
 * base64url run of 40+ characters: that is what Allegro tokens (JWT parts),
 * device codes and client secrets look like. Offer ids (up to 12 digits) and
 * checkout form ids (UUIDs, a dash every few characters) survive.
 */
export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("***")
  }
  return out.replace(/[A-Za-z0-9_-]{40,}/g, "***")
}
