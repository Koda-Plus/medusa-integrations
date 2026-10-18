import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { InpostPayApiError } from "../../modules/inpostpay/lib/client"
import { createLimiter } from "../../modules/inpostpay/lib/rate-limit"
import { SIGNATURE_HEADERS } from "../../modules/inpostpay/lib/constants"
import { header, safeKeyVersion, verifyInpostSignature, type SigningKey } from "../../modules/inpostpay/lib/signature"
import { basketRow } from "../../workflows/inpostpay/baskets"
import { InpostPayFlowError, clientOf, loggerOf, optionsOf } from "../../workflows/inpostpay/runtime"

/**
 * What the Merchant Backend API routes share (`/inpostpay/v1/izi/...`, the
 * address the merchant portal is given). Public routes, so every call is
 * checked before anything is read:
 *
 *   demo   403 DEMO_MODE: the demo confirms baskets from the storefront
 *   off    503 NOT_CONFIGURED
 *   else   the InPost signature (headers, the public key of the version,
 *          the exact body, 240 seconds), 401 INVALID_SIGNATURE otherwise
 *
 * Errors use InPost's shape: `{ error_code, error_message }`.
 */

export function fail(res: MedusaResponse, status: number, code: string, message: string): void {
  res.status(status).json({ error_code: code, error_message: message })
}

/** Signing keys by version, for an hour; unknown versions are not fetched more than 10 times a minute. */
const keys = new Map<string, { key: SigningKey; until: number }>()
const keyFetches = createLimiter(10, 60_000)

async function keyFor(req: MedusaRequest, version: string): Promise<SigningKey | null> {
  const cached = keys.get(version)
  if (cached && cached.until > Date.now()) return cached.key
  if (keyFetches.limited("all")) return null
  const client = clientOf(req.scope)
  if (!client) return null
  try {
    const key = await client.signingKey(version)
    keys.set(version, { key, until: Date.now() + 60 * 60 * 1000 })
    if (keys.size > 20) keys.delete(keys.keys().next().value as string)
    return key
  } catch (e) {
    loggerOf(req.scope).warn(`[inpostpay] The signing key ${version} could not be read: ${(e as Error)?.message ?? e}`)
    return null
  }
}

/** The gate of every Merchant API route. Answers and returns false when the call may not go on. */
export async function merchantGate(req: MedusaRequest, res: MedusaResponse): Promise<boolean> {
  const o = optionsOf(req.scope)
  if (o.demo) {
    fail(res, 403, "DEMO_MODE", "Demo mode: the Merchant API is not used; the storefront confirms baskets with a simulation.")
    return false
  }
  if (o.mode === "off") {
    fail(res, 503, "NOT_CONFIGURED", "InPost Pay is not configured in this store.")
    return false
  }
  const headers = req.headers as Record<string, unknown>
  const version = safeKeyVersion(header(headers, SIGNATURE_HEADERS.keyVersion))
  const key = version ? await keyFor(req, version) : null
  const raw = (req as unknown as { rawBody?: Buffer | string }).rawBody
  const verdict = key ? verifyInpostSignature({ body: raw === undefined ? "" : typeof raw === "string" ? raw : new Uint8Array(raw), headers, key }) : ({ ok: false, reason: "bad_key" } as const)
  if (!verdict.ok) {
    loggerOf(req.scope).warn(`[inpostpay] Merchant API call ${req.method} ${req.path} rejected: ${verdict.reason}`)
    fail(res, 401, "INVALID_SIGNATURE", verdict.reason === "stale" ? "The signature timestamp is more than 240 seconds from the server clock." : "The signature could not be verified.")
    return false
  }
  return true
}

/** The basket row of the path, or a 404 in InPost's shape. */
export async function rowOrFail(req: MedusaRequest, res: MedusaResponse): Promise<Record<string, any> | null> {
  const id = String((req.params as Record<string, string>).basket_id ?? "")
  const row = await basketRow(req.scope, id)
  if (!row) fail(res, 404, "BASKET_NOT_FOUND", "No such basket in this store.")
  return row
}

export function bodyOf(req: MedusaRequest): Record<string, any> {
  const b = req.body as unknown
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, any>) : {}
}

/** A flow error as InPost reads it; anything else is a 500 with a neutral sentence. */
export function failWith(req: MedusaRequest, res: MedusaResponse, e: unknown): void {
  if (e instanceof InpostPayFlowError) return fail(res, e.status, e.code, e.message)
  if (e instanceof InpostPayApiError) return fail(res, 502, "INPOST_UNAVAILABLE", e.message)
  loggerOf(req.scope).error(`[inpostpay] ${req.method} ${req.path} failed: ${(e as Error)?.message ?? e}`)
  fail(res, 500, "INTERNAL_ERROR", "The store could not answer now.")
}
