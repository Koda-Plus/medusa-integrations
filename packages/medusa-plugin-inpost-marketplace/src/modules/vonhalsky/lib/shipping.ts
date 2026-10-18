/**
 * DELIVERY BOTH WAYS, the pure parts: which Medusa shipping option a
 * marketplace delivery type lands on, and which tracking numbers of the
 * Medusa fulfillments still have to go back to the marketplace.
 */

import { DELIVERY_TYPES, type DeliveryType } from "./constants"

export type ShippingMapping = Record<DeliveryType, string | null>

export const EMPTY_MAPPING: ShippingMapping = { APM: null, COURIER: null }

export function isDeliveryType(v: unknown): v is DeliveryType {
  return typeof v === "string" && (DELIVERY_TYPES as readonly string[]).includes(v)
}

/** A mapping from the admin or the table: only known types, only shipping option ids. */
export function normalizeMapping(v: unknown): ShippingMapping {
  const out: ShippingMapping = { ...EMPTY_MAPPING }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out
  for (const t of DELIVERY_TYPES) {
    const id = (v as Record<string, unknown>)[t]
    out[t] = typeof id === "string" && /^so_[A-Za-z0-9]+$/.test(id) ? id : null
  }
  return out
}

/**
 * The shipping option of a delivery type: the mapped one; else, for a
 * delivery the marketplace did not name, the parcel locker mapping, then the
 * courier one; else the fallback (demo: the first shipping option of the
 * store, so a simulated order can be fulfilled). Null when nothing fits:
 * the order is still imported, a person picks the option when fulfilling.
 */
export function shippingOptionFor(type: string | null, mapping: ShippingMapping, fallback: string | null = null): string | null {
  if (isDeliveryType(type) && mapping[type]) return mapping[type]
  if (!isDeliveryType(type)) return mapping.APM ?? mapping.COURIER ?? fallback
  return fallback
}

export interface FulfillmentLike {
  canceled_at?: string | Date | null
  labels?: Array<{ tracking_number?: string | null } | null> | null
}

/** Every tracking number on the order's fulfillments that are not canceled, in order, without duplicates. */
export function trackingNumbersOf(fulfillments: readonly (FulfillmentLike | null)[] | null | undefined): string[] {
  const out: string[] = []
  for (const f of fulfillments ?? []) {
    if (!f || f.canceled_at) continue
    for (const l of f.labels ?? []) {
      const n = String(l?.tracking_number ?? "").trim()
      if (n && n.length <= 64 && !out.includes(n)) out.push(n)
    }
  }
  return out
}

/** The numbers not sent yet. */
export function unsentNumbers(all: readonly string[], sent: unknown): string[] {
  const done = new Set(Array.isArray(sent) ? sent.map((x) => String(x)) : [])
  return all.filter((n) => !done.has(n))
}

export type TrackingDecision =
  | { kind: "none"; reason: "no_numbers" | "all_sent" | "not_imported" }
  | { kind: "record"; numbers: string[] }
  | { kind: "send"; numbers: string[] }
  | { kind: "off"; numbers: string[] }

/**
 * What happens with the tracking numbers of one imported order: demo
 * records them (nothing leaves the server); with the writer on they are
 * sent; with it off they are only noted, so the panel shows they wait.
 */
export function trackingDecision(input: { imported: boolean; numbers: string[]; sent: unknown; demo: boolean; sendTracking: boolean }): TrackingDecision {
  if (!input.imported) return { kind: "none", reason: "not_imported" }
  if (input.numbers.length === 0) return { kind: "none", reason: "no_numbers" }
  const fresh = unsentNumbers(input.numbers, input.sent)
  if (fresh.length === 0) return { kind: "none", reason: "all_sent" }
  if (input.demo) return { kind: "record", numbers: fresh }
  return input.sendTracking ? { kind: "send", numbers: fresh } : { kind: "off", numbers: fresh }
}
