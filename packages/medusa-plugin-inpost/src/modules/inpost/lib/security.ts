/**
 * SECRET MASKING. Zero imports, so the unit tests load it without a build.
 *
 * The ShipX token is a long JWT that opens the whole InPost organization:
 * shipments, labels, cash on delivery reports. It travels only in the
 * `Authorization: Bearer` header of `lib/client.ts`, never in a URL, and every
 * text that goes to a log, the database or the admin passes `maskSecrets`:
 *
 *   - every configured secret literally (split and join, no regex);
 *   - `Bearer ...`;
 *   - every base64-like run of 40 or more characters (a JWT segment, a token
 *     pasted into the wrong place, one after a rotation).
 *
 * Tracking numbers (24 digits), shipment ids, locker codes and Medusa ids
 * stay readable.
 */

const MIN_SECRET_LENGTH = 8

export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = (s ?? "").trim()
    if (secret.length < MIN_SECRET_LENGTH) continue
    out = out.split(secret).join("***")
  }
  return out.replace(/(Bearer\s+)[^\s"',}]+/gi, "$1***").replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
}

/** The token as the admin may see it: whether it is set, never its value. */
export function tokenState(token: string | null | undefined): "set" | "missing" {
  return (token ?? "").trim().length > 0 ? "set" : "missing"
}

/** "abcd...wxyz" for a secret a person needs to recognise (the webhook token), never the whole. */
export function hint(secret: string | null | undefined): string | null {
  const s = (secret ?? "").trim()
  if (!s) return null
  return s.length <= 8 ? "***" : `${s.slice(0, 4)}...${s.slice(-4)}`
}
