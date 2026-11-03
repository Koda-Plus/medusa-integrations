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
 * answer next to its own `vonhalsky_*` keys. No package is imported: any
 * provider answers through Medusa's fulfillment module.
 *
 * HANDED OVER ONLY WHEN IT IS RIGHT. The provider's answer is kept only
 * when it still carries the parcel locker of a locker delivery and, when it
 * names cash on delivery, agrees with how the marketplace was paid. Otherwise
 * the order keeps only our keys (what it carried before), the import goes on
 * and the sync log says why: a wrong parcel is worse than a parcel a person
 * sends by hand.
 */

import type { MarketplaceOrder } from "./client"
import type { MedusaAddressInput } from "./orders"

type Data = Record<string, unknown>

/** What the import sends the provider: the method data a storefront would send, and the order as the context. */
export interface HandoffRequest {
  data: Data
  context: { currency_code: string; shipping_address: MedusaAddressInput }
}

export type HandoffKeptCode = "demo" | "no_option" | "refused" | "payment_unknown" | "locker_dropped" | "cod_mismatch" | "cod_total_mismatch"

export type HandoffOutcome =
  | { kind: "handed"; data: Data }
  /** The order keeps only our own keys; `reason` goes to the sync log (not for `demo` and `no_option`). */
  | { kind: "kept"; data: Data; code: HandoffKeptCode; reason: string }

/** The locker keys a storefront sends (the InPost geowidget shape) and providers read. */
const LOCKER_KEYS = ["machine_id", "target_point", "locker_code", "point"] as const

/**
 * The request for the provider. A locker delivery names its locker the way
 * InPost's geowidget does (`machine_id`, `machine_name`); a courier sends no
 * data, the provider reads the address from the context.
 */
export function handoffRequest(order: MarketplaceOrder, context: HandoffRequest["context"]): HandoffRequest {
  const point = lockerOf(order)
  return { data: point ? { machine_id: point, machine_name: point } : {}, context }
}

function lockerOf(order: MarketplaceOrder): string | null {
  if (order.delivery.type !== "APM") return null
  const point = String(order.delivery.point ?? "").trim()
  return point ? point : null
}

const code = (v: unknown): string => String(v ?? "").replace(/\s+/g, "").toUpperCase()

/** Our keys win: the provider never overwrites what the import itself recorded. */
const merged = (validated: Data, own: Data): Data => ({ ...validated, ...own })

/** Kept without a provider: demo orders, and orders without a mapped shipping option. */
export function keptWithoutProvider(own: Data, why: "demo" | "no_option"): HandoffOutcome {
  return {
    kind: "kept",
    data: own,
    code: why,
    reason:
      why === "demo"
        ? "Demo order: not handed to the shipping provider, so a simulated order never becomes a real parcel."
        : "No shipping option is mapped for this delivery: a person picks it when fulfilling.",
  }
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
export function handoffResult(order: MarketplaceOrder, own: Data, validated: Data, orderTotalMinor: number | null): HandoffOutcome {
  const payment = String(order.paymentType ?? "").trim().toUpperCase()
  if (!payment || payment === "UNKNOWN") {
    return {
      kind: "kept",
      data: own,
      code: "payment_unknown",
      reason: "The marketplace did not say how the buyer pays, so it is not known whether the parcel collects cash on delivery: ship it by hand.",
    }
  }
  const locker = lockerOf(order)
  if (locker) {
    const kept = LOCKER_KEYS.map((k) => code(validated[k])).find(Boolean)
    if (!kept) {
      return {
        kind: "kept",
        data: own,
        code: "locker_dropped",
        reason: `The marketplace delivers to parcel locker ${locker}, but the mapped shipping option does not ship to a locker. Map a parcel locker option for APM deliveries.`,
      }
    }
  }
  if (typeof validated.cod === "boolean" && validated.cod === order.paid) {
    return {
      kind: "kept",
      data: own,
      code: "cod_mismatch",
      reason: order.paid
        ? "The marketplace collected the payment, but the mapped shipping option is cash on delivery: the buyer would pay twice. Map an option without cash on delivery."
        : "The order is cash on delivery, but the mapped shipping option collects nothing: ship it by hand with cash on delivery.",
    }
  }
  if (validated.cod === true && (orderTotalMinor === null || order.totalMinor === null || orderTotalMinor !== order.totalMinor)) {
    return {
      kind: "kept",
      data: own,
      code: "cod_total_mismatch",
      reason: `Cash on delivery would collect the Medusa order total (${minorText(orderTotalMinor)}), but the buyer's marketplace total is ${minorText(order.totalMinor)}: ship it by hand with the right amount.`,
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
