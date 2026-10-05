/**
 * REQUEST SIGNATURES, both directions (contract: "Signing").
 *
 *   X-Koda-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256>
 *
 * The HMAC covers `<t>.<METHOD>.<path and query>.<raw body>`. Signing the
 * method and the path, not only the body, matters for GET requests: their
 * body is empty, so a body-only signature would let a captured request be
 * replayed against any other endpoint for five minutes.
 *
 * The body is hashed as BYTES. Medusa hands the webhook route a Buffer
 * (`preserveRawBody`), and re-encoding it through a string would change any
 * byte sequence that is not valid UTF-8 and break the comparison.
 *
 * Key rotation: `verifySignature` accepts several secrets, so the bridge and
 * Medusa can switch to a new secret one after the other without downtime.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

export type Body = string | Uint8Array

export interface SignInput {
  secret: string
  timestamp: number
  method: string
  pathAndQuery: string
  body: Body
}

/** Hex HMAC of one request. */
export function computeSignature(input: SignInput): string {
  const hmac = createHmac("sha256", input.secret)
  hmac.update(`${input.timestamp}.${input.method.toUpperCase()}.${input.pathAndQuery}.`, "utf8")
  if (typeof input.body === "string") hmac.update(input.body, "utf8")
  else hmac.update(input.body)
  return hmac.digest("hex")
}

/** The header value for one request. */
export function signatureHeader(input: SignInput): string {
  return `t=${input.timestamp},v1=${computeSignature(input)}`
}

export interface ParsedSignature {
  timestamp: number
  signatures: string[]
}

/** `t=...,v1=...[,v1=...]`, order free, unknown schemes ignored. Null when unusable. */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header || typeof header !== "string") return null
  let timestamp: number | null = null
  const signatures: string[] = []
  for (const part of header.split(",")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null
      timestamp = Number(value)
    } else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(value.toLowerCase())
    }
  }
  if (timestamp === null || signatures.length === 0) return null
  return { timestamp, signatures }
}

export type VerifyFailure = "missing" | "malformed" | "stale" | "mismatch" | "no_secret"
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyFailure }

export interface VerifyInput {
  header: string | null | undefined
  secrets: ReadonlyArray<string | null | undefined>
  method: string
  pathAndQuery: string
  body: Body
  nowSeconds?: number
  toleranceSeconds?: number
}

/** Constant-time check of a signature against every configured secret. */
export function verifySignature(input: VerifyInput): VerifyResult {
  const secrets = input.secrets.filter((s): s is string => typeof s === "string" && s.length > 0)
  if (secrets.length === 0) return { ok: false, reason: "no_secret" }
  if (!input.header) return { ok: false, reason: "missing" }
  const parsed = parseSignatureHeader(input.header)
  if (!parsed) return { ok: false, reason: "malformed" }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSeconds ?? 300
  if (Math.abs(now - parsed.timestamp) > tolerance) return { ok: false, reason: "stale" }

  for (const secret of secrets) {
    const expected = Buffer.from(
      computeSignature({
        secret,
        timestamp: parsed.timestamp,
        method: input.method,
        pathAndQuery: input.pathAndQuery,
        body: input.body,
      }),
      "hex",
    )
    for (const candidate of parsed.signatures) {
      const given = Buffer.from(candidate, "hex")
      if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true }
    }
  }
  return { ok: false, reason: "mismatch" }
}
