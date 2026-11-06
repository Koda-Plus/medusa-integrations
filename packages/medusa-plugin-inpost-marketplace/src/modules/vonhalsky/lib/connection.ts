/**
 * IS THE INTEGRATION STILL CONNECTED? InPost's integration scope asks for an
 * alert when the integration comes apart: the API application deleted or
 * its secret changed in the Merchant Portal, the scopes taken away. The
 * marketplace then deactivates the offers, so a seller must know at once.
 *
 * What counts as "the marketplace refused us":
 *   - the token endpoint refused the credentials (`TOKEN`);
 *   - a 401 (the client already took a fresh token once and was refused again);
 *   - a 403 WITH problem details: the API's own answer. A bare 403 without a
 *     body is InPost's gateway refusing at random; `http.ts` asks again, and
 *     one that still comes back says nothing about the credentials.
 *
 * One refusal can be a hiccup: the alert needs `CONNECTION_ALERT_RUNS` sync
 * runs in a row (or connection checks) refused. A run that reached the
 * marketplace, or a check that worked, clears it.
 */

import { CONNECTION_ALERT_RUNS } from "./constants"
import { isApiError } from "./http"

/** Whether an error says the marketplace no longer takes the credentials. */
export function connectionFailure(err: unknown): boolean {
  if (!isApiError(err)) return false
  /* The token endpoint refused the client (a 5xx of it says nothing about the credentials). */
  if (err.code === "TOKEN") return err.status < 500
  if (err.status === 401) return true
  if (err.status === 403) return err.code !== "HTTP_403" || err.details.length > 0
  return false
}

/** Kept in the settings table under `connection`. */
export interface ConnectionState {
  /** Runs (or checks) in a row the credentials were refused in. */
  failures: number
  /** When the first of them happened (ISO). */
  since: string | null
  /** The last refusal, masked. */
  message: string | null
  /** When the marketplace last answered (ISO). */
  okAt: string | null
}

export const CONNECTION_OK: ConnectionState = { failures: 0, since: null, message: null, okAt: null }

export function connectionStateOf(v: unknown): ConnectionState {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  const str = (x: unknown) => (typeof x === "string" && x ? x : null)
  return { failures: typeof o.failures === "number" && o.failures > 0 ? Math.floor(o.failures) : 0, since: str(o.since), message: str(o.message), okAt: str(o.okAt) }
}

/** The state after one run or check: refused, reached, or neither (nothing asked of the marketplace). */
export function nextConnectionState(prev: ConnectionState, outcome: { refused: string } | { reached: true } | null, now: Date = new Date()): ConnectionState {
  if (!outcome) return prev
  if ("reached" in outcome) return { failures: 0, since: null, message: null, okAt: now.toISOString() }
  return { failures: prev.failures + 1, since: prev.since ?? now.toISOString(), message: outcome.refused.slice(0, 500), okAt: prev.okAt }
}

/** What the admin shows: ok, or since when the connection is lost and why. */
export function connectionView(s: ConnectionState): { ok: boolean; since: string | null; message: string | null } {
  const lost = s.failures >= CONNECTION_ALERT_RUNS
  return { ok: !lost, since: lost ? s.since : null, message: lost ? s.message : null }
}
