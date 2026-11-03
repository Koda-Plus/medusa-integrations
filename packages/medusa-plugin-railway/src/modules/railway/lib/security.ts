/**
 * THE QUERY GUARD, MASKING AND SAFE IDS. No runtime imports.
 *
 * A Railway project token is NOT read only: it can redeploy, delete a
 * service or change a variable. Railway has no read-only token, so the
 * plugin keeps itself read only: every document goes through
 * `assertReadOnlyDocument` before it is sent, and a document that so much
 * as contains the word "mutation" (or "subscription") is refused.
 *
 * Everything that leaves the server (a log line, a commit message, an error)
 * passes through `maskSecrets` first: the token literally, then the shapes
 * secrets have in logs (credentials in URLs, API keys, bearer tokens, JWTs,
 * NAME=value of a secret-named variable, long token-like runs).
 */

export class ForbiddenDocumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ForbiddenDocumentError"
  }
}

/** The document without comments and string literals, for the operation check. */
export function stripDocument(doc: string): string {
  return doc
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/#[^\n]*/g, "")
}

/**
 * Throws unless the document is a plain query. Refused: the word "mutation"
 * or "subscription" anywhere (also inside a string or a comment: there is
 * no reason for it to be there), and a document that does not start with
 * `query` or a selection set.
 */
export function assertReadOnlyDocument(doc: unknown): string {
  if (typeof doc !== "string" || !doc.trim()) throw new ForbiddenDocumentError("Empty GraphQL document.")
  if (/mutation/i.test(doc)) throw new ForbiddenDocumentError("Refused a GraphQL document with a mutation: the plugin only reads Railway.")
  if (/subscription/i.test(doc)) throw new ForbiddenDocumentError("Refused a GraphQL subscription: the plugin only sends queries.")
  const body = stripDocument(doc).trim()
  if (!/^(query\b|\{)/.test(body)) throw new ForbiddenDocumentError("Refused a GraphQL document that is not a query.")
  return doc
}

const MIN_SECRET_LENGTH = 8

/** Names of variables whose value is a secret, for NAME=value in logs. */
const SECRET_NAME = "[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Za-z0-9_]*"

const RULES: Array<[RegExp, string]> = [
  /* scheme://user:password@host: postgres, redis, mysql, mongodb, amqp, https... */
  [/\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@'"]*):([^\s@/'"]+)@/gi, "$1$2:***@"],
  /* Stripe keys and webhook secrets. */
  [/\b((?:sk|rk|pk)_(?:live|test)_)[A-Za-z0-9*]{4,}/g, "$1***"],
  [/\bwhsec_[A-Za-z0-9]{4,}/g, "whsec_***"],
  /* Resend keys (re_...), GitHub, npm, Slack, AWS. */
  [/\bre_[A-Za-z0-9]{6,}(?:_[A-Za-z0-9]+)?/g, "re_***"],
  [/\bgh[pousr]_[A-Za-z0-9]{10,}/g, "gh_***"],
  [/\bnpm_[A-Za-z0-9]{10,}/g, "npm_***"],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, "xox-***"],
  [/\bAKIA[0-9A-Z]{12,}/g, "AKIA***"],
  /* Authorization headers. */
  [/\b(Bearer|Basic)(\s+)[^\s"',}]+/gi, "$1$2***"],
  [/\b(Project-Access-Token|x-api-key|api-key|apikey)("?\s*[:=]\s*"?)[^\s"',}]+/gi, "$1$2***"],
  /* JWTs. */
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "***.jwt"],
  /* Discord webhook URLs. */
  [/(discord(?:app)?\.com\/api\/webhooks\/\d+\/)[A-Za-z0-9_-]+/gi, "$1***"],
  /* SECRET_NAME=value, "secret_name": "value", secret-name: value. */
  [new RegExp(`\\b(${SECRET_NAME})("?\\s*[=:]\\s*"?)([^\\s"',;&}]+)`, "gi"), "$1$2***"],
  /* Query strings: ?token=, &password=, &key=. */
  [/([?&](?:token|access_token|api_key|apikey|key|secret|password|sig|signature)=)[^&\s"']+/gi, "$1***"],
  /* Anything long and token-like (40+ characters without a slash or a dot). */
  [/[A-Za-z0-9+=_-]{40,}/g, "***"],
]

/**
 * Masks secrets in a text that leaves the server. Returns the text and how
 * many replacements were made (the panel says "3 secrets masked").
 */
export function maskSecretsCounted(text: unknown, secrets: readonly (string | null | undefined)[] = []): { text: string; masked: number } {
  let out = String(text ?? "")
  let masked = 0
  for (const s of secrets) {
    const secret = String(s ?? "").trim()
    if (secret.length < MIN_SECRET_LENGTH) continue
    const parts = out.split(secret)
    if (parts.length > 1) {
      masked += parts.length - 1
      out = parts.join("***")
    }
  }
  for (const [re, replacement] of RULES) {
    out = out.replace(re, (...args: unknown[]) => {
      const match = String(args[0])
      const replaced = match.replace(new RegExp(re.source, re.flags.replace("g", "")), replacement)
      if (replaced !== match) masked += 1
      return replaced
    })
  }
  return { text: out, masked }
}

export function maskSecrets(text: unknown, secrets: readonly (string | null | undefined)[] = []): string {
  return maskSecretsCounted(text, secrets).text
}

/**
 * An id fit for a GraphQL variable and a URL path: Railway ids are UUIDs;
 * anything else of letters, digits and dashes up to 64 characters is
 * accepted too, nothing with a quote, a brace or a slash.
 */
export function safeId(id: unknown): string | null {
  if (typeof id !== "string") return null
  const v = id.trim()
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(v) ? v : null
}
