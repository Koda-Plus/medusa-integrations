/**
 * WRITE BARRIER, SECRET MASKING AND THE `state` CHECK. Zero imports, so the
 * unit tests load it without a build.
 *
 * The plugin is READ-ONLY towards OLX and the HTTP verb decides it: the
 * Partner API only ever sees GET and HEAD. The single POST the plugin sends
 * goes to the OAuth token endpoint (code exchange and refresh), so it is
 * allowed by exact URL, not by verb. A bug in our code ends with an exception
 * here, never with a changed advert on the seller's account.
 */

export type Verdict = { ok: true } | { ok: false; reason: string }

const READ_METHODS = new Set(["GET", "HEAD"])

export function isRequestAllowed(args: { method: string; url: string; tokenUrl: string }): Verdict {
  const method = args.method.trim().toUpperCase()
  if (READ_METHODS.has(method)) return { ok: true }
  if (method === "POST" && args.url === args.tokenUrl) return { ok: true }
  return {
    ok: false,
    reason: `${method} ${args.url}: the OLX plugin is read-only; the only allowed POST is the token exchange at ${args.tokenUrl}.`,
  }
}

export class OlxWriteBlockedError extends Error {
  readonly method: string
  readonly url: string
  constructor(method: string, url: string, reason: string) {
    super(reason)
    this.name = "OlxWriteBlockedError"
    this.method = method
    this.url = url
  }
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
