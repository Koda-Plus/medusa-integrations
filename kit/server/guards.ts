import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Two guards every plugin registers in its `src/api/middlewares.ts`.
 *
 * 1. writeGuard: a write to the plugin's admin routes must come from code
 *    that can set headers (the admin, a server with an API key), not from a
 *    form on another site. Medusa's session cookie is `SameSite=None` in
 *    production, so a cross-site form POST carries it; a form can only send
 *    `application/x-www-form-urlencoded`, `multipart/form-data` or
 *    `text/plain` and no custom header. A write passes with a JSON body type
 *    or the `x-koda-request` header, both of which make a browser ask CORS
 *    first. The kit's admin fetch sends both.
 *
 * 2. reservedMetadataGuard: the Store API takes any `metadata` on carts,
 *    line items and the customer, and Medusa copies cart metadata to the
 *    order. A shopper must never be able to write a key a plugin reads as
 *    state (`baselinker_imported`, `allegro_payment_type`, ...). The guard
 *    refuses such keys on the store routes with 400 `reserved_metadata_key`.
 *    Plugins still never trust metadata for a decision: their own tables
 *    are the record, the guard only keeps the noise out.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export const KODA_REQUEST_HEADER = "x-koda-request"

export function isTrustedWrite(req: { method?: string; headers?: Record<string, unknown> }): boolean {
  if (!WRITE_METHODS.has(String(req.method ?? "GET").toUpperCase())) return true
  const headers = req.headers ?? {}
  if (headers[KODA_REQUEST_HEADER] !== undefined && headers[KODA_REQUEST_HEADER] !== "") return true
  const type = String(headers["content-type"] ?? "").toLowerCase()
  return type.startsWith("application/json") || /^application\/[a-z0-9.+-]*\+json/.test(type)
}

export function writeGuard() {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    if (isTrustedWrite(req as unknown as { method?: string; headers?: Record<string, unknown> })) {
      next()
      return
    }
    res.status(415).json({
      code: "json_required",
      message: "Writes take a JSON body (Content-Type: application/json) or the x-koda-request header",
    })
  }
}

/** Keys of `metadata` (and of each line item's metadata) that a shopper may not set. */
export function reservedKeysIn(body: unknown, prefixes: readonly string[], keys: readonly string[] = []): string[] {
  const found = new Set<string>()
  const check = (meta: unknown) => {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return
    for (const k of Object.keys(meta as Record<string, unknown>)) {
      const lower = k.toLowerCase()
      if (keys.includes(lower) || prefixes.some((p) => lower.startsWith(p))) found.add(k)
    }
  }
  if (body && typeof body === "object") {
    const b = body as { metadata?: unknown; items?: unknown }
    check(b.metadata)
    if (Array.isArray(b.items)) for (const item of b.items) check((item as { metadata?: unknown } | null)?.metadata)
  }
  return [...found]
}

export function reservedMetadataGuard(prefixes: readonly string[], keys: readonly string[] = []) {
  const p = prefixes.map((x) => x.toLowerCase())
  const k = keys.map((x) => x.toLowerCase())
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction): void => {
    if (!WRITE_METHODS.has(String(req.method ?? "GET").toUpperCase())) {
      next()
      return
    }
    const found = reservedKeysIn((req as { body?: unknown }).body, p, k)
    if (found.length === 0) {
      next()
      return
    }
    res.status(400).json({ code: "reserved_metadata_key", message: `These metadata keys are reserved for the store's integrations: ${found.join(", ")}` })
  }
}

/** The store routes that take shopper metadata (Medusa 2.12 to 2.21). */
export const STORE_METADATA_MATCHERS = ["/store/carts*", "/store/customers/me*", "/store/customers"] as const
