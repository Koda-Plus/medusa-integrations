/**
 * ROWS OF THE APP MODULE THIS PLUGIN REPLACES. Pure, tested with `node --test`.
 *
 * The Koda Plus demo store ran negotiations as app code before this plugin.
 * Its threads live on in the same tables, so the plugin reads them as they
 * are, without rewriting anything in the migration:
 *
 *   - one `target_price numeric` (major units, no currency) held "the price
 *     on the table": the customer's target while open, the team's counter
 *     after a counter offer (the old counter route overwrote it), the agreed
 *     price once accepted;
 *   - system notes were stored as Polish text: "Kontroferta: 38.5",
 *     "Negocjacja zaakceptowana.", "Negocjacja odrzucona.".
 *
 * The first change the plugin makes to such a thread writes the new columns
 * (`materialize`), after which it is a thread like any other.
 */

import type { NegotiationStatus } from "./constants"
import { amountFromMedusa } from "./money"

export interface Amounts {
  requested: number | null
  offered: number | null
  agreed: number | null
  /** The price on the table. */
  price: number | null
}

/** The amounts of a legacy row from its one price, read by what that price meant in its status. */
export function legacyAmounts(status: NegotiationStatus, targetPrice: unknown, digits: number): Amounts {
  const price = targetPrice === null || targetPrice === undefined || targetPrice === "" ? null : amountFromMedusa(targetPrice, digits)
  if (price === null || price <= 0) return { requested: null, offered: null, agreed: null, price: null }
  if (status === "accepted") return { requested: null, offered: null, agreed: price, price }
  if (status === "counter_offered") return { requested: null, offered: price, agreed: null, price }
  return { requested: price, offered: null, agreed: null, price }
}

/** True for a row that has the old price and none of the new amounts. */
export function isLegacyPriced(row: {
  target_price?: unknown
  requested_amount?: number | null
  offered_amount?: number | null
  agreed_amount?: number | null
  price_amount?: number | null
}): boolean {
  const hasNew = [row.requested_amount, row.offered_amount, row.agreed_amount, row.price_amount].some((v) => typeof v === "number")
  return !hasNew && row.target_price !== null && row.target_price !== undefined && row.target_price !== ""
}

export type LegacySystemKind = "counter" | "accepted" | "rejected"

/** What an old system note said, so the admin can show it in its own language. Null for anything else. */
export function legacySystemNote(body: string | null | undefined): { kind: LegacySystemKind; amountText: string | null } | null {
  const text = String(body ?? "").trim()
  const counter = /^Kontroferta:\s*([\d.,]+)/i.exec(text)
  if (counter) return { kind: "counter", amountText: counter[1].replace(",", ".") }
  if (/^Negocjacja zaakceptowana/i.test(text)) return { kind: "accepted", amountText: null }
  if (/^Negocjacja odrzucona/i.test(text)) return { kind: "rejected", amountText: null }
  return null
}
