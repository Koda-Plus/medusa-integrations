import type { CodCurrency } from "./constants"
import type { PlanWarningDto, ProblemDto } from "./contract"
import { firstMinor, formatMinor, toMinor } from "./money"
import type { PlanOrder } from "./plan"

/**
 * CASH ON DELIVERY: what the courier takes from the customer. Pure.
 *
 * The amount is the order total minus what was already captured, in minor
 * units and to the cent (money.ts), sent as "249.90" (a dot, two decimals:
 * the sandbox refuses a comma). One shipment of an order carries the cash on
 * delivery (codCarrierOf in the flows); its siblings go without it. An order
 * paid online never gets cash on delivery: the customer would pay twice.
 */

/** summary.raw_current_order_total, summary.current_order_total, raw_total, total: the first usable, in minor units. */
export function orderTotalMinor(order: PlanOrder): number | null {
  return firstMinor(order.summary?.raw_current_order_total, order.summary?.current_order_total, order.raw_total, order.total)
}

/** Sum of payment_collections[].captured_amount in minor units. */
export function capturedMinor(order: PlanOrder | null): number {
  let sum = 0
  for (const pc of order?.payment_collections ?? []) {
    const m = toMinor(pc?.captured_amount)
    if (m !== null && m > 0) sum += m
  }
  return sum
}

/** Providers of non canceled payments outside codPaymentProviders. */
export function onlinePaymentProviders(order: PlanOrder | null, codProviders: readonly string[]): string[] {
  const out: string[] = []
  for (const pc of order?.payment_collections ?? []) {
    for (const p of pc?.payments ?? []) {
      const provider = typeof p?.provider_id === "string" ? p.provider_id : ""
      if (!provider || (p?.canceled_at !== null && p?.canceled_at !== undefined)) continue
      if (!codProviders.includes(provider) && !out.includes(provider)) out.push(provider)
    }
  }
  return out
}

export type CodPlan = { minor: number; amount: string; currency: CodCurrency }

/**
 * The cash on delivery of one shipment. The rules in order, the first that
 * applies ends it:
 *
 *   1. the option has no cash on delivery: none
 *   2. the country has no entry in codCountries: cod_country_unsupported
 *   3. the order currency is not one of the country's (PL takes PLN only):
 *      cod_currency_unsupported
 *   4. a payment outside codPaymentProviders: cod_paid_online
 *   5. another shipment of the order carries it: none, cod_on_other_parcel
 *   6. no order total: cod_amount_unknown
 *   7. nothing left to pay: cod_zero
 *   8. the rest to pay, with order_paid (and the captured amount) when part was captured
 */
export function codFor(args: {
  optionCod: boolean
  /** Destination country (upper case) or null. */
  country: string | null
  order: PlanOrder
  options: { codCountries: Readonly<Record<string, readonly CodCurrency[]>>; codPaymentProviders: readonly string[] }
  /** This row carries the order's cash on delivery (codCarrierOf); undefined reads as true. */
  carrier?: boolean
}): { cod: CodPlan | null; problems: ProblemDto[]; warnings: PlanWarningDto[] } {
  const none = (problems: ProblemDto[] = [], warnings: PlanWarningDto[] = []) => ({ cod: null, problems, warnings })
  if (!args.optionCod) return none()
  const country = (args.country ?? "").toUpperCase()
  const currencies = country ? args.options.codCountries[country] : undefined
  if (!currencies) return none([{ code: "cod_country_unsupported", ...(country ? { detail: country } : {}) }])
  const currency = String(args.order.currency_code ?? "").trim().toUpperCase()
  const allowed = (currencies as readonly string[]).includes(currency) && (country !== "PL" || currency === "PLN")
  if (!allowed) return none([{ code: "cod_currency_unsupported", detail: currency || "?" }])
  const online = onlinePaymentProviders(args.order, args.options.codPaymentProviders)
  if (online.length > 0) return none([{ code: "cod_paid_online", detail: online.join(", ") }])
  if (args.carrier === false) return none([], [{ code: "cod_on_other_parcel" }])
  const total = orderTotalMinor(args.order)
  if (total === null) return none([{ code: "cod_amount_unknown" }])
  const captured = capturedMinor(args.order)
  const due = total - captured
  if (due <= 0) return none([{ code: "cod_zero" }])
  /* detail stays for the logs; amount lets the admin format the money in its own locale. */
  const warnings: PlanWarningDto[] = captured > 0 ? [{ code: "order_paid", detail: formatMinor(captured), amount: { minor: captured, currency } }] : []
  return { cod: { minor: due, amount: formatMinor(due), currency: currency as CodCurrency }, problems: [], warnings }
}
