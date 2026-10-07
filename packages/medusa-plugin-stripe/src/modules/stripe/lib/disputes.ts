/**
 * DISPUTES AND THEIR DEADLINES. No runtime imports.
 *
 * A dispute that needs a response has an evidence deadline
 * (`evidence_details.due_by`). Miss it and the money is lost by default, so
 * the panel counts the days and colours them:
 *
 *   overdue   the deadline passed (or Stripe says `past_due`)
 *   urgent    less than 3 days left
 *   soon      less than 7 days left
 *   ok        more time
 *   waiting   nothing to do now: under review at the bank, closed, or no deadline
 *
 * Card networks give 7 to 21 days; BLIK gives 12 calendar days. Przelewy24
 * has no disputes at all.
 */
import { OPEN_DISPUTE_STATUSES, RESPONSE_DISPUTE_STATUSES } from "./constants"
import type { DisputeUrgency } from "./contract"

const DAY_MS = 24 * 60 * 60 * 1000

export function isOpenDispute(status: string | null | undefined): boolean {
  return OPEN_DISPUTE_STATUSES.includes(String(status ?? ""))
}

export function needsResponse(status: string | null | undefined): boolean {
  return RESPONSE_DISPUTE_STATUSES.includes(String(status ?? ""))
}

export interface Deadline {
  dueBy: string | null
  /** Whole days left, rounded up while time is left ("due in 2 days" until the last hour); negative once overdue. */
  daysLeft: number | null
  urgency: DisputeUrgency
}

export function disputeDeadline(args: { status: string | null | undefined; dueBy: number | null | undefined; pastDue?: boolean | null; now: Date }): Deadline {
  const due = typeof args.dueBy === "number" && Number.isFinite(args.dueBy) && args.dueBy > 0 ? args.dueBy * 1000 : null
  const dueBy = due === null ? null : new Date(due).toISOString()
  if (!needsResponse(args.status)) {
    return { dueBy, daysLeft: null, urgency: "waiting" }
  }
  if (due === null) return { dueBy: null, daysLeft: null, urgency: args.pastDue ? "overdue" : "waiting" }
  const msLeft = due - args.now.getTime()
  const daysLeft = msLeft >= 0 ? Math.ceil(msLeft / DAY_MS) : -Math.ceil(-msLeft / DAY_MS)
  let urgency: DisputeUrgency
  if (msLeft < 0 || args.pastDue) urgency = "overdue"
  else if (msLeft < 3 * DAY_MS) urgency = "urgent"
  else if (msLeft < 7 * DAY_MS) urgency = "soon"
  else urgency = "ok"
  return { dueBy, daysLeft, urgency }
}

const URGENCY_ORDER: Record<DisputeUrgency, number> = { overdue: 0, urgent: 1, soon: 2, ok: 3, waiting: 4 }

/** The most pressing first: overdue, then the closest deadline, then those under review. */
export function compareDisputes(a: { urgency: DisputeUrgency; dueBy: string | null; created: string }, b: { urgency: DisputeUrgency; dueBy: string | null; created: string }): number {
  const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
  if (u !== 0) return u
  if (a.dueBy && b.dueBy && a.dueBy !== b.dueBy) return a.dueBy < b.dueBy ? -1 : 1
  return a.created < b.created ? 1 : a.created > b.created ? -1 : 0
}
