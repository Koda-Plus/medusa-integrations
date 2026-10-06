/**
 * THE STATUS MACHINE. Pure: no Medusa import, tested with `node --test`.
 *
 * Five statuses, as in the app module this plugin grew out of:
 *
 *   open             the customer asked (or answered a counter offer with a
 *                    new target); the team owes a move
 *   counter_offered  the team offered a price; the customer may accept it,
 *                    answer with a new target, or decline
 *   accepted         final: a price was agreed (by the customer accepting the
 *                    offer, or by the team accepting the target)
 *   rejected         final: the team rejected, or the customer declined
 *   expired          final: no move within the expiry window
 *
 *   open, counter          ->  counter_offered
 *   counter_offered, new target from the customer  ->  open
 *   open or counter_offered, accept             ->  accepted
 *   open or counter_offered, reject or decline  ->  rejected
 *   open or counter_offered, no activity        ->  expired
 *
 * Messages without a price keep the status; an internal note changes
 * nothing and is allowed on a closed thread too. Every move names the
 * statuses it may start from: the database update is conditional on them,
 * so two people (or a person and the expiry job) can never both close one
 * thread.
 */

import { ACTIVE_STATUSES, STATUSES, type NegotiationStatus, type WaitingFor } from "./constants"

export type ThreadAction =
  /** The customer writes without a price. */
  | "customer_message"
  /** The customer writes with a new target price. */
  | "customer_proposal"
  /** The customer accepts the team's counter offer. */
  | "customer_accept"
  /** The customer declines (closes) the negotiation. */
  | "customer_decline"
  /** The team writes without a price. */
  | "admin_message"
  /** The team offers a price. */
  | "admin_counter"
  /** The team accepts the price on the table. */
  | "admin_accept"
  /** The team rejects. */
  | "admin_reject"
  /** An internal note of the team. */
  | "note"
  /** The expiry job (or a late customer move) closes a stale thread. */
  | "expire"

export type ClosedBy = "customer" | "admin" | "system"

export interface Move {
  /** Statuses the move may start from. */
  from: readonly NegotiationStatus[]
  /** Status after the move; "same" keeps the current one. */
  to: NegotiationStatus | "same"
  /** Whose move it is afterwards; "same" keeps it, null for a closed thread. */
  waitingFor: WaitingFor | null | "same"
  /** Who closes the thread with this move. */
  closedBy: ClosedBy | null
  /** The move counts as activity: it resets the expiry clock. Notes do not. */
  activity: boolean
}

export const MOVES: Readonly<Record<ThreadAction, Move>> = {
  customer_message: { from: ACTIVE_STATUSES, to: "same", waitingFor: "team", closedBy: null, activity: true },
  customer_proposal: { from: ACTIVE_STATUSES, to: "open", waitingFor: "team", closedBy: null, activity: true },
  customer_accept: { from: ["counter_offered"], to: "accepted", waitingFor: null, closedBy: "customer", activity: true },
  customer_decline: { from: ACTIVE_STATUSES, to: "rejected", waitingFor: null, closedBy: "customer", activity: true },
  admin_message: { from: ACTIVE_STATUSES, to: "same", waitingFor: "customer", closedBy: null, activity: true },
  admin_counter: { from: ACTIVE_STATUSES, to: "counter_offered", waitingFor: "customer", closedBy: null, activity: true },
  admin_accept: { from: ACTIVE_STATUSES, to: "accepted", waitingFor: null, closedBy: "admin", activity: true },
  admin_reject: { from: ACTIVE_STATUSES, to: "rejected", waitingFor: null, closedBy: "admin", activity: true },
  note: { from: STATUSES, to: "same", waitingFor: "same", closedBy: null, activity: false },
  expire: { from: ACTIVE_STATUSES, to: "expired", waitingFor: null, closedBy: "system", activity: false },
}

export type MoveRefusal =
  /** The thread is accepted, rejected or expired. */
  | "closed"
  /** Accepting needs a counter offer on the table. */
  | "no_offer"

export type MoveResult = { ok: true; status: NegotiationStatus; waitingFor: WaitingFor | null; closedBy: ClosedBy | null } | { ok: false; reason: MoveRefusal }

export function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status)
}

export function isClosed(status: string): boolean {
  return !isActive(status)
}

/**
 * The status and the turn after a move, or why the move is not possible
 * from the current status.
 */
export function applyMove(current: NegotiationStatus, waiting: WaitingFor | null, action: ThreadAction): MoveResult {
  const move = MOVES[action]
  if (!move.from.includes(current)) {
    if (action === "customer_accept" && current === "open") return { ok: false, reason: "no_offer" }
    return { ok: false, reason: "closed" }
  }
  const status = move.to === "same" ? current : move.to
  const waitingFor = move.waitingFor === "same" ? (isActive(status) ? waiting : null) : move.waitingFor
  return { ok: true, status, waitingFor, closedBy: move.closedBy }
}

/**
 * Whose move it is, for a thread that never stored it (rows of the app
 * module): the team when the customer wrote last, the customer otherwise.
 * Null for a closed thread.
 */
export function inferWaitingFor(status: string, lastAuthor: string | null | undefined): WaitingFor | null {
  if (!isActive(status)) return null
  if (lastAuthor === "customer") return "team"
  if (lastAuthor === "admin" || lastAuthor === "system") return "customer"
  return status === "open" ? "team" : "customer"
}
