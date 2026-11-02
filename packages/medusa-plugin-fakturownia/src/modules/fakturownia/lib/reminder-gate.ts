/**
 * THE GATE OF A PAYMENT REMINDER (0.4.0). Zero imports apart from the types.
 *
 * A reminder tells a buyer they owe money, so it goes out only when BOTH
 * sides agree the document is unpaid:
 *
 *   Medusa      the plugin's record (`lib/unpaid.ts`) and the order: no
 *               captured payment covering it
 *   Fakturownia read live (`price_gross` and `paid` of the document), the
 *               books the buyer's bank transfer lands in
 *
 * Fakturownia paid while Medusa is not (a bank import, a payment reverted in
 * Medusa only, a capture that never reached Medusa): no reminder, and the
 * admin says why. Fakturownia could not be read: no reminder either, because
 * a missing reminder costs less than a false one. The amount left to pay is
 * Fakturownia's (`price_gross` minus `paid`): a part payment never produces a
 * reminder for the whole document.
 */

import type { ReminderRefusal } from "./contract"

/** Below half a grosz the document counts as paid in full. */
export const REMINDER_PAID_TOLERANCE = 0.005

export interface ReminderGateInput {
  /** Medusa says unpaid: the plugin's record is unpaid and the order has no captured payment covering it. */
  medusaUnpaid: boolean
  /** The live read of the document in Fakturownia; null when it could not be read. */
  remote: { gross: number | null; paid: number | null } | null
  /** The gross amount the plugin recorded when it issued the document. */
  recordedGross: number | null
}

export type ReminderGateDecision =
  | { send: true; outstanding: number | null; basis: "fakturownia" | "record"; gross: number | null; paid: number | null }
  | { send: false; reason: ReminderRefusal; gross: number | null; paid: number | null }

const round2 = (n: number) => Math.round(n * 100) / 100

function amount(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

export function reminderGate(input: ReminderGateInput): ReminderGateDecision {
  const gross = amount(input.remote?.gross)
  const paid = amount(input.remote?.paid)
  if (!input.medusaUnpaid) return { send: false, reason: "paid_in_medusa", gross, paid }
  if (!input.remote) return { send: false, reason: "fakturownia_unreachable", gross: null, paid: null }
  if (gross !== null && gross > 0) {
    const got = paid ?? 0
    if (got >= gross - REMINDER_PAID_TOLERANCE) return { send: false, reason: "paid_in_fakturownia", gross, paid: got }
    return { send: true, outstanding: round2(gross - got), basis: "fakturownia", gross, paid: got }
  }
  /* A document without an amount in the answer: nothing to compare, the recorded amount stands. */
  const recorded = amount(input.recordedGross)
  return { send: true, outstanding: recorded !== null ? round2(recorded) : null, basis: "record", gross, paid }
}

/** Why a reminder did not go out, for the admin and the history. */
export function reminderRefusalText(decision: Extract<ReminderGateDecision, { send: false }>, currency: string | null): string {
  const cur = currency ? ` ${currency}` : ""
  switch (decision.reason) {
    case "paid_in_medusa":
      return "Medusa has the payment of this document, so no reminder goes out."
    case "paid_in_fakturownia":
      return `Fakturownia has this document paid (${(decision.paid ?? 0).toFixed(2)}${cur} of ${(decision.gross ?? 0).toFixed(2)}${cur}) while Medusa does not, so no reminder goes out. Check the payment, then record it in Medusa or correct it in Fakturownia.`
    case "fakturownia_unreachable":
      return "Fakturownia could not be read, so it is not certain the document is unpaid: no reminder went out. Try again later."
  }
}
