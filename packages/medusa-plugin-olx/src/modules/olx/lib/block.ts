/**
 * THE IP BLOCK PAUSE. OLX blocks an IP for 30 minutes after 4 500 requests in
 * 5 minutes and answers 403 meanwhile (developer.olx.pl, "Częste pytania",
 * point 11). Every further request in that window only extends the trouble,
 * so once the client has seen the block, every job of this process waits.
 * Zero imports; one holder per process.
 */

const KEY = Symbol.for("koda.olx.blockedUntil")

type Holder = typeof globalThis & { [KEY]?: number }

export function noteIpBlock(now: number, pauseMs: number): void {
  ;(globalThis as Holder)[KEY] = now + pauseMs
}

/** Epoch milliseconds until which requests wait, or null. */
export function ipBlockedUntil(now: number): number | null {
  const until = (globalThis as Holder)[KEY] ?? 0
  return until > now ? until : null
}

export function clearIpBlock(): void {
  ;(globalThis as Holder)[KEY] = 0
}
