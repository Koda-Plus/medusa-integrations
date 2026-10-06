/**
 * THE EVENTS OTHER PLUGINS AND APPS BUILD ON. Pure: the contract is plain data.
 *
 * Six events on the Medusa event bus, each emitted once per move, after the
 * move is stored:
 *
 *   negotiation.opened         a customer opened a thread
 *   negotiation.message_added  a customer or the team wrote (a customer
 *                              message may carry a new target price and move
 *                              a countered thread back to open)
 *   negotiation.countered      the team offered a price
 *   negotiation.accepted       a price was agreed (the customer accepted the
 *                              offer, or the team accepted the target)
 *   negotiation.rejected       the team rejected, or the customer declined
 *   negotiation.expired        nobody moved within the expiry window
 *
 * Internal notes emit nothing. Every event carries the same data
 * (`NegotiationEventData`): the thread after the move, `previous_status`,
 * who moved (`actor`), the message that came with the move, and `demo`. A
 * subscriber that sends e-mails or touches real data must skip
 * `demo: true`.
 *
 * Amounts are decimal strings in major units with the currency's decimals
 * ("469.00", "38.50", "1200" for JPY), never floats; `*_amount` holds the
 * same in minor units. For a cart thread the prices are for the whole cart
 * (`subject: "cart"`), otherwise per unit.
 *
 * THE SHAPE IS A CONTRACT: a separate e-mails plugin codes against it. Add
 * fields or new events; never rename, remove or retype one.
 */

import type { AuthorType, NegotiationStatus, Subject } from "./constants"
import { formatOrNull } from "./money"
import type { ThreadAction } from "./status"
import type { Thread } from "./thread"

export const NEGOTIATION_OPENED = "negotiation.opened"
export const NEGOTIATION_MESSAGE_ADDED = "negotiation.message_added"
export const NEGOTIATION_COUNTERED = "negotiation.countered"
export const NEGOTIATION_ACCEPTED = "negotiation.accepted"
export const NEGOTIATION_REJECTED = "negotiation.rejected"
export const NEGOTIATION_EXPIRED = "negotiation.expired"

export const NEGOTIATION_EVENTS = [
  NEGOTIATION_OPENED,
  NEGOTIATION_MESSAGE_ADDED,
  NEGOTIATION_COUNTERED,
  NEGOTIATION_ACCEPTED,
  NEGOTIATION_REJECTED,
  NEGOTIATION_EXPIRED,
] as const

export type NegotiationEventName = (typeof NEGOTIATION_EVENTS)[number]

export interface NegotiationEventData {
  /** The negotiation id (`neg_...`). */
  id: string
  /** The readable reference, like NEG-2026-1001. */
  ref: string
  /** The status after the move. */
  status: NegotiationStatus
  /** The status before the move; null for `negotiation.opened`. */
  previous_status: NegotiationStatus | null
  /** "product", "variant" or "cart"; prices of a cart thread are for the whole cart. */
  subject: Subject | null
  customer_id: string | null
  product_id: string | null
  variant_id: string | null
  cart_id: string | null
  sku: string | null
  qty: number
  /** The price on the table after the move: the agreed price once accepted. */
  price: string | null
  price_amount: number | null
  /** The customer's latest target, the team's latest offer, the agreed price. */
  requested_price: string | null
  offered_price: string | null
  agreed_price: string | null
  /** Lower case, as Medusa keeps currency codes. */
  currency_code: string | null
  /** When the thread expires under the current options (ISO 8601), or null. */
  expires_at: string | null
  /** Who moved: the customer, the team (`admin`) or the plugin (`system`). */
  actor: AuthorType
  /** The customer id or the admin user id behind the move; null for the plugin. */
  actor_id: string | null
  /** The message stored with the move (`negotiation_message.id`), or null. */
  message_id: string | null
  /** A thread of demo mode: never send e-mails or write real data for it. */
  demo: boolean
}

/** The event a move emits, or null (notes emit nothing). */
export function eventForAction(action: ThreadAction): NegotiationEventName | null {
  switch (action) {
    case "customer_message":
    case "customer_proposal":
    case "admin_message":
      return NEGOTIATION_MESSAGE_ADDED
    case "admin_counter":
      return NEGOTIATION_COUNTERED
    case "customer_accept":
    case "admin_accept":
      return NEGOTIATION_ACCEPTED
    case "customer_decline":
    case "admin_reject":
      return NEGOTIATION_REJECTED
    case "expire":
      return NEGOTIATION_EXPIRED
    case "note":
      return null
  }
}

export function eventData(
  t: Thread,
  move: { previousStatus: NegotiationStatus | null; actor: AuthorType; actorId: string | null; messageId: string | null },
): NegotiationEventData {
  return {
    id: t.id,
    ref: t.ref,
    status: t.status,
    previous_status: move.previousStatus,
    subject: t.subject,
    customer_id: t.customerId,
    product_id: t.productId,
    variant_id: t.variantId,
    cart_id: t.cartId,
    sku: t.sku,
    qty: t.qty,
    price: formatOrNull(t.price, t.digits),
    price_amount: t.price,
    requested_price: formatOrNull(t.requested, t.digits),
    offered_price: formatOrNull(t.offered, t.digits),
    agreed_price: formatOrNull(t.agreed, t.digits),
    currency_code: t.currencyCode,
    expires_at: t.expiresAt ? t.expiresAt.toISOString() : null,
    actor: move.actor,
    actor_id: move.actorId,
    message_id: move.messageId,
    demo: t.demo,
  }
}
