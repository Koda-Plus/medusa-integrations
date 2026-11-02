/**
 * THE SHIPPING METHOD DATA OF AN IMPORTED ORDER, the pure parts.
 *
 * `createOrderWorkflow` stores the shipping method data exactly as given: it
 * never asks the fulfillment provider, the way a cart does when a shopper
 * picks a shipping option (`validateFulfillmentData`). A provider that reads
 * its own keys from that data (the InPost plugin of Koda Plus reads the
 * option and the locker, `machine_id`) would see only ours and ship nothing.
 * So before the order is created the import asks the provider of the mapped
 * shipping option to validate the data, as a cart would, and keeps the
 * answer next to its own `allegro_*` keys. No package is imported: any
 * provider answers through Medusa's fulfillment module.
 *
 * ONLY A DELIVERY METHOD MAPPED BY NAME OR ID. The default shipping option
 * (`orderImport.shippingOptionId`) lands every order whatever its carrier:
 * an ORLEN or DPD pickup point handed to an InPost option would become a
 * parcel to a wrong locker. Orders on the default option keep our keys.
 *
 * HANDED OVER ONLY WHEN IT IS RIGHT. The provider's answer is kept only when
 * the payment type is known, a pickup delivery still carries its locker, and
 * when it names cash on delivery, that agrees with the Allegro payment type
 * and collects exactly the buyer's Allegro total. Otherwise the order keeps
 * only our keys (what it carried before), the import goes on and the import
 * row says why: a wrong parcel is worse than a parcel a person sends by hand.
 */

import type { CheckoutForm } from "./checkout"
import type { MedusaAddressInput } from "./import"

type Data = Record<string, unknown>

/** Where the shipping option of an imported order came from. */
export type ShippingOptionSource = "method" | "default" | null

/** What the import sends the provider: the method data a storefront would send, and the order as the context. */
export interface HandoffRequest {
  data: Data
  context: { currency_code: string; shipping_address: MedusaAddressInput }
}

export type HandoffKeptCode =
  | "demo"
  | "no_option"
  | "default_option"
  | "refused"
  | "payment_unknown"
  | "locker_dropped"
  | "cod_mismatch"
  | "cod_total_mismatch"

export type HandoffOutcome =
  | { kind: "handed"; data: Data }
  /** The order keeps only our own keys; `reason` goes to the import row (not for `demo`, `no_option` and `default_option`). */
  | { kind: "kept"; data: Data; code: HandoffKeptCode; reason: string }

/** Codes of `details.handoff` that need no person: handed over, or never meant to be. */
const QUIET_CODES = new Set(["handed", "demo", "no_option", "default_option"])

/** The kept codes a person should see: the mapping asked for a hand-over and it did not happen. */
export function handoffNeedsAttention(outcome: HandoffOutcome): boolean {
  return outcome.kind === "kept" && !QUIET_CODES.has(outcome.code)
}

/** A `details.handoff` value on an import row that asks a person to ship by hand or to check the amount. */
export function handoffCodeNeedsAttention(code: unknown): boolean {
  return typeof code === "string" && code !== "" && !QUIET_CODES.has(code)
}

/** Allegro's documented payment types (`payment.type`). */
const PAYMENT_TYPES = new Set(["CASH_ON_DELIVERY", "WIRE_TRANSFER", "ONLINE", "SPLIT_PAYMENT", "EXTENDED_TERM"])

/** The locker keys a storefront sends (the InPost geowidget shape) and providers read. */
const LOCKER_KEYS = ["machine_id", "target_point", "locker_code", "point"] as const

function lockerOf(form: CheckoutForm): string | null {
  const id = String(form.delivery.pickupPoint?.id ?? "").trim()
  return id ? id : null
}

/**
 * The request for the provider. A pickup delivery names its point the way
 * InPost's geowidget does (`machine_id`, `machine_name`); a courier sends no
 * data, the provider reads the address from the context.
 */
export function handoffRequest(form: CheckoutForm, context: HandoffRequest["context"]): HandoffRequest {
  const point = lockerOf(form)
  return { data: point ? { machine_id: point, machine_name: form.delivery.pickupPoint?.name?.trim() || point } : {}, context }
}

