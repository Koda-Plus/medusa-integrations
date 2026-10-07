/**
 * THE HEALTH CHECKS: read what the checks need, then judge (lib/checks.ts).
 *
 * Stripe: the account (country, currency, capabilities), the payment method
 * configurations, the webhook endpoints, the events whose delivery failed in
 * the last 24 hours, the payment method domains. A check that is turned off
 * in the options skips its read. Medusa: the payment providers, the regions
 * and the mode of the recent Stripe payment sessions. The payments come from
 * the snapshot the panel already holds, so the checks cost five reads at
 * most, kept for `cacheSeconds` like the rest.
 */
import { DELIVERY_WINDOW_HOURS, ERROR_CACHE_MS, FORCE_REFRESH_MIN_MS } from "../../modules/stripe/lib/constants"
import type { CheckKey, StripeChecksResponse } from "../../modules/stripe/lib/contract"
import { runChecks, summarize, type ChecksInput, type ProviderFacts, type Read, type RegionFacts } from "../../modules/stripe/lib/checks"
import { isFailure, toFailure, type ReadFailure } from "../../modules/stripe/lib/errors"
import { balanceCurrencies } from "../../modules/stripe/lib/normalize"
import type { RawAccount, RawEvent, RawPaymentMethodConfiguration, RawPaymentMethodDomain, RawWebhookEndpoint } from "../../modules/stripe/lib/stripe-types"
import { expectedWebhookUrl, parseUrl } from "../../modules/stripe/lib/webhooks"
import { loadSnapshot, dashboardFor } from "./snapshot"
import { cacheFor, clientFor, readProviders, readRegions, readSessionModes, storefrontDomains, stripeService, type Scope } from "./runtime"

const HOUR = 60 * 60 * 1000

async function settle<T>(enabled: boolean, read: () => Promise<T>, secrets: string[]): Promise<Read<T>> {
  if (!enabled) return null
  try {
    return await read()
  } catch (err) {
    return toFailure(err, secrets)
  }
}

function backendOf(o: { backendUrl: string | null }, origin: string | null): { hosts: string[]; base: string | null } {
  const base = o.backendUrl ?? origin
  const parsed = parseUrl(base)
  return { hosts: parsed ? [parsed.host] : [], base }
}

