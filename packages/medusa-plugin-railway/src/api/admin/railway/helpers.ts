import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { RailwayMode, StatusResponse } from "../../../modules/railway/lib/contract"
import { RailwayApiError } from "../../../modules/railway/lib/errors"
import { knownIdentity, knownTokenKind, linksFor } from "../../../workflows/railway/reads"
import { clientFor, railwayService, type Scope } from "../../../workflows/railway/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { railwayService }

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function boolParam(value: unknown): boolean {
  const v = strParam(value).toLowerCase()
  return v === "1" || v === "true" || v === "yes"
}

/** `?fresh=1` asks for a new read (honoured once the last read is 15 seconds old). */
export function wantsFresh(req: MedusaRequest): boolean {
  return boolParam((req.query as Record<string, unknown> | undefined)?.fresh)
}

export function query(req: MedusaRequest): Record<string, unknown> {
  return (req.query as Record<string, unknown> | undefined) ?? {}
}

export function modeOf(scope: Scope): RailwayMode {
  const svc = railwayService(scope)
  if (svc.isDemo()) return "demo"
  return svc.isConfigured() ? "live" : "unconfigured"
}

/** What the admin may know about the setup. Never the token. No call to Railway. */
export function buildStatus(scope: Scope): StatusResponse {
  const svc = railwayService(scope)
  const o = svc.getOptions()
  const configured = svc.isConfigured()
  const client = configured ? clientFor(scope, svc) : null
  const id = knownIdentity(scope)
  return {
    mode: modeOf(scope),
    configured,
    missing: svc.missingOptions(),
    tokenKind: o.demo ? "project" : knownTokenKind(scope),
    tokenEnv: o.tokenEnv,
    options: {
      projectId: o.projectId ?? id?.projectId ?? null,
      environmentId: o.environmentId ?? id?.environmentId ?? null,
      tokenKind: o.tokenKind,
      dashboardUrl: o.dashboardUrl,
      cacheSeconds: o.cacheSeconds,
      requestsPerSecond: o.requestsPerSecond,
      requestsPerHour: o.requestsPerHour,
      timeoutMs: o.timeoutMs,
    },
    rateLimit: client?.rateLimit ?? null,
    usedThisHour: client?.budget?.used ?? 0,
    dashboardUrl: linksFor(scope, id).project(),
  }
}

const STATUS_OF_KIND: Record<string, number> = { not_found: 404, auth: 502, rate_limited: 429, forbidden: 500 }

/**
 * Runs a read for a route. A Railway error is a 502 (404 for an unknown id,
 * 429 when the budget is spent) with the masked message; anything else is a
 * 500 with a plain sentence, the details only in the server log, masked.
 */
export async function respond<T>(req: MedusaRequest, res: MedusaResponse, work: () => Promise<T>): Promise<void> {
  try {
    res.json(await work())
  } catch (err) {
    const svc = railwayService(req.scope)
    const message = svc.mask(err instanceof Error ? err.message : String(err))
    if (err instanceof RailwayApiError) {
      if (err.kind !== "not_found") svc.getLogger().warn(`[railway] ${req.method} ${req.path}: ${message}`)
      res.status(STATUS_OF_KIND[err.kind] ?? 502).json({ type: "railway_read_failed", kind: err.kind, message })
      return
    }
    svc.getLogger().error(`[railway] ${req.method} ${req.path} failed: ${message}`)
    res.status(500).json({ type: "unexpected_state", message: "Railway by Koda Plus could not answer. The details are in the server log." })
  }
}

/** A read route needs a token (or demo mode): 409 with the setup otherwise. */
export function needsSetup(req: MedusaRequest, res: MedusaResponse): boolean {
  const svc = railwayService(req.scope)
  if (svc.isConfigured()) return false
  res.status(409).json({ type: "not_configured", message: `Railway by Koda Plus has no token: set ${svc.getOptions().tokenEnv}.`, missing: svc.missingOptions() })
  return true
}
