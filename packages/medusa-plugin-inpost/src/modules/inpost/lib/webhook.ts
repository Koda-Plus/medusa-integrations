import { createHash, timingSafeEqual } from "node:crypto"

/**
 * THE SHIPX WEBHOOK, as pure functions.
 *
 * ShipX does not sign webhooks. The URL itself carries a secret:
 * `https://<backend>/hooks/inpost/<webhookSecret>`, set in InPost Manager
 * (My account, API, webhook). InPost wants the path in lower case and checks
 * that the URL answers 200 to a GET when it is saved.
 *
 *   auth        the secret from the path is compared in constant time
 *               (both sides hashed to the same length first); a wrong or
 *               missing secret, or a webhook that is not configured, gets
 *               404, so the route does not even admit it exists
 *   trust       nothing in the body is believed: the body only names a
 *               shipment, the plugin then reads that shipment from ShipX
 *               with its own token. A forged call can at most make the
 *               plugin read a shipment again
 *   idempotent  every delivery has a key (event, shipment, status, time);
 *               a repeated delivery is recorded once and ignored after, and
 *               a status already known changes nothing and emits nothing
 *
 * Events ShipX sends (documentation "Webhooks"):
 *   shipment_confirmed       { shipment_id, tracking_number }
 *   shipment_status_changed  { shipment_id, status, tracking_number }
 *   offers_prepared          { shipment_id, offers: [...] }
 */

export const WEBHOOK_EVENTS = ["shipment_confirmed", "shipment_status_changed", "offers_prepared"] as const
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number]

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest()

/** Constant time: the same work for a right and a wrong secret of any length. */
export function secretMatches(given: unknown, expected: string): boolean {
  if (!expected || typeof given !== "string" || given.length === 0 || given.length > 256) return false
  return timingSafeEqual(digest(given), digest(expected))
}

export interface WebhookCall {
  event: WebhookEventName
  shipmentId: string
  status: string | null
  trackingNumber: string | null
  organizationId: string | null
  /** As ShipX sends it: "2020-03-20 15:08:42 +0100". */
  eventTs: string | null
  /** The idempotency key of this delivery. */
  key: string
}

/** The call, or why it is ignored (still answered 200: ShipX only needs to know it arrived). */
export function parseWebhook(body: unknown): { ok: true; call: WebhookCall } | { ok: false; reason: "not_json" | "unknown_event" | "no_shipment" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, reason: "not_json" }
  const b = body as Record<string, unknown>
  const event = String(b.event ?? "")
  if (!(WEBHOOK_EVENTS as readonly string[]).includes(event)) return { ok: false, reason: "unknown_event" }
  const payload = (b.payload && typeof b.payload === "object" ? b.payload : {}) as Record<string, unknown>
  const shipmentId = String(payload.shipment_id ?? "").trim()
  if (!/^\d{1,15}$/.test(shipmentId)) return { ok: false, reason: "no_shipment" }
  const status = typeof payload.status === "string" && /^[a-z_]{2,60}$/.test(payload.status) ? payload.status : event === "offers_prepared" ? "offers_prepared" : event === "shipment_confirmed" ? "confirmed" : null
  const tracking = typeof payload.tracking_number === "string" && /^[A-Za-z0-9]{6,40}$/.test(payload.tracking_number) ? payload.tracking_number : null
  const org = b.organization_id === undefined || b.organization_id === null ? null : String(b.organization_id).trim() || null
  const eventTs = typeof b.event_ts === "string" ? b.event_ts.slice(0, 40) : null
  return {
    ok: true,
    call: {
      event: event as WebhookEventName,
      shipmentId,
      status,
      trackingNumber: tracking,
      organizationId: org,
      eventTs,
      key: `webhook:${event}:${shipmentId}:${status ?? ""}:${eventTs ?? ""}`.slice(0, 200),
    },
  }
}

/** The webhook path of a secret, or null when the webhook is off. */
export function webhookPath(secret: string | null | undefined): string | null {
  return secret ? `/hooks/inpost/${secret}` : null
}
