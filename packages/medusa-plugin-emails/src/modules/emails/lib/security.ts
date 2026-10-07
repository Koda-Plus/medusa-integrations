/**
 * ADDRESSES AND SECRETS: validation and masking. Zero imports.
 *
 * The plugin never writes a full e-mail address to a log, to its send log
 * or to the admin: "anna.nowak@example.com" becomes "a***@e***.com", enough to
 * tell which of a customer's addresses a message went to. The Resend API key
 * (`re_...`) travels only in the Authorization header of `resend.ts`, and
 * every text that goes to a log, the database or the admin passes through
 * `maskSecrets` first.
 */

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** One e-mail address, as Resend and mail servers take it (no display name). */
export function isEmail(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && EMAIL.test(value)
}

/** "anna.nowak@example.com" becomes "a***@e***.com". Anything that is not an address becomes "***". */
export function maskEmail(value: unknown): string {
  const s = String(value ?? "").trim()
  const at = s.lastIndexOf("@")
  if (at < 1 || at === s.length - 1) return "***"
  const local = s.slice(0, at)
  const domain = s.slice(at + 1)
  const dot = domain.lastIndexOf(".")
  const tld = dot > 0 ? domain.slice(dot) : ""
  return `${local[0]}***@${domain[0]}***${tld}`
}

/** Masks every address in a text (an error message may quote one). */
export function maskEmailsIn(text: unknown): string {
  return String(text ?? "").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
}

const MIN_SECRET_LENGTH = 8

/**
 * Masks the configured secrets literally (split and join, no regex, so no
 * character of a key can break a pattern), then anything shaped like a Resend
 * key (`re_` and a run of letters, digits and underscores), `Bearer ...`, and
 * every base64-like run of 40 or more characters.
 */
export function maskSecrets(text: unknown, secrets: ReadonlyArray<string | null | undefined> = []): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = (s ?? "").trim()
    if (secret.length < MIN_SECRET_LENGTH) continue
    out = out.split(secret).join("***")
  }
  return out
    .replace(/\bre_[A-Za-z0-9_]{6,}/g, "re_***")
    .replace(/(Bearer\s+)[^\s"',}]+/gi, "$1***")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
}

/** What stands in for a hidden link: a valid address that never resolves (`.invalid` is reserved). */
export const HIDDEN_LINK = "https://link.hidden.invalid/"

/**
 * The data of a message with its secret fields hidden (a template's
 * `sensitive` list): a link becomes `HIDDEN_LINK`, any other value "hidden".
 * What the simulated outbox keeps and shows instead of the real message.
 */
export function redactData(data: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  if (fields.length === 0) return data
  const out: Record<string, unknown> = { ...data }
  for (const f of fields) {
    if (!(f in out) || out[f] === null || out[f] === undefined) continue
    out[f] = typeof out[f] === "string" && /^https?:\/\//i.test(String(out[f]).trim()) ? HIDDEN_LINK : "hidden"
  }
  return out
}

/**
 * A stored message with anything shaped like a token taken out: JSON Web
 * Tokens (Medusa's reset tokens are JWTs) and the values of `token`, `code`,
 * `key`, `secret` and `signature` parameters in links. For bodies kept by an
 * older version, before the outbox hid secret fields itself.
 */
export function scrubSecrets(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null
  return String(text)
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, "hidden")
    .replace(/([?&;](?:token|code|key|secret|signature|sig)=)[^&#"'<>\s]+/gi, "$1hidden")
}

/** Addresses and secrets, both, for anything that leaves the provider (logs, the send log, the admin). */
export function maskAll(text: unknown, secrets: ReadonlyArray<string | null | undefined> = []): string {
  return maskSecrets(maskEmailsIn(text), secrets)
}

export interface Sender {
  /** What goes to Resend: `Name <address>` or the bare address. */
  value: string
  name: string | null
  address: string
  domain: string
}

/**
 * The From (or Reply-To) of the options: `orders@mail.example.com` or
 * `Example Store <orders@mail.example.com>`. The display name may not carry
 * line breaks or angle brackets; a name with a comma, a dot or a quote is
 * quoted the way RFC 5322 wants it. Null when there is no valid address.
 */
export function parseSender(value: unknown): Sender | null {
  if (typeof value !== "string") return null
  // eslint-disable-next-line no-control-regex
  const s = value.replace(/[\u0000-\u001F\u007F]/g, " ").trim()
  if (!s || s.length > 320) return null
  const m = /^(.*?)\s*<([^<>\s]+)>$/.exec(s)
  const rawName = m ? m[1].trim() : ""
  const address = (m ? m[2] : s).trim()
  if (!isEmail(address)) return null
  let name = rawName.replace(/^"(.*)"$/, "$1").replace(/[<>"\\]/g, "").trim()
  if (name.length > 100) name = name.slice(0, 100).trim()
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase()
  if (!name) return { value: address, name: null, address, domain }
  const quoted = /[,.;:@()[\]]/.test(name) ? `"${name}"` : name
  return { value: `${quoted} <${address}>`, name, address, domain }
}

/** One address or a list (Reply-To, cc, bcc): only valid addresses, without repeats, at most `max`. */
export function addressList(value: unknown, max = 50): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,;]+/) : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "string") continue
    const sender = parseSender(item)
    if (!sender) continue
    const key = sender.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(sender.value)
    if (out.length >= max) break
  }
  return out
}
