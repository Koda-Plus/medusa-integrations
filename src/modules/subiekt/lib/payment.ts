/**
 * WHEN AN ORDER GOES TO SUBIEKT, and how its payment is described there.
 *
 * Prepaid providers (cards, BLIK, Przelewy24, PayU...) wait for the capture:
 * a ZK reserves stock and the warehouse starts packing from it, so an order
 * whose payment may still fail must not appear there. Everything else goes
 * at once: cash on delivery, bank transfer, trade credit, manual payments.
 *
 * Pure functions, so the decision is unit tested without Medusa.
 */

import type { PaymentStatus } from "./contract"
import { money } from "./numbers"

export interface PaymentRecord {
  provider_id?: string | null
  amount?: unknown
  captured_at?: string | Date | null
  canceled_at?: string | Date | null
  authorized_at?: string | Date | null
  captures?: Array<{ amount?: unknown; created_at?: string | Date | null }> | null
}

export interface PaymentCollectionRecord {
  status?: string | null
  amount?: unknown
  payments?: PaymentRecord[] | null
}

export interface PaymentStateInput {
  collections: PaymentCollectionRecord[]
  totalGross: number
  prepaidProviders: readonly string[]
  codProviders: readonly string[]
  /** `order.metadata.payment_term_days` or similar, for trade credit. */
  dueDays?: number | null
}

export interface PaymentState {
  status: PaymentStatus
  providerId: string | null
  prepaid: boolean
  amountPaid: number
  capturedAt: string | null
  method: string | null
  dueDays: number | null
}

export function matchesPrefix(providerId: string | null | undefined, prefixes: readonly string[]): boolean {
  if (!providerId) return false
  const id = providerId.toLowerCase()
  return prefixes.some((p) => {
    const prefix = p.trim().toLowerCase()
    return prefix.length > 0 && id.startsWith(prefix)
  })
}

function iso(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const LABELS: Array<[RegExp, string]> = [
  [/^pp_stripe-blik/, "BLIK (Stripe)"],
  [/^pp_stripe-przelewy24/, "Przelewy24 (Stripe)"],
  [/^pp_stripe-bancontact/, "Bancontact (Stripe)"],
  [/^pp_stripe-ideal/, "iDEAL (Stripe)"],
  [/^pp_stripe/, "Card (Stripe)"],
  [/^pp_(p24|przelewy24)/, "Przelewy24"],
  [/^pp_payu/, "PayU"],
  [/^pp_tpay/, "Tpay"],
  [/^pp_paypal/, "PayPal"],
  [/^pp_adyen/, "Adyen"],
  [/^pp_mollie/, "Mollie"],
  [/^pp_(cod|cash)/, "Cash on delivery"],
  [/^pp_system_default/, "Manual payment"],
]

/** Human label of a provider id. Unknown providers keep their id. */
export function methodLabel(providerId: string | null | undefined, dueDays?: number | null): string | null {
  if (dueDays && dueDays > 0) return `Bank transfer, ${dueDays} days`
  if (!providerId) return null
  const id = providerId.toLowerCase()
  for (const [re, label] of LABELS) if (re.test(id)) return label
  return providerId
}

/**
 * The payment of an order as Subiekt should see it. The newest payment that
 * is not canceled decides the provider; captures from every payment add up.
 */
export function paymentState(input: PaymentStateInput): PaymentState {
  const payments = input.collections
    .filter((c) => (c.status ?? "") !== "canceled")
    .flatMap((c) => c.payments ?? [])
    .filter((p) => !p.canceled_at)

  let amountPaid = 0
  let capturedAt: string | null = null
  for (const p of payments) {
    const captures = p.captures ?? []
    const captured = captures.length > 0 ? captures.reduce((sum, c) => sum + money(c.amount), 0) : p.captured_at ? money(p.amount) : 0
    amountPaid += captured
    const at = iso(p.captured_at) ?? iso(captures[captures.length - 1]?.created_at ?? null)
    if (captured > 0 && at && (!capturedAt || at > capturedAt)) capturedAt = at
  }
  amountPaid = money(amountPaid)

  const provider = payments.length > 0 ? payments[payments.length - 1].provider_id ?? null : null
  const prepaid = matchesPrefix(provider, input.prepaidProviders)
  const dueDays = input.dueDays && input.dueDays > 0 ? Math.floor(input.dueDays) : null
  const total = money(input.totalGross)

  let status: PaymentStatus
  if (total <= 0) status = "not_required"
  else if (amountPaid > 0 && amountPaid + 0.005 >= total) status = "captured"
  else if (matchesPrefix(provider, input.codProviders)) status = "cash_on_delivery"
  else if (payments.some((p) => p.authorized_at) && prepaid) status = "authorized"
  else status = "awaiting"

  return {
    status,
    providerId: provider,
    prepaid,
    amountPaid,
    capturedAt: status === "captured" ? capturedAt : null,
    method: methodLabel(provider, dueDays),
    dueDays,
  }
}

/** Ready for Subiekt now, or waiting for the money first. */
export function readyForSubiekt(state: PaymentState): boolean {
  if (!state.prepaid) return true
  return state.status === "captured" || state.status === "not_required"
}
