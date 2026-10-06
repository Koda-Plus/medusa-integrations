/**
 * EXPIRY. Pure, tested with `node --test`.
 *
 * An active thread (open or counter offered) expires when nobody moved for
 * `expiryDays` (14 by default): its clock is the last activity, so every
 * message, offer or new target restarts it, and internal notes do not. A
 * counter offer may carry its own validity ("valid for 7 days"), which then
 * decides instead of the clock, until the next move clears it. `expiryDays: 0`
 * turns the clock off; offers with a validity still expire.
 *
 * Demo threads never expire on their own: the demo story is a fixed set of
 * conversations with its own expired thread, rebuilt every day.
 */

import { isActive } from "./status"

const DAY_MS = 24 * 60 * 60 * 1000

export interface ExpiryFacts {
  status: string
  /** A validity set by a counter offer, or null. */
  expiresAt: Date | null
  lastActivityAt: Date | null
}

/** When the thread expires, or null: closed, no clock and no validity. */
export function effectiveExpiry(t: ExpiryFacts, expiryDays: number): Date | null {
  if (!isActive(t.status)) return null
  if (t.expiresAt) return t.expiresAt
  if (expiryDays <= 0 || !t.lastActivityAt) return null
  return new Date(t.lastActivityAt.getTime() + expiryDays * DAY_MS)
}

export function isOverdue(t: ExpiryFacts, expiryDays: number, now: Date): boolean {
  const at = effectiveExpiry(t, expiryDays)
  return at !== null && at.getTime() <= now.getTime()
}

/** The last activity before which a thread without its own validity is due, or null when the clock is off. */
export function activityCutoff(now: Date, expiryDays: number): Date | null {
  return expiryDays > 0 ? new Date(now.getTime() - expiryDays * DAY_MS) : null
}

/** Expires within the next `withinMs` (two days by default): worth a look before it closes. */
export function expiresSoon(t: ExpiryFacts, expiryDays: number, now: Date, withinMs = 2 * DAY_MS): boolean {
  const at = effectiveExpiry(t, expiryDays)
  if (!at) return false
  const left = at.getTime() - now.getTime()
  return left > 0 && left <= withinMs
}

/** The validity of a counter offer: `days` from now, or null for none. */
export function validityFrom(now: Date, days: number | null | undefined): Date | null {
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? new Date(now.getTime() + days * DAY_MS) : null
}
