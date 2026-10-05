/**
 * THE STATES OF A DOCUMENT ROW, AND WHO MAY MOVE IT. Pure.
 *
 *   pending           queued; the job claims it when `next_attempt_at` is due
 *   issuing           claimed by one process (claim token and lease); the
 *                     request to Fakturownia is in flight
 *   issued            the document exists in Fakturownia (created or adopted)
 *   failed            refused for good (bad data, a conflict, attempts used
 *                     up); waits for a person and "Retry"
 *   unknown           the create request got no answer: reconciled by a
 *                     lookup before anything is sent again; a person can
 *                     "Check in Fakturownia", "Issue again" or "Mark as issued"
 *   canceled          the order was canceled before a document existed, or a
 *                     proforma was rejected in Fakturownia
 *   needs_correction  a VAT invoice or receipt of a canceled order: a person
 *                     issues the correction in Fakturownia (never automatic)
 *
 * A row with a Fakturownia id is never sent again by any road.
 */

import { BACKOFF_SECONDS, MAX_ATTEMPTS, RECONCILE_GRACE_MS } from "./constants"
import { planRetry } from "./backoff"
import { describeError, FakturowniaUnknownResultError } from "./errors"

export type DocumentStatus = "pending" | "issuing" | "issued" | "failed" | "unknown" | "canceled" | "needs_correction"

export interface FailurePlan {
  status: "pending" | "failed" | "unknown"
  nextAttemptAt: Date | null
  code: string
  message: string
}

/**
 * Where a row goes after an attempt failed. `attempts` already counts the
 * failed attempt.
 *
 *   unknown result     unknown, reconciled after the grace period
 *   refusal, transient pending with backoff (429, a network error before the
 *                      request left, a lookup that failed before the create)
 *   anything permanent failed (422 data errors, 401, a conflict, bad order data)
 *   attempts used up   failed
 */
export function planAfterFailure(
  err: unknown,
  args: { attempts: number; now: Date; random?: () => number; maxAttempts?: number; steps?: readonly number[] },
): FailurePlan {
  const d = describeError(err)
  if (err instanceof FakturowniaUnknownResultError) {
    return { status: "unknown", nextAttemptAt: new Date(args.now.getTime() + RECONCILE_GRACE_MS), code: d.code, message: d.message }
  }
  const plan = planRetry({
    attempts: args.attempts,
    retryable: d.retryable,
    maxAttempts: args.maxAttempts ?? MAX_ATTEMPTS,
    steps: args.steps ?? BACKOFF_SECONDS,
    now: args.now,
    random: args.random,
  })
  return { status: plan.status, nextAttemptAt: plan.nextAttemptAt, code: d.code, message: d.message }
}

/** "Retry": a failed row goes back to the queue with its attempts reset. */
export function canRetry(status: string): boolean {
  return status === "failed"
}

/** "Check in Fakturownia": look the document up now. */
export function canReconcile(status: string): boolean {
  return status === "unknown"
}

/** "Issue again": a person checked Fakturownia and the document is not there. The attempt still looks first. */
export function canIssueAgain(status: string): boolean {
  return status === "unknown"
}

/** "Mark as issued": a person found (or issued) the document in Fakturownia and gives its number. */
export function canMarkIssued(status: string): boolean {
  return status === "unknown" || status === "failed"
}

/** States in which an order's document no longer needs the plugin. */
export function isSettled(status: string): boolean {
  return status === "issued" || status === "canceled" || status === "needs_correction"
}

/** States in which no document exists in Fakturownia for sure. */
export function isCertainlyAbsent(status: string): boolean {
  return status === "pending" || status === "failed"
}
