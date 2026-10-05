/**
 * ONE OUTBOX ITEM, EXACTLY ONCE. Pure state machine; the calls come in
 * through ports, so it runs in unit tests against fakes. Zero imports
 * beyond the constants.
 *
 *   1. the row exists before anything is sent (unique key per parcel,
 *      status or invoice);
 *   2. an atomic claim with a lease;
 *   3. a LOOKUP on Allegro before every send: the parcel number may already
 *      be on the order (the seller panel, the carrier), the invoice may
 *      already be there, the status may already be set;
 *   4. an unclear answer (no response, a 5xx to a non-idempotent call)
 *      becomes `unknown`, and the next attempt starts with the lookup.
 *      Nothing is sent blindly twice.
 */

import { OUTBOX_MAX_ATTEMPTS } from "./constants"

export interface OutboxItem {
  id: string
  status: string
  attempts: number
  payload: Record<string, unknown> | null
}

/** What the lookup found: the thing is already on Allegro (done), or not. */
export type Lookup = { found: true; result: Record<string, unknown> } | { found: false }

/** What sending produced. `skip` ends the item without sending (nothing to do, or not allowed). */
export type SendResult = { kind: "sent"; result: Record<string, unknown> } | { kind: "skip"; reason: string; result?: Record<string, unknown> }

export interface OutboxPorts {
  now(): Date
  token(): string
  claim(item: OutboxItem, token: string): Promise<OutboxItem | null>
  finish(item: OutboxItem, token: string, patch: Record<string, unknown>): Promise<boolean>
  lookup(item: OutboxItem): Promise<Lookup>
  send(item: OutboxItem): Promise<SendResult>
}

export type OutboxOutcome =
  | { kind: "busy" }
  | { kind: "done"; adopted: boolean }
  | { kind: "skipped"; reason: string }
  | { kind: "unknown"; reason: string }
  | { kind: "retry"; reason: string; systemic: boolean }
  | { kind: "failed"; reason: string }
  | { kind: "lost" }

export interface ErrorShape {
  /** Unclear: the request may have reached Allegro. */
  unclear?: boolean
  status?: number
  transient?: boolean
  message: string
}

export function classify(err: unknown): ErrorShape {
  const e = err as { name?: unknown; status?: unknown; transient?: unknown; message?: unknown } | null
  const message = String(e?.message ?? err).slice(0, 800)
  if (e?.name === "AllegroUnclearError") return { unclear: true, status: Number(e.status) || 0, message }
  const status = Number(e?.status)
  return { status: Number.isFinite(status) ? status : 0, transient: e?.transient === true, message }
}

/** Backoff of a transient failure: 1, 2, 4, 8, 16 minutes, then hourly. */
export function outboxDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000
}

export async function processOutboxItem(item: OutboxItem, ports: OutboxPorts, mask: (s: string) => string = (s) => s): Promise<OutboxOutcome> {
  const token = ports.token()
  const claimed = await ports.claim(item, token)
  if (!claimed) return { kind: "busy" }
  const now = ports.now()
  const done = async (patch: Record<string, unknown>, outcome: OutboxOutcome): Promise<OutboxOutcome> =>
    (await ports.finish(claimed, token, patch)) ? outcome : { kind: "lost" }

  const failure = async (err: unknown, stage: "lookup" | "send"): Promise<OutboxOutcome> => {
    const e = classify(err)
    const reason = mask(e.message)
    if (e.unclear) {
      return done(
        { status: "unknown", last_error: `${reason} The next attempt looks it up on Allegro first.`, next_attempt_at: new Date(now.getTime() + 60_000) },
        { kind: "unknown", reason },
      )
    }
    const status = e.status ?? 0
    const systemic = status === 0 || status === 401 || status === 403 || status === 429 || status >= 500 || e.transient === true || stage === "lookup"
    if (systemic) {
      if (claimed.attempts >= OUTBOX_MAX_ATTEMPTS) {
        return done({ status: "failed", last_error: `Failed ${claimed.attempts} times. Last error: ${reason}` }, { kind: "failed", reason })
      }
      return done(
        { status: "pending", last_error: reason, next_attempt_at: new Date(now.getTime() + outboxDelayMs(claimed.attempts)) },
        { kind: "retry", reason, systemic: true },
      )
    }
    /* A 4xx about this very item (a waybill Allegro refuses, a line that is not in the order): a person has to look. */
    return done({ status: "failed", last_error: reason }, { kind: "failed", reason })
  }

  let lookup: Lookup
  try {
    lookup = await ports.lookup(claimed)
  } catch (err) {
    return failure(err, "lookup")
  }
  if (lookup.found) {
    return done({ status: "done", result: { ...lookup.result, adopted: true }, done_at: now, last_error: null }, { kind: "done", adopted: true })
  }

  let sent: SendResult
  try {
    sent = await ports.send(claimed)
  } catch (err) {
    return failure(err, "send")
  }
  if (sent.kind === "skip") {
    return done({ status: "skipped", last_error: sent.reason, result: sent.result ?? null, done_at: now }, { kind: "skipped", reason: sent.reason })
  }
  return done({ status: "done", result: sent.result, done_at: now, last_error: null }, { kind: "done", adopted: false })
}
