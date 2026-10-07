/**
 * WHAT A PERSON SHOULD LOOK AT. No runtime imports beyond the constants.
 *
 * One definition for the panel's "Need a look" filter, the "Paid without an
 * order" check and the board counter, so the three never disagree:
 *
 *   paid without an order  this Medusa's checkout took the money (the session
 *                          is known here), the cart never became an order,
 *                          older than the grace (the webhook or the customer
 *                          may still finish it) and within the window
 *   refund failed          the newest refund of the payment failed: the
 *                          customer did not get the money back
 *
 * A session of another Medusa on the same Stripe account is never this
 * store's business, and a replaced session (the customer changed the method)
 * never took money.
 */
import { ORPHAN_GRACE_MINUTES, ORPHAN_WINDOW_DAYS } from "./constants"
import type { PaymentStatus, SessionKind } from "./contract"

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export interface OrphanFacts {
  status: PaymentStatus
  session: SessionKind | null
  hasOrder: boolean
  /** When the payment was created (ms). */
  createdMs: number
}

export function isOrphan(p: OrphanFacts, now: number): boolean {
  return (
    p.status === "succeeded" &&
    p.session === "known" &&
    !p.hasOrder &&
    p.createdMs >= now - ORPHAN_WINDOW_DAYS * DAY &&
    p.createdMs <= now - ORPHAN_GRACE_MINUTES * MINUTE
  )
}

/** A payment row of the panel: paid without an order, or its newest refund failed. */
export function needsAttention(row: { status: PaymentStatus; session: SessionKind | null; order: unknown; created: string; refundFailed: boolean }, now: number): boolean {
  if (row.refundFailed) return true
  return isOrphan({ status: row.status, session: row.session, hasOrder: Boolean(row.order), createdMs: Date.parse(row.created) || 0 }, now)
}

/** Whether the newest refund of each payment failed, from refunds of any order: payment id to the answer. */
export function newestRefundFailed(refunds: ReadonlyArray<{ paymentIntent: string | null; created: string; status: string }>): Set<string> {
  const newest = new Map<string, { created: string; status: string }>()
  for (const r of refunds) {
    if (!r.paymentIntent) continue
    const seen = newest.get(r.paymentIntent)
    if (!seen || r.created > seen.created) newest.set(r.paymentIntent, { created: r.created, status: r.status })
  }
  return new Set([...newest.entries()].filter(([, r]) => r.status === "failed").map(([id]) => id))
}
