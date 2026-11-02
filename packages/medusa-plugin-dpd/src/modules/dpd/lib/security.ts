/**
 * SECRET MASKING. Zero imports, so the unit tests load it without a build.
 *
 * DPDServices, InfoServices and MyPudoAPI take a login and a password (HTTP
 * Basic, or a SOAP auth block), and MyPudoAPI may take a key in the URL
 * instead. Every text that goes to a log, the database or the admin passes
 * `maskSecrets`:
 *
 *   - every configured secret literally (split and join, no regex);
 *   - the credentials of `Basic ...` and `Bearer ...` headers;
 *   - the value of a `key=` query parameter (the MyPudoAPI key in a URL that
 *     ends up in an error message);
 *   - every base64-like run of 40 or more characters (a credential pasted
 *     into the wrong place, a token after a rotation).
 *
 * Waybills (14 digits), FIDs, Pickup point ids and Medusa ids stay readable.
 */

const MIN_SECRET_LENGTH = 6

export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = (s ?? "").trim()
    if (secret.length < MIN_SECRET_LENGTH) continue
    out = out.split(secret).join("***")
  }
  return out
    .replace(/((?:Basic|Bearer)\s+)[^\s"',}]+/gi, "$1***")
    .replace(/([?&;]key=)[^&\s"'#]+/gi, "$1***")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
}

/** A secret as the admin may see it: whether it is set, never its value. */
export function secretState(secret: string | null | undefined): "set" | "missing" {
  return (secret ?? "").trim().length > 0 ? "set" : "missing"
}

/** "abcd...wxyz" for a value a person needs to recognise, never the whole; "***" when it is too short to show a part. */
export function hint(secret: string | null | undefined): string | null {
  const s = (secret ?? "").trim()
  if (!s) return null
  return s.length <= 8 ? "***" : `${s.slice(0, 4)}...${s.slice(-4)}`
}
