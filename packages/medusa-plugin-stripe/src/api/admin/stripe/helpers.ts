import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { providerIds } from "../../../modules/stripe/lib/checks"
import { STRIPE_API_VERSION } from "../../../modules/stripe/lib/constants"
import type { StripeMode, StripeStatusResponse } from "../../../modules/stripe/lib/contract"
import { DashboardLinks } from "../../../modules/stripe/lib/dashboard"
import { expectedWebhookUrl, webhookPath } from "../../../modules/stripe/lib/webhooks"
import { requestOrigin, storefrontDomains, stripeService, type Scope } from "../../../workflows/stripe/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { stripeService }

/** The public address this admin was opened on, for the webhook check. */
export function originOf(req: MedusaRequest): string | null {
  return requestOrigin(req as unknown as { headers?: Record<string, string | string[] | undefined>; protocol?: string })
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/** `?fresh=1` asks for a new read (honoured once the last read is 30 seconds old). */
export function wantsFresh(req: MedusaRequest): boolean {
  const v = strParam((req.query as Record<string, unknown> | undefined)?.fresh).toLowerCase()
  return v === "1" || v === "true"
}

export function modeOf(scope: Scope): StripeMode {
  const svc = stripeService(scope)
  if (svc.isDemo()) return "demo"
  if (!svc.isConfigured()) return "unconfigured"
  return svc.keyInfo().mode === "test" ? "test" : "live"
}

/** What the admin knows about the setup. Never the key: its kind, mode and last four characters. No call to Stripe. */
export function buildStatus(scope: Scope, origin: string | null): StripeStatusResponse {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const store = storefrontDomains(scope, o.storefrontDomains)
  const mode = modeOf(scope)
  return {
    mode,
    configured: svc.isConfigured(),
    missing: svc.missingOptions(),
    demoReason: o.demo ? "option" : null,
    key: svc.keyInfo(),
    options: {
      providerId: o.providerId,
      providerIds: providerIds(o.providerId),
      backendUrl: o.backendUrl,
      storefrontDomains: store.domains,
      storefrontSource: store.source,
      cacheSeconds: o.cacheSeconds,
      maxPages: o.maxPages,
      requestsPerSecond: o.requestsPerSecond,
      timeoutMs: o.timeoutMs,
      checks: o.checks,
    },
    apiVersion: STRIPE_API_VERSION,
    webhookPath: webhookPath(o.providerId),
    webhookUrl: expectedWebhookUrl(o.backendUrl ?? origin, o.providerId),
    dashboardUrl: new DashboardLinks(mode === "test" ? "test" : "live").base,
    references: o.references,
  }
}

/**
 * Runs a read for a route. Medusa answers errors on its own; this only
 * makes sure a message that leaves the server is masked first.
 */
export async function respond<T>(req: MedusaRequest, res: MedusaResponse, work: () => Promise<T>): Promise<void> {
  try {
    res.json(await work())
  } catch (err) {
    const svc = stripeService(req.scope)
    const message = svc.mask(err instanceof Error ? err.message : String(err))
    svc.getLogger().warn(`[stripe] ${req.method} ${req.path}: ${message}`)
    res.status(502).json({ type: "stripe_read_failed", message })
  }
}
