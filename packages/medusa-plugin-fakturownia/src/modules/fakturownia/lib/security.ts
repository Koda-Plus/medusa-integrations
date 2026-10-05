/**
 * TOKEN MASKING. Zero imports, so the unit tests load it without a build.
 *
 * The Fakturownia API token opens the whole invoicing account: documents,
 * clients, bank accounts. It travels only in the `Authorization: Bearer`
 * header of `lib/client.ts`, never in a URL, and every text that goes to a
 * log, the database or the admin passes through `maskSecrets` first.
 *
 * What is masked, in this order:
 *   - every configured secret literally (split and join, no regex, so special
 *     characters in a token cannot break a pattern), and the part before a
 *     slash for tokens shown as `<token>/<account>`;
 *   - `api_token=...` and `"api_token": "..."`, in case an answer or an
 *     error echoes a documented example call;
 *   - `Bearer ...`;
 *   - every base64-like run of 40 or more characters: a token pasted into the
 *     wrong place, one from another account, one after a rotation.
 * Medusa ids (`order_` plus 26 characters), document numbers, NIPs and KSeF
 * numbers stay readable.
 */

const MIN_SECRET_LENGTH = 8

export function maskSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = (s ?? "").trim()
    if (secret.length < MIN_SECRET_LENGTH) continue
    out = out.split(secret).join("***")
    const head = secret.split("/")[0]
    if (head !== secret && head.length >= MIN_SECRET_LENGTH) out = out.split(head).join("***")
  }
  return out
    .replace(/(api_token["']?\s*[:=]\s*["']?)[^&\s"',}]+/gi, "$1***")
    .replace(/(Bearer\s+)[^\s"',}]+/gi, "$1***")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
}

/** The token as the admin may see it: whether it is set, never its value. */
export function tokenState(token: string | null | undefined): "set" | "missing" {
  return (token ?? "").trim().length > 0 ? "set" : "missing"
}
