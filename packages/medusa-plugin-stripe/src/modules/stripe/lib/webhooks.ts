/**
 * THE WEBHOOK ENDPOINT CHECK. No runtime imports beyond the pure helpers.
 *
 * The official provider listens at `/hooks/payment/<identifier>_<id>`:
 * `/hooks/payment/stripe_stripe` for the default entry. Every Stripe
 * provider of one entry shares the same `webhookSecret` and Medusa finds the
 * payment session by `metadata.session_id`, so ONE endpoint at
 * `stripe_<id>` serves cards, BLIK and Przelewy24 alike. The BLIK and
 * Przelewy24 paths (`stripe-blik_<id>`, `stripe-przelewy24_<id>`) work too
 * and are accepted.
 *
 * What the check wants:
 *   - an endpoint whose host is this backend (the `backendUrl` option, or the
 *     address this admin was opened on) and whose path is one of the above;
 *   - enabled;
 *   - listening to `payment_intent.succeeded` (a paid checkout becomes an
 *     order even when the customer closes the tab) and, while cards are not
 *     captured at once, `payment_intent.amount_capturable_updated`;
 *   - one such endpoint, not several: the provider has one secret, so a
 *     second endpoint's deliveries fail their signature check in Medusa.
 * Medusa's docs list `payment_intent.payment_failed` and
 * `payment_intent.partially_funded` as well; this Medusa ignores both, so
 * they are mentioned, never failed.
 */
import { EVENT_CAPTURABLE, EVENT_SUCCEEDED, EVENTS_DOCUMENTED } from "./constants"
import type { CheckItemDto, CheckResultDto } from "./contract"
import type { DashboardLinks } from "./dashboard"
import { isFailure, type ReadFailure } from "./errors"
import type { RawWebhookEndpoint } from "./stripe-types"

export interface ParsedUrl {
  origin: string
  host: string
  path: string
}

