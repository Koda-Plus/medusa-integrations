import { createHash } from "node:crypto"
import type { BasketStatus } from "./constants"

/**
 * The pure parts of confirming a basket and placing its order: the phone,
 * the masked phone, the sample buyer of the demo, and the decision what a
 * confirmation does with a basket in a given state (idempotency).
 */

export interface Phone {
  country_prefix: string
  phone: string
}

/**
 * A phone number as the app sends it: a country prefix and the digits.
 * "600 000 000", "+48600000000" and "0048 600-000-000" are the same Polish
 * number. Null when it is not 7 to 12 digits.
 */
export function normalizePhone(input: unknown, prefix?: unknown): Phone | null {
  let raw = typeof input === "string" ? input : typeof input === "number" ? String(input) : ""
  raw = raw.replace(/[\s().-]/g, "")
  let country = typeof prefix === "string" && /^\+?\d{1,4}$/.test(prefix.trim()) ? `+${prefix.trim().replace(/^\+/, "")}` : ""
  if (raw.startsWith("00")) raw = `+${raw.slice(2)}`
  if (raw.startsWith("+")) {
    if (raw.startsWith("+48")) {
      country = "+48"
      raw = raw.slice(3)
    } else {
      const m = /^\+(\d{1,3})(\d{7,12})$/.exec(raw)
      if (!m) return null
      country = `+${m[1]}`
      raw = m[2]
    }
  }
  if (!/^\d{7,12}$/.test(raw)) return null
  return { country_prefix: country || "+48", phone: raw }
}

/** "60*****00": the first two and the last two digits, as InPost masks it. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 5) return "*".repeat(digits.length)
  return `${digits.slice(0, 2)}${"*".repeat(digits.length - 4)}${digits.slice(-2)}`
}

export interface DemoBuyer {
  first_name: string
  last_name: string
  email: string
  phone: string
  address: { address_1: string; city: string; postal_code: string; country_code: string }
  locker: string
}

/**
 * The sample buyer of a simulated confirmation. Nothing real: a sample name,
 * an example.com address derived from a hash of the phone (the number itself
 * never appears in it), a sample street and a sample parcel locker.
 */
export function demoBuyer(phone: Phone): DemoBuyer {
  const tag = createHash("sha256").update(`inpostpay-demo:${phone.country_prefix}${phone.phone}`).digest("hex").slice(0, 10)
  return {
    first_name: "Demo",
    last_name: "InPost Pay (symulacja)",
    email: `inpostpay-demo-${tag}@example.com`,
    phone: `${phone.country_prefix}${phone.phone}`,
    address: { address_1: "ul. Przykładowa 1", city: "Warszawa", postal_code: "00-001", country_code: "pl" },
    locker: "DEMO01M",
  }
}

export type ConfirmDecision =
  | { action: "return_order"; orderId: string }
  | { action: "place" }
  | { action: "refuse"; code: "BASKET_REJECTED" | "BASKET_UNBOUND"; message: string }

/**
 * What a confirmation (demo) or an order call (InPost) does with a basket:
 * the second call for the same basket returns the same order, a rejected or
 * unbound basket is refused, anything else places the order (a failed
 * attempt may be tried again).
 */
export function confirmDecision(row: { status: BasketStatus | string; order_id: string | null }): ConfirmDecision {
  if (row.order_id) return { action: "return_order", orderId: row.order_id }
  if (row.status === "rejected") return { action: "refuse", code: "BASKET_REJECTED", message: "The customer refused this basket in the app" }
  if (row.status === "unbound") return { action: "refuse", code: "BASKET_UNBOUND", message: "This basket is no longer bound to InPost Pay" }
  return { action: "place" }
}

/** Gross amount in major units to minor units (199.99 -> 19999), rounding half up. */
export function toMinor(amount: unknown): number | null {
  const n = typeof amount === "number" ? amount : typeof amount === "string" && amount.trim() ? Number(amount) : NaN
  if (!Number.isFinite(n)) return null
  /* 1.005 * 100 is 100.49999...; four decimals first, then the rounding. */
  return Math.round(Number((n * 100).toFixed(4)))
}

/** Minor units back to a decimal string ("199.99"). */
export function fromMinor(minor: number | null | undefined): string | null {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return null
  const sign = minor < 0 ? "-" : ""
  const abs = Math.abs(Math.round(minor))
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`
}