const code = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toUpperCase()

/** Our keys win: the provider never overwrites what the import itself recorded. */
const merged = (validated: Data, own: Data): Data => ({ ...validated, ...own })

/** Kept without asking a provider: demo orders, orders without an option, orders on the default option. */
export function keptWithoutProvider(own: Data, why: "demo" | "no_option" | "default_option"): HandoffOutcome {
  const reason = {
    demo: "Demo order: not handed to the shipping provider, so a simulated order never becomes a real parcel.",
    no_option: "No shipping option is mapped for this delivery method: a person picks it when fulfilling.",
    default_option:
      "The order is on the default shipping option, not on one mapped to its Allegro delivery method: not handed to the shipping provider, a person ships it.",
  }[why]
  return { kind: "kept", data: own, code: why, reason }
}

/** The provider refused the data, or could not be asked. */
export function refused(own: Data, message: string): HandoffOutcome {
  return { kind: "kept", data: own, code: "refused", reason: `The shipping provider refused the delivery: ${message}` }
}

/**
 * The provider's answer, checked. `validated` is what the provider returned
 * from `validateFulfillmentData` for the request of `handoffRequest`;
 * `orderTotalMinor` is the total of the Medusa order the import creates
 * (lines and delivery), the amount a cash on delivery parcel collects.
 */
export function handoffResult(form: CheckoutForm, own: Data, validated: Data, orderTotalMinor: number | null): HandoffOutcome {
  const payment = String(form.payment.type ?? "").trim().toUpperCase()
  if (!PAYMENT_TYPES.has(payment)) {
    return {
      kind: "kept",
      data: own,
      code: "payment_unknown",
      reason: `Allegro gave ${payment ? `the payment type ${payment}` : "no payment type"}, so it is not known whether the parcel collects cash on delivery: ship it by hand.`,
    }
  }
  const locker = lockerOf(form)
  if (locker) {
    const kept = LOCKER_KEYS.map((k) => code(validated[k])).find(Boolean)
    if (!kept) {
      return {
        kind: "kept",
        data: own,
        code: "locker_dropped",
        reason: `Allegro delivers to pickup point ${locker}, but the shipping option mapped to "${form.delivery.methodName ?? form.delivery.methodId ?? "this method"}" does not ship to a locker. Map a parcel locker option for it.`,
      }
    }
  }
  /* Cash on delivery comes from the payment type, never from "not paid": Allegro Pay (EXTENDED_TERM) is not paid yet and collects nothing. */
  const cod = payment === "CASH_ON_DELIVERY"
  if (typeof validated.cod === "boolean" && validated.cod !== cod) {
    return {
      kind: "kept",
      data: own,
      code: "cod_mismatch",
      reason: cod
        ? "The order is cash on delivery, but the mapped shipping option collects nothing: ship it by hand with cash on delivery."
        : "The buyer pays through Allegro, but the mapped shipping option is cash on delivery: the buyer would pay twice. Map an option without cash on delivery.",
    }
  }
  const allegroTotal = form.total ? Math.round(form.total.value * 100) : null
  if (validated.cod === true && (orderTotalMinor === null || allegroTotal === null || orderTotalMinor !== allegroTotal)) {
    return {
      kind: "kept",
      data: own,
      code: "cod_total_mismatch",
      reason: `Cash on delivery would collect the Medusa order total (${minorText(orderTotalMinor)}), but the buyer's Allegro total is ${minorText(allegroTotal)}: ship it by hand with the right amount.`,
    }
  }
  return { kind: "handed", data: merged(validated, own) }
}

const minorText = (minor: number | null): string => (minor === null ? "unknown" : (minor / 100).toFixed(2))

/** The total of the Medusa order an import creates, in minor units: its lines and its delivery. */
export function importTotalMinor(input: { items: ReadonlyArray<{ unit_price: number; quantity: number }>; shipping_methods: ReadonlyArray<{ amount: number }> }): number {
  const minor = (major: number): number => Math.round(major * 100)
  return input.items.reduce((sum, i) => sum + minor(i.unit_price) * i.quantity, 0) + input.shipping_methods.reduce((sum, m) => sum + minor(m.amount), 0)
}
