/**
 * WRITE BARRIER, SECRET MASKING AND THE `state` CHECK. Pure functions: the
 * unit tests load them without a build.
 *
 * READS ARE FREE, WRITES ARE A SHORT LIST. The Partner API sees GET and HEAD
 * at any time. The only POST that needs no writer is the OAuth token
 * exchange. Everything else must be one of three writes, and only while the
 * writer that owns it is armed for the call:
 *
 *   lifecycle   POST /adverts/{id}/commands  with command activate, deactivate or finish
 *   price       PUT  /adverts/{id}           (the whole advert, price changed)
 *   publish     POST /adverts                (a new advert)
 *
 * Deleting adverts, buying packets or paid features, the `extend` command,
 * thread commands and messages are not on the list, so a bug in our code ends
 * with an exception here, never with money spent or an advert deleted.
 */

import { OlxWriteBlockedError } from "./errors"

export { OlxWriteBlockedError }

export type Verdict = { ok: true } | { ok: false; reason: string }

export type WriteKind = "lifecycle" | "price" | "publish"

/** Commands the lifecycle writer may send. `extend` is left out on purpose. */
export const LIFECYCLE_COMMANDS: readonly string[] = ["activate", "deactivate", "finish"]

const READ_METHODS = new Set(["GET", "HEAD"])

export interface BarrierArgs {
  method: string
  url: string
  tokenUrl: string
  /** Partner API base, e.g. `https://www.olx.pl/api/partner`. Without it nothing but reads passes. */
  apiBase?: string
  /** Body of the request, checked for commands. */
  body?: unknown
  /** Writers armed for this very call. Empty or missing: read-only. */
  allow?: readonly WriteKind[]
}

/** Which writer a request belongs to, or null when it is not one of the three writes. */
export function writeKindOf(method: string, url: string, apiBase: string | undefined, body?: unknown): WriteKind | null {
  if (!apiBase) return null
  const m = method.trim().toUpperCase()
  const base = apiBase.replace(/\/+$/, "")
  if (!url.startsWith(`${base}/`)) return null
  const path = url.slice(base.length)
  if (path.includes("?") || path.includes("#")) return null
  if (m === "POST" && /^\/adverts\/\d+\/commands$/.test(path)) {
    const command = body && typeof body === "object" ? (body as Record<string, unknown>).command : undefined
    return typeof command === "string" && LIFECYCLE_COMMANDS.includes(command) ? "lifecycle" : null
  }
  if (m === "PUT" && /^\/adverts\/\d+$/.test(path)) return "price"
  if (m === "POST" && path === "/adverts") return "publish"
  return null
}

export function isRequestAllowed(args: BarrierArgs): Verdict {
  const method = args.method.trim().toUpperCase()
  if (READ_METHODS.has(method)) return { ok: true }
  if (method === "POST" && args.url === args.tokenUrl) return { ok: true }
  const kind = writeKindOf(method, args.url, args.apiBase, args.body)
  if (!kind) {
    return {
      ok: false,
      reason: `${method} ${args.url}: not one of the writes this plugin may send (advert commands activate, deactivate and finish, an advert update, a new advert).`,
    }
  }
  if (!(args.allow ?? []).includes(kind)) {
    return { ok: false, reason: `${method} ${args.url}: the ${kind} writer is not armed for this call.` }
  }
  return { ok: true }
}

/**
 * Masks secrets in text that goes to logs, the database or the admin.
 *
 * First every known secret literally (split/join, no regex), then every
 * base64url run of 40+ characters: that is what OLX tokens, authorization
 * codes and client secrets look like. Advert ids (9 to 10 digits) and advert
 * URLs survive, because they have dashes and dots every few characters.
 */
export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("***")
  }
  return out.replace(/[A-Za-z0-9_-]{40,}/g, "***")
}

/**
 * The `state` parameter of the OAuth callback.
 *
 * `state` is our one-time nonce: it goes to OLX in the consent URL and comes
 * back in the callback. Without the comparison anybody who knows the public
 * callback URL could slip us a code of a foreign OLX account. Literal
 * comparison, both sides non-empty, not expired.
 */
export function verifyState(args: {
  saved: string | null | undefined
  expiresAt: Date | string | null | undefined
  received: string | null | undefined
  now: Date
}): Verdict {
  const saved = String(args.saved ?? "").trim()
  const received = String(args.received ?? "").trim()
  if (!saved) return { ok: false, reason: "No connection attempt in progress. Start from the OLX page in the admin." }
  if (!received) return { ok: false, reason: "OLX did not send back the state parameter." }
  const expires =
    args.expiresAt instanceof Date ? args.expiresAt.getTime() : Date.parse(String(args.expiresAt ?? ""))
  if (!Number.isFinite(expires) || expires <= args.now.getTime()) {
    return { ok: false, reason: "The connection attempt expired before OLX sent the consent. Start again." }
  }
  if (saved !== received) return { ok: false, reason: "The state parameter does not match the connection attempt." }
  return { ok: true }
}

/** Whether a granted OAuth scope string carries `write`. OLX returns it space separated, e.g. "v2 read write". */
export function hasWriteScope(scope: string | null | undefined): boolean {
  return String(scope ?? "")
    .split(/[\s,+]+/)
    .map((s) => s.trim().toLowerCase())
    .includes("write")
}
