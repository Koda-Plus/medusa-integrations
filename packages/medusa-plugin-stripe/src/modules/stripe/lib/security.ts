/**
 * THE KEY, MASKING AND SAFE IDS. No runtime imports.
 *
 * The plugin needs only reads. Stripe's restricted keys (`rk_live_...`) can
 * be limited to exactly that, so the panel recommends one and says so when
 * a full secret key (`sk_live_...`) is configured. A publishable key
 * (`pk_...`) cannot read anything and is refused outright.
 *
 * Everything that goes to a log, a cached error or the admin passes through
 * `maskSecrets` first: the configured key literally, then every Stripe key,
 * webhook secret and client secret by its shape.
 */
import type { KeyInfoDto, KeyKind } from "./contract"

/** Kind, mode and last four characters of a Stripe key. Never more than four characters of it. */
export function keyInfo(key: string | null | undefined): KeyInfoDto {
  const k = String(key ?? "").trim()
  if (!k) return { kind: null, mode: null, last4: null }
  const m = /^(sk|rk|pk)_(live|test)_/.exec(k)
  const kind: KeyKind = m ? (m[1] === "sk" ? "secret" : m[1] === "rk" ? "restricted" : "publishable") : "unknown"
  const mode = m ? (m[2] as "live" | "test") : null
  return { kind, mode, last4: k.length >= 12 ? k.slice(-4) : null }
}

/** A key the plugin may use to read: a secret or a restricted key. */
export function canRead(info: KeyInfoDto): boolean {
  return info.kind === "secret" || info.kind === "restricted"
}

const MIN_SECRET_LENGTH = 8

/**
 * Masks secrets in text that leaves the request: every configured secret
 * literally (split and join, no regex), then Stripe keys (`sk_`, `rk_`,
 * `pk_`), webhook secrets (`whsec_`), client secrets (`pi_..._secret_...`),
 * bearer tokens and any 40+ character token-like run. Stripe object ids
 * (pi_, ch_, txn_, acct_...) stay readable: they are shorter and not secret.
 */
export function maskSecrets(text: unknown, secrets: readonly (string | null | undefined)[] = []): string {
  let out = String(text ?? "")
  for (const s of secrets) {
    const secret = String(s ?? "").trim()
    if (secret.length >= MIN_SECRET_LENGTH) out = out.split(secret).join("***")
  }
  return out
    .replace(/\b((?:sk|rk|pk)_(?:live|test)_)[A-Za-z0-9*]{4,}/g, "$1***")
    .replace(/\bwhsec_[A-Za-z0-9]+/g, "whsec_***")
    .replace(/\b((?:pi|seti|pm|src)_[A-Za-z0-9]+)_secret_[A-Za-z0-9]+/g, "$1_secret_***")
    .replace(/(Bearer\s+)[^\s"',}]+/gi, "$1***")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "***")
}

/**
 * An id fit for a Stripe URL path: the expected prefix, then letters,
 * digits and underscores only. Ids come from Medusa's payment data and from
 * Stripe; nothing else ever reaches a path.
 */
export function safeStripeId(id: unknown, prefix: string): string | null {
  if (typeof id !== "string") return null
  const v = id.trim()
  if (!v.startsWith(`${prefix}_`)) return null
  return /^[a-z]{2,8}_[A-Za-z0-9_]{6,255}$/.test(v) ? v : null
}

/** The restricted key permission Stripe names in a 403 ("Having the 'rak_charge_read' permission would allow..."). */
export function permissionFrom(message: unknown): string | null {
  const m = /'(rak_[a-z0-9_]+)'/i.exec(String(message ?? ""))
  return m ? m[1].toLowerCase() : null
}
