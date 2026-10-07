/**
 * The status of a task and what it implies. Pure, zero imports apart from
 * the constants.
 *
 * Every status can follow every other one: a board is a working surface,
 * not a workflow engine. What a move changes besides the status:
 *
 *   open to done or rejected   `completed_at` becomes now
 *   done to rejected (or back) `completed_at` stays
 *   done or rejected to open   `completed_at` is cleared
 *
 * Rows adopted from the KODA Panel module may carry values outside the lists
 * (they never should: that module had CHECK constraints). They are read as
 * `backlog` and `medium` and stored back as they are until someone changes
 * them.
 */

import { CLOSED_STATUSES, OPEN_STATUSES, URGENT_PRIORITIES, isPriority, isStatus, type TaskPriority, type TaskStatus } from "./constants"

export function normalizeStatus(value: unknown): TaskStatus {
  return isStatus(value) ? value : "backlog"
}

export function normalizePriority(value: unknown): TaskPriority {
  return isPriority(value) ? value : "medium"
}

export function isOpenStatus(status: unknown): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(normalizeStatus(status))
}

export function isClosedStatus(status: unknown): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(normalizeStatus(status))
}

export function isUrgent(priority: unknown, status: unknown): boolean {
  return isOpenStatus(status) && (URGENT_PRIORITIES as readonly string[]).includes(normalizePriority(priority))
}

/** `completed_at` after a status change, by the rules above. */
export function completedAtAfter(from: unknown, to: TaskStatus, current: Date | null, now: Date): Date | null {
  if (!isClosedStatus(to)) return null
  if (isClosedStatus(from)) return current ?? now
  return now
}

/** Sorting rank of priorities, the most pressing first. */
export const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
