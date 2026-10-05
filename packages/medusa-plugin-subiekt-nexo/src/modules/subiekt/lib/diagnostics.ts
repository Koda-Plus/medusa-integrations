/**
 * BRIDGE DIAGNOSTICS for the admin: the clock skew that breaks signatures,
 * the signature verdict of the last check, latency. Pure, tested.
 */

import { CLOCK_SKEW_LIMIT_SECONDS, CLOCK_SKEW_WARN_SECONDS } from "./constants"
import type { SignatureState } from "./contract"

/**
 * Bridge clock minus Medusa clock in milliseconds. The bridge stamped `time`
 * somewhere between our request and its answer; the midpoint is the best
 * guess, so half the round trip is the error bar. Null without a usable time.
 */
export function clockSkewMs(bridgeTime: string | null | undefined, startedAtMs: number, finishedAtMs: number): number | null {
  if (!bridgeTime) return null
  const bridge = Date.parse(bridgeTime)
  if (!Number.isFinite(bridge) || !Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) return null
  return Math.round(bridge - (startedAtMs + (finishedAtMs - startedAtMs) / 2))
}

/** `ok` under a minute, `warn` up to the 300 s signature window, `error` beyond: every request fails then. */
export function skewLevel(skewMs: number | null): "ok" | "warn" | "error" | "unknown" {
  if (skewMs === null) return "unknown"
  const s = Math.abs(skewMs) / 1000
  if (s < CLOCK_SKEW_WARN_SECONDS) return "ok"
  return s < CLOCK_SKEW_LIMIT_SECONDS ? "warn" : "error"
}

/** What the last signed request taught us about the signatures. */
export function signatureState(lastCode: string | null | undefined, succeeded: boolean): SignatureState {
  if (succeeded) return "ok"
  switch (lastCode) {
    case "invalid_signature":
      return "invalid_signature"
    case "stale_timestamp":
      return "stale_timestamp"
    case "forbidden":
      return "forbidden"
    case "timeout":
    case "bridge_unreachable":
    case "bridge_unavailable":
      return "unreachable"
    default:
      return "unknown"
  }
}
