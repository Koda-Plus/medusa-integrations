/**
 * THE DRAFT ORDER OF AN ACCEPTED THREAD. Pure, tested with `node --test`.
 *
 * What the draft order writer hands to Medusa's `createOrderWorkflow`, the
 * workflow behind the admin's own "Create draft order": the thread's
 * customer, one line of the negotiated variant, its quantity, the agreed
 * unit price as a custom price, the region of the thread's currency.
 * Shipping, addresses the customer has not saved and the payment stay with
 * the team, which finishes the draft in the Medusa admin and converts it.
 *
 * A thread that cannot become a draft says why (`DraftBlock`) instead of
 * guessing: a cart thread (the agreed price is for the whole cart, and
 * splitting it across lines is a decision for a person), a product thread
 * without a variant, no region in the currency, no customer e-mail.
 */

import { formatAmount, toMajorNumber } from "./money"
import { hash } from "./text"
import type { Thread } from "./thread"

export type DraftBlock = "not_accepted" | "cart" | "no_variant" | "no_price" | "no_currency" | "no_region" | "no_customer" | "no_email"

export interface DraftAddress {
  first_name?: string
  last_name?: string
  company?: string
  address_1?: string
  address_2?: string
  city?: string
  province?: string
  postal_code?: string
  country_code?: string
  phone?: string
}

export interface DraftContext {
  /** A region whose currency is the thread's. */
  region: { id: string; currencyCode: string } | null
  salesChannelId: string | null
  customer: { id: string; email: string | null; shippingAddress: DraftAddress | null; billingAddress: DraftAddress | null } | null
  /** The variant's titles now (the thread keeps the ones from when it was opened). */
  variant: { id: string; title: string | null; productTitle: string | null } | null
  taxInclusive: boolean
  /**
   * Demo mode: nothing is written to Medusa, so a missing region or customer
   * (the demo story may have no real customers) is filled with a clearly
   * simulated placeholder instead of blocking the plan.
   */
  simulate?: boolean
}

/** Placeholders of the simulation; never sent to Medusa. */
export const SIMULATED_REGION_ID = "reg_simulated"
export const SIMULATED_CUSTOMER_ID = "cus_simulated"
export const SIMULATED_EMAIL = "customer@example.com"

export interface DraftOrderInput {
  region_id: string
  customer_id: string
  email: string
  currency_code: string
  sales_channel_id?: string
  status: "draft"
  is_draft_order: true
  no_notification: true
  items: Array<{
    variant_id: string
    title: string
    quantity: number
    unit_price: number
    is_tax_inclusive: boolean
    metadata: Record<string, unknown>
  }>
  shipping_address?: DraftAddress
  billing_address?: DraftAddress
  metadata: Record<string, unknown>
}

export type DraftBuild = { ok: true; input: DraftOrderInput } | { ok: false; reason: DraftBlock }

export function buildDraftOrderInput(t: Thread, ctx: DraftContext): DraftBuild {
  if (t.status !== "accepted") return { ok: false, reason: "not_accepted" }
  if (t.subject === "cart") return { ok: false, reason: "cart" }
  if (!t.variantId) return { ok: false, reason: "no_variant" }
  const agreed = t.agreed ?? t.price
  if (agreed === null || agreed <= 0) return { ok: false, reason: "no_price" }
  if (!t.currencyCode) return { ok: false, reason: "no_currency" }
  const sim = ctx.simulate === true
  let regionId: string
  if (ctx.region && ctx.region.currencyCode.toLowerCase() === t.currencyCode) regionId = ctx.region.id
  else if (sim) regionId = SIMULATED_REGION_ID
  else return { ok: false, reason: "no_region" }
  let customerId: string
  let email: string
  if (t.customerId && ctx.customer && ctx.customer.id === t.customerId) {
    customerId = t.customerId
    if (ctx.customer.email) email = ctx.customer.email
    else if (sim) email = SIMULATED_EMAIL
    else return { ok: false, reason: "no_email" }
  } else if (sim) {
    customerId = t.customerId ?? SIMULATED_CUSTOMER_ID
    email = SIMULATED_EMAIL
  } else return { ok: false, reason: "no_customer" }

  const productTitle = ctx.variant?.productTitle ?? null
  const variantTitle = ctx.variant?.title ?? null
  const title = t.title ?? (productTitle && variantTitle && variantTitle !== productTitle ? `${productTitle} / ${variantTitle}` : productTitle) ?? t.sku ?? t.ref
  const input: DraftOrderInput = {
    region_id: regionId,
    customer_id: customerId,
    email,
    currency_code: t.currencyCode,
    status: "draft",
    is_draft_order: true,
    no_notification: true,
    items: [
      {
        variant_id: t.variantId,
        title,
        quantity: t.qty,
        unit_price: toMajorNumber(agreed, t.digits),
        is_tax_inclusive: ctx.taxInclusive,
        metadata: { negotiation_id: t.id, negotiation_ref: t.ref, agreed_price: formatAmount(agreed, t.digits) },
      },
    ],
    metadata: { negotiation_id: t.id, negotiation_ref: t.ref },
  }
  if (ctx.salesChannelId) input.sales_channel_id = ctx.salesChannelId
  if (ctx.customer?.id === customerId && ctx.customer.shippingAddress) input.shipping_address = ctx.customer.shippingAddress
  if (ctx.customer?.id === customerId && ctx.customer.billingAddress) input.billing_address = ctx.customer.billingAddress
  return { ok: true, input }
}

/** A saved customer address as a draft order address, or null when it has no country (Medusa needs one). */
export function draftAddress(a: Record<string, unknown> | null | undefined): DraftAddress | null {
  if (!a || typeof a !== "object") return null
  const pick = (k: string) => (typeof a[k] === "string" && (a[k] as string).trim() ? (a[k] as string).trim() : undefined)
  const country = pick("country_code")?.toLowerCase()
  if (!country) return null
  const out: DraftAddress = { country_code: country }
  for (const k of ["first_name", "last_name", "company", "address_1", "address_2", "city", "province", "postal_code", "phone"] as const) {
    const v = pick(k)
    if (v) out[k] = v
  }
  return out
}

/** The draft order a demo run "creates": an id and a number derived from the thread, nothing in Medusa. */
export function simulatedDraftOrder(threadId: string): { id: string; displayId: number } {
  const h = hash(`draft:${threadId}`)
  return { id: `order_simulated_${h.toString(36)}`, displayId: 9000 + (h % 1000) }
}

/** The region for a currency: the configured one when its currency matches, else the first by name. */
export function pickRegion(
  regions: ReadonlyArray<{ id: string; name?: string | null; currency_code?: string | null }>,
  currency: string | null,
  preferredId: string | null,
): { id: string; currencyCode: string } | null {
  if (!currency) return null
  const matching = regions.filter((r) => String(r.currency_code ?? "").toLowerCase() === currency)
  const preferred = preferredId ? matching.find((r) => r.id === preferredId) : undefined
  const chosen = preferred ?? [...matching].sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)) || (a.id < b.id ? -1 : 1))[0]
  return chosen ? { id: chosen.id, currencyCode: currency } : null
}
