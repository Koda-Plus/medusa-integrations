import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { STORE_READS_PER_MINUTE } from "../../../modules/negotiations/lib/constants"
import { sharedLimiter } from "../../../modules/negotiations/lib/rate-limit"
import { ActionError, negotiationsService } from "../../../workflows/negotiations/runtime"

/** The logged-in customer of a store request, or null (an admin token or no session does not count). */
export function customerIdOf(req: MedusaRequest): string | null {
  const ctx = (req as MedusaRequest & { auth_context?: { actor_id?: string | null; actor_type?: string | null } | null }).auth_context
  if (!ctx || ctx.actor_type !== "customer") return null
  return typeof ctx.actor_id === "string" && ctx.actor_id ? ctx.actor_id : null
}

/** Sales channels of the publishable key the request came with (empty without one). */
export function salesChannelsOf(req: MedusaRequest): string[] {
  const ids = (req as MedusaRequest & { publishable_key_context?: { sales_channel_ids?: unknown } }).publishable_key_context?.sales_channel_ids
  return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []
}

export type StoreLimit = "open" | "write" | "read"

const HOUR = 60 * 60 * 1000

/**
 * Every Store API route: the Store API is on, a customer is logged in, the
 * customer is within the rate limit of the kind of request; then the route
 * runs and a refusal of a move becomes its status with a stable `code`:
 *
 *   401 unauthorized, 404 not_found, 400 invalid_data (with `errors`),
 *   409 closed | expired | no_offer | offer_changed | already_open |
 *       too_many_active | thread_full, 403 accept_disabled, 429 rate_limited
 */
export async function storeRoute(req: MedusaRequest, res: MedusaResponse, kind: StoreLimit, fn: (customerId: string) => Promise<unknown>, status = 200): Promise<void> {
  const o = negotiationsService(req.scope).getOptions()
  if (!o.storeApi) {
    res.status(404).json({ type: "not_found", code: "disabled", message: "Negotiations are not available in this store." })
    return
  }
  const customerId = customerIdOf(req)
  if (!customerId) {
    res.status(401).json({ type: "unauthorized", code: "unauthorized", message: "Log in to negotiate prices." })
    return
  }
  const limiter =
    kind === "open"
      ? sharedLimiter(`open:${o.openPerHour}`, o.openPerHour, HOUR)
      : kind === "write"
        ? sharedLimiter(`write:${o.messagesPerHour}`, o.messagesPerHour, HOUR)
        : sharedLimiter("read", STORE_READS_PER_MINUTE)
  const hit = limiter.hit(customerId)
  if (!hit.ok) {
    res.setHeader("Retry-After", String(hit.retryAfterSeconds))
    res.status(429).json({ type: "not_allowed", code: "rate_limited", message: "Too many requests. Try again in a moment.", retry_after: hit.retryAfterSeconds })
    return
  }
  res.setHeader("Cache-Control", "private, no-store")
  try {
    const body = await fn(customerId)
    res.status(status).json(body)
  } catch (err) {
    if (err instanceof ActionError) {
      res.status(err.status).json({ type: err.status === 404 ? "not_found" : err.status === 400 ? "invalid_data" : "not_allowed", code: err.code, message: err.message, ...err.extra })
      return
    }
    throw err
  }
}

export function bodyOf(req: MedusaRequest): Record<string, unknown> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {}
}