export async function computeChecks(scope: Scope, args: { force?: boolean; origin: string | null; now: Date }): Promise<StripeChecksResponse> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const on = (k: CheckKey) => o.checks[k] !== false
  const { snapshot } = await loadSnapshot(scope, { force: args.force, origin: args.origin, now: () => args.now })
  const backend = backendOf(o, args.origin)
  const webhookUrl = expectedWebhookUrl(backend.base, o.providerId)
  const store = storefrontDomains(scope, o.storefrontDomains)
  const secrets = [o.apiKey]
  const ordersById = new Map(snapshot.payments.map((p) => [p.id, p.order]))

  let input: ChecksInput
  if (snapshot.demo) {
    const d = snapshot.demo
    input = {
      now: args.now,
      demo: true,
      enabled: o.checks,
      providerId: o.providerId,
      key: { kind: "restricted", mode: "live", last4: null },
      keyFailure: null,
      account: d.account,
      methodConfigs: d.methodConfigs,
      endpoints: d.endpoints,
      failedEvents: d.failedEvents,
      domains: d.domains,
      storefront: store.domains.length > 0 ? store : { domains: d.domains.map((x) => String(x.domain_name)), source: "option" },
      backendHosts: backend.hosts,
      expectedWebhookUrl: webhookUrl,
      providers: d.providers,
      regions: d.regions,
      payments: snapshot.facts,
      ordersFailure: null,
      orderOf: (id) => ordersById.get(id) ?? null,
      balanceCurrencies: balanceCurrencies(snapshot.balance),
      sessionModes: { live: snapshot.facts.filter((f) => f.sessionId).length, test: 0 },
      dashboard: dashboardFor("demo"),
    }
  } else {
    const client = clientFor(scope, svc)
    const since = Math.floor((args.now.getTime() - DELIVERY_WINDOW_HOURS * HOUR) / 1000)
    const needAccount = on("account") || on("capabilities")
    const [account, methodConfigs, endpoints, failedEvents, domains, providers, regions, sessionModes] = await Promise.all([
      settle<RawAccount>(needAccount, () => client.get<RawAccount>("/account"), secrets),
      settle<RawPaymentMethodConfiguration[]>(on("capabilities"), async () => (await client.list<RawPaymentMethodConfiguration>("/payment_method_configurations", {}, { maxPages: 1, limit: 20 })).data, secrets),
      settle<RawWebhookEndpoint[]>(on("webhook"), async () => (await client.list<RawWebhookEndpoint>("/webhook_endpoints", {}, { maxPages: 1 })).data, secrets),
      settle<RawEvent[]>(on("deliveries"), async () => (await client.list<RawEvent>("/events", { delivery_success: false, created: { gte: since }, type: "payment_intent.*" }, { maxPages: 2 })).data, secrets),
      settle<RawPaymentMethodDomain[]>(on("domains"), async () => (await client.list<RawPaymentMethodDomain>("/payment_method_domains", {}, { maxPages: 1 })).data, secrets),
      settle<ProviderFacts[]>(on("provider"), () => readProviders(scope), secrets),
      settle<RegionFacts[]>(on("regions") || on("capture"), () => readRegions(scope), secrets),
      settle<{ live: number; test: number }>(on("key"), () => readSessionModes(scope, o.providerId), secrets),
    ])
    const refused = [account, methodConfigs, endpoints, failedEvents, domains].find((r): r is ReadFailure => isFailure(r) && r.kind === "auth") ?? null
    input = {
      now: args.now,
      demo: false,
      enabled: o.checks,
      providerId: o.providerId,
      key: svc.keyInfo(),
      keyFailure: snapshot.keyFailure ?? refused,
      account,
      methodConfigs,
      endpoints,
      failedEvents,
      domains,
      storefront: store,
      backendHosts: backend.hosts,
      expectedWebhookUrl: webhookUrl,
      providers,
      regions,
      payments: snapshot.paymentsFailure ?? snapshot.facts,
      ordersFailure: snapshot.ordersFailure,
      orderOf: (id) => ordersById.get(id) ?? null,
      balanceCurrencies: snapshot.balance ? balanceCurrencies(snapshot.balance) : null,
      sessionModes: sessionModes && !isFailure(sessionModes) ? sessionModes : null,
      dashboard: dashboardFor(snapshot.mode),
    }
  }

  const results = runChecks(input)
  return {
    mode: snapshot.mode,
    checkedAt: args.now.toISOString(),
    fresh: true,
    webhookUrl,
    results,
    summary: summarize(results),
  }
}

/** The checks of the current mode and address, from the cache while fresh. */
export async function loadChecks(scope: Scope, args: { force?: boolean; origin: string | null; now?: () => Date }): Promise<StripeChecksResponse> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const now = args.now ?? (() => new Date())
  const key = `checks:${svc.isDemo() ? "demo" : (svc.keyInfo().mode ?? "none")}:${o.backendUrl ?? args.origin ?? ""}`
  const hit = await cacheFor(svc).get<StripeChecksResponse>(key, () => computeChecks(scope, { force: args.force, origin: args.origin, now: now() }), {
    ttlMs: o.cacheSeconds * 1000,
    force: args.force,
    forceMinMs: FORCE_REFRESH_MIN_MS,
    errorTtlMs: ERROR_CACHE_MS,
    isFailure: (r) => r.results.some((x) => x.key === "key" && x.verdict === "fail" && x.code === "invalid"),
  })
  return { ...hit.value, fresh: hit.fresh }
}
