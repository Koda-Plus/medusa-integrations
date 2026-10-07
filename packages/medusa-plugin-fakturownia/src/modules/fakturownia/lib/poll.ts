/**
 * HOW OFTEN THE ADMIN ASKS AGAIN. Zero imports: the hooks of the admin and
 * the tests read the same rule. The order card is mounted on every order
 * page (and in a host's tab), so it must not ask every few seconds for
 * something that only a person, or the next hour, will change.
 *
 *   5 s    a document is being issued right now (`issuing`)
 *   10 s   a queued document is due within a minute
 *   60 s   a queued document due later (a retry, a proforma or KSeF to wait
 *          for), an unknown result waiting for its look, KSeF processing,
 *          an e-mail waiting for the KSeF number
 *   off    nothing moves by itself: issued and final, failed, canceled, or a
 *          correction waiting for the corrections writer (a person)
 *
 * React Query never asks while the tab is hidden (its default), so a
 * forgotten tab costs nothing either.
 */

export interface PollDocument {
  status: string
  govState?: string | null
  nextAttemptAt?: string | null
  emailStatus?: string | null
  errorCode?: string | null
}

export const POLL_ISSUING_MS = 5_000
export const POLL_DUE_MS = 10_000
export const POLL_SLOW_MS = 60_000

/** The interval in ms, or `false` when nothing would change by itself. */
export function pollInterval(docs: readonly PollDocument[], now: number = Date.now()): number | false {
  let best: number | false = false
  const take = (ms: number) => {
    best = best === false ? ms : Math.min(best, ms)
  }
  for (const d of docs) {
    if (d.status === "issuing") take(POLL_ISSUING_MS)
    else if (d.status === "pending") {
      if (d.errorCode === "waiting_for_writer") continue
      const next = d.nextAttemptAt ? Date.parse(d.nextAttemptAt) : now
      take(Number.isFinite(next) && next - now > 60_000 ? POLL_SLOW_MS : POLL_DUE_MS)
    } else if (d.status === "unknown") take(POLL_SLOW_MS)
    if ((d.status === "issued" || d.status === "needs_correction") && d.govState === "processing") take(POLL_SLOW_MS)
    if (d.emailStatus === "pending" || d.emailStatus === "sending") take(POLL_SLOW_MS)
  }
  return best
}
