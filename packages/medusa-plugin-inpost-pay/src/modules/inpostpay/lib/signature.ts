import { createHash, createPublicKey, createVerify, timingSafeEqual, type KeyObject } from "node:crypto"
import { SIGNATURE_HEADERS, SIGNATURE_TOLERANCE_SECONDS } from "./constants"

/**
 * THE SIGNATURE OF A CALL FROM INPOST PAY to the Merchant Backend API, as
 * the "Signature verification" page of the merchant documentation describes
 * it (space PL, page 352518156):
 *
 *   headers   x-signature (base64), x-signature-timestamp (ISO 8601, UTC),
 *             x-public-key-ver (the key version), x-public-key-hash
 *             (SHA-256 of the public key)
 *   key       GET /v1/izi/signing-keys/public/{version} on the Basket App
 *             API: `public_key_base64` (DER) and `merchant_external_id`
 *   digest    base64(SHA-256(exact request body)), of an empty body when
 *             there is none
 *   signed    base64("<digest>,<merchant_external_id>,<key version>,<timestamp>")
 *             (a missing version or timestamp is an empty value)
 *   check     SHA256withRSA over the signed string with the public key,
 *             and the timestamp at most 240 seconds from now
 *
 * Unclear in the documentation, handled leniently: whether the key hash is
 * hex or base64 (both are accepted), and the RSA padding (PKCS #1 v1.5, the
 * default of SHA256withRSA and of `openssl dgst -verify`).
 *
 * Pure functions: the routes fetch and cache the key, these only compute.
 */

export interface SigningKey {
  public_key_base64: string
  merchant_external_id: string
}

export type SignatureReason = "missing_signature" | "stale" | "key_hash" | "bad_key" | "mismatch"

export type SignatureVerdict = { ok: true } | { ok: false; reason: SignatureReason }

export function header(headers: Record<string, unknown>, name: string): string {
  const v = headers[name]
  const first = Array.isArray(v) ? v[0] : v
  return typeof first === "string" ? first.trim() : ""
}

/** base64(SHA-256(body)); an empty body hashes the empty byte array. */
export function bodyDigest(body: Uint8Array | string | null | undefined): string {
  const bytes = body === null || body === undefined ? new Uint8Array(0) : typeof body === "string" ? Buffer.from(body, "utf8") : body
  return createHash("sha256").update(bytes).digest("base64")
}

/** The string InPost signs: base64 of the four values joined with commas. */
export function signedPayload(input: { digest: string; merchantExternalId: string; keyVersion: string; timestamp: string }): string {
  return Buffer.from([input.digest, input.merchantExternalId, input.keyVersion, input.timestamp].join(","), "utf8").toString("base64")
}

/** Whether the header names this public key: SHA-256 of `public_key_base64`, as hex or as base64. */
export function keyHashMatches(publicKeyBase64: string, headerHash: string): boolean {
  if (!headerHash) return false
  const digest = createHash("sha256").update(publicKeyBase64, "utf8").digest()
  const given = headerHash.trim()
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  return same(given.toLowerCase(), digest.toString("hex")) || same(given, digest.toString("base64")) || same(given, digest.toString("base64url"))
}

/** The RSA public key from base64 DER (SubjectPublicKeyInfo, or PKCS #1 as a fallback); null when it does not parse. */
export function publicKeyOf(publicKeyBase64: string): KeyObject | null {
  const der = Buffer.from(publicKeyBase64.replace(/\s+/g, ""), "base64")
  if (der.length === 0) return null
  for (const type of ["spki", "pkcs1"] as const) {
    try {
      return createPublicKey({ key: der, format: "der", type })
    } catch {
      /* try the next format */
    }
  }
  return null
}

/** Whether the timestamp is a date within the tolerance of `now`. */
export function fresh(timestamp: string, now: number, toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS): boolean {
  const at = Date.parse(timestamp)
  if (!timestamp || !Number.isFinite(at)) return false
  return Math.abs(now - at) <= toleranceSeconds * 1000
}

/**
 * The whole check of one request. `key` is the public key of the version the
 * request names (the caller fetched it); `body` the exact bytes received.
 */
export function verifyInpostSignature(input: {
  body: Uint8Array | string | null | undefined
  headers: Record<string, unknown>
  key: SigningKey
  now?: number
  toleranceSeconds?: number
}): SignatureVerdict {
  const signature = header(input.headers, SIGNATURE_HEADERS.signature)
  const timestamp = header(input.headers, SIGNATURE_HEADERS.timestamp)
  const keyVersion = header(input.headers, SIGNATURE_HEADERS.keyVersion)
  const keyHash = header(input.headers, SIGNATURE_HEADERS.keyHash)
  if (!signature) return { ok: false, reason: "missing_signature" }
  if (!fresh(timestamp, input.now ?? Date.now(), input.toleranceSeconds)) return { ok: false, reason: "stale" }
  if (!keyHashMatches(input.key.public_key_base64, keyHash)) return { ok: false, reason: "key_hash" }
  const key = publicKeyOf(input.key.public_key_base64)
  if (!key) return { ok: false, reason: "bad_key" }
  const payload = signedPayload({ digest: bodyDigest(input.body), merchantExternalId: input.key.merchant_external_id, keyVersion, timestamp })
  try {
    const ok = createVerify("RSA-SHA256").update(payload, "utf8").verify(key, Buffer.from(signature, "base64"))
    return ok ? { ok: true } : { ok: false, reason: "mismatch" }
  } catch {
    return { ok: false, reason: "mismatch" }
  }
}

/** A key version as InPost sends it: short and plain, so a forged header cannot steer the key lookup. */
export function safeKeyVersion(value: string): string | null {
  return /^[A-Za-z0-9._-]{1,40}$/.test(value) ? value : null
}