/** Lower-case host, default ports dropped, no trailing slash, query and hash ignored. */
export function parseUrl(url: unknown): ParsedUrl | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    const defaultPort = (u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")
    const host = `${u.hostname.toLowerCase()}${u.port && !defaultPort ? `:${u.port}` : ""}`
    return { origin: `${u.protocol}//${host}`, host, path: u.pathname.replace(/\/+$/, "") }
  } catch {
    return null
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function webhookPath(providerId: string): string {
  return `/hooks/payment/stripe_${providerId}`
}

/** The URL Stripe should call on this backend: base (with its path prefix, if any) plus the hook path. */
export function expectedWebhookUrl(base: string | null | undefined, providerId: string): string | null {
  const parsed = parseUrl(base)
  return parsed ? `${parsed.origin}${parsed.path}${webhookPath(providerId)}` : null
}

export type PathMatch = "exact" | "variant" | null

/** Whether an endpoint path is the provider's hook: `stripe_<id>` (exact) or another Stripe identifier of the same entry (variant). */
export function pathMatch(path: string, providerId: string): PathMatch {
  if (path.endsWith(webhookPath(providerId))) return "exact"
  return new RegExp(`/hooks/payment/stripe-[a-z0-9]+_${escapeRegex(providerId)}$`).test(path) ? "variant" : null
}

export interface EndpointMatch {
  endpoint: RawWebhookEndpoint
  url: string
  host: string
  path: PathMatch
  /** The host is this backend's. Null when no backend address is known. */
  hostMatch: boolean | null
  enabled: boolean
  events: string[]
}

export function matchEndpoints(endpoints: readonly RawWebhookEndpoint[], args: { backendHosts: readonly string[]; providerId: string }): EndpointMatch[] {
  const hosts = args.backendHosts.map((h) => h.toLowerCase())
  const out: EndpointMatch[] = []
  for (const endpoint of endpoints) {
    const parsed = parseUrl(endpoint.url)
    if (!parsed) continue
    const path = pathMatch(parsed.path, args.providerId)
    if (!path) continue
    out.push({
      endpoint,
      url: String(endpoint.url),
      host: parsed.host,
      path,
      hostMatch: hosts.length > 0 ? hosts.includes(parsed.host) : null,
      enabled: endpoint.status === "enabled",
      events: Array.isArray(endpoint.enabled_events) ? endpoint.enabled_events.filter((e): e is string => typeof e === "string") : [],
    })
  }
  return out
}

export function listensTo(events: readonly string[], event: string): boolean {
  return events.includes("*") || events.includes(event)
}

/** How the store's card payments are captured, from its recent PaymentIntents. */
export type CaptureMode = "automatic" | "manual" | "mixed" | "unknown"

export interface WebhookCheckInput {
  endpoints: RawWebhookEndpoint[] | ReadFailure | null
  backendHosts: string[]
  expectedUrl: string | null
  providerId: string
  captureMode: CaptureMode
  dashboard: DashboardLinks
  demo: boolean
}

const base = (demo: boolean): Omit<CheckResultDto, "verdict" | "code"> => ({
  key: "webhook",
  params: {},
  hint: null,
  link: null,
  items: [],
  error: null,
  permission: null,
  demo,
})

export function requiredEvents(captureMode: CaptureMode): string[] {
  return captureMode === "automatic" ? [EVENT_SUCCEEDED] : [EVENT_SUCCEEDED, EVENT_CAPTURABLE]
}

export function checkWebhook(input: WebhookCheckInput): CheckResultDto {
  const r = base(input.demo)
  const expected = input.expectedUrl ?? webhookPath(input.providerId)
  const link = { kind: "stripe" as const, url: input.dashboard.webhooks() }
  if (input.endpoints === null) return { ...r, verdict: "unknown", code: "notRead" }
  if (isFailure(input.endpoints)) {
    return { ...r, verdict: "unknown", code: "notRead", error: input.endpoints.error, permission: input.endpoints.permission, hint: input.endpoints.permission ? "permission" : null, params: { permission: input.endpoints.permission ?? "" } }
  }
  const required = requiredEvents(input.captureMode)
  const matches = matchEndpoints(input.endpoints, { backendHosts: input.backendHosts, providerId: input.providerId })
  const mine = matches.filter((m) => m.hostMatch !== false)
  const items = (list: EndpointMatch[]): CheckItemDto[] =>
    list.map((m) => {
      const note: CheckItemDto["note"] = m.events.includes("*") ? { key: "allEvents", params: {} } : { key: "events", params: { count: m.events.length } }
      return { label: m.url, state: m.enabled ? "enabled" : "disabled", note, tone: m.enabled ? "green" : "red", url: input.dashboard.webhooks(m.endpoint.id) }
    })

  if (mine.length === 0) {
    const elsewhere = matches.filter((m) => m.hostMatch === false)
    if (elsewhere.length > 0) {
      return { ...r, verdict: "warn", code: "otherHost", params: { url: elsewhere[0].url, expected }, hint: "otherHost", link, items: items(elsewhere) }
    }
    return { ...r, verdict: "fail", code: "missing", params: { expected, events: required.join(", ") }, hint: "add", link }
  }

  const enabled = mine.filter((m) => m.enabled)
  if (enabled.length === 0) {
    return { ...r, verdict: "fail", code: "disabled", params: { url: mine[0].url }, hint: "enable", link, items: items(mine) }
  }
  const best = enabled.find((m) => m.path === "exact") ?? enabled[0]
  const missing = required.filter((e) => !listensTo(best.events, e))
  if (missing.length > 0) {
    return { ...r, verdict: "fail", code: "missingEvents", params: { url: best.url, events: missing.join(", ") }, hint: "addEvents", link, items: items(mine) }
  }
  const documented = [...EVENTS_DOCUMENTED, ...(required.includes(EVENT_CAPTURABLE) ? [] : [EVENT_CAPTURABLE])].filter((e) => !listensTo(best.events, e))
  const extra: CheckItemDto[] = documented.map((e) => ({ label: e, state: "optional", tone: "grey" }))
  if (enabled.length > 1) {
    return { ...r, verdict: "warn", code: "duplicates", params: { count: enabled.length, url: best.url }, hint: "keepOne", link, items: [...items(enabled), ...extra] }
  }
  return {
    ...r,
    verdict: "pass",
    code: input.backendHosts.length > 0 ? "ok" : "okPathOnly",
    params: { url: best.url, events: best.events.includes("*") ? "*" : best.events.length },
    link,
    items: [...items([best]), ...extra],
  }
}
