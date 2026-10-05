/**
 * WRITE BARRIER AND SECRET MASKING. Zero imports, so the unit tests load it
 * without a build.
 *
 * The plugin is READ-ONLY towards Allegro and the HTTP verb decides it: the
 * REST API only ever sees GET and HEAD. The two POSTs the plugin sends go to
 * the OAuth server (the device code request and the token endpoint), so they
 * are allowed by exact address, not by verb. A bug in our code ends with an
 * exception here, never with a changed offer or order on the seller's account.
 */

export type Verdict = { ok: true } | { ok: false; reason: string }

const READ_METHODS = new Set(["GET", "HEAD"])

/** The address without its query string: the device request carries `client_id` there. */
function base(url: string): string {
  const i = url.indexOf("?")
  return i === -1 ? url : url.slice(0, i)
}

export function isRequestAllowed(args: {
  method: string
  url: string
  /** OAuth endpoints, the only POST targets: device code request and token. */
  oauthUrls: readonly string[]
}): Verdict {
  const method = args.method.trim().toUpperCase()
  if (READ_METHODS.has(method)) return { ok: true }
  if (method === "POST" && args.oauthUrls.includes(base(args.url))) return { ok: true }
  return {
    ok: false,
    reason: `${method} ${base(args.url)}: the Allegro plugin is read-only; the only allowed POSTs go to ${args.oauthUrls.join(" and ")}.`,
  }
}

export class AllegroWriteBlockedError extends Error {
  readonly method: string
  readonly url: string
  constructor(method: string, url: string, reason: string) {
    super(reason)
    this.name = "AllegroWriteBlockedError"
    this.method = method
    this.url = url
  }
}

/**
 * Masks secrets in text that goes to logs, the database or the admin.
 *
 * First every known secret literally (split/join, no regex), then every
 * base64url run of 40+ characters: that is what Allegro tokens (JWT parts),
 * device codes and client secrets look like. Offer ids (up to 12 digits) and
 * checkout form ids (UUIDs, a dash every few characters) survive.
 */
export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text
  for (const s of secrets) {
    if (s && s.length >= 8) out = out.split(s).join("***")
  }
  return out.replace(/[A-Za-z0-9_-]{40,}/g, "***")
}
