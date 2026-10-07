/**
 * HEALTH CHECKS: ONE VERDICT PER ITEM, WITH A FIX. No runtime imports beyond the pure helpers.
 *
 * Every check is a pure function of facts read earlier (from Stripe, from
 * Medusa, or from the demo generator), so the same code judges a live store,
 * the demo and the test fixtures. A check never reads anything itself.
 *
 *   provider      a Stripe provider is registered in this Medusa (pp_stripe_<id>)
 *   key           the plugin's key: restricted or secret, live or test, matching the store's payments
 *   account       country, default currency, charges and payouts enabled, requirements due
 *   capabilities  card_payments, blik_payments, p24_payments active, and shown at checkout
 *   webhook       an endpoint at this backend's /hooks/payment/stripe_<id> (webhooks.ts)
 *   deliveries    webhook deliveries that failed in the last 24 hours
 *   domains       payment method domains for Apple Pay and Google Pay
 *   regions       PLN regions offer BLIK and Przelewy24
 *   capture       automatic capture where the Payment Element should offer BLIK and Przelewy24
 *   orphans       payments that succeeded in Stripe while their cart never became an order
 *
 * Verdicts: pass, warn (works, but something is off), fail (costs payments
 * or orders now), info (worth knowing), off (turned off in the options),
 * unknown (could not be read: the error and the missing permission are kept).
 */
import { CHECK_KEYS, DELIVERY_GRACE_MINUTES, DELIVERY_WINDOW_HOURS, EVENT_SUCCEEDED, ORPHAN_GRACE_MINUTES, ORPHAN_WINDOW_DAYS, PROVIDER_IDENTIFIERS } from "./constants"
import type { CheckItemDto, CheckKey, CheckResultDto, HealthSummaryDto, KeyInfoDto, MethodKey, OrderLinkDto, Verdict } from "./contract"
import type { DashboardLinks } from "./dashboard"
import { isFailure, type ReadFailure } from "./errors"
import type { PaymentFacts } from "./normalize"
import type { RawAccount, RawEvent, RawPaymentMethodConfiguration, RawPaymentMethodDomain, RawWebhookEndpoint } from "./stripe-types"
import { checkWebhook, type CaptureMode } from "./webhooks"

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export type Read<T> = T | ReadFailure | null

export interface RegionFacts {
  id: string
  name: string | null
  currency: string
  /** Enabled payment provider ids of the region. */
  providers: string[]
}

export interface ProviderFacts {
  id: string
  isEnabled: boolean
}

export interface ChecksInput {
  now: Date
  demo: boolean
  enabled: Record<CheckKey, boolean>
  providerId: string
  key: KeyInfoDto
  /** The failure of the first Stripe read, when the key itself was refused (401). */
  keyFailure: ReadFailure | null
  account: Read<RawAccount>
  methodConfigs: Read<RawPaymentMethodConfiguration[]>
  endpoints: Read<RawWebhookEndpoint[]>
  failedEvents: Read<RawEvent[]>
  domains: Read<RawPaymentMethodDomain[]>
  storefront: { domains: string[]; source: "option" | "store_cors" | "none" }
  backendHosts: string[]
  expectedWebhookUrl: string | null
  providers: Read<ProviderFacts[]>
  regions: Read<RegionFacts[]>
  payments: Read<PaymentFacts[]>
  /** Medusa could not match payments to orders: orphans cannot be judged. */
  ordersFailure: ReadFailure | null
  orderOf: (paymentId: string) => OrderLinkDto | null
  balanceCurrencies: string[] | null
  /** Recent Medusa payment sessions of the Stripe providers, by the mode of their PaymentIntent. */
  sessionModes: { live: number; test: number } | null
  dashboard: DashboardLinks
}

type Draft = Omit<CheckResultDto, "key" | "demo">

const draft = (verdict: Verdict, code: string, extra: Partial<Draft> = {}): Draft => ({
  verdict,
  code,
  params: {},
  hint: null,
  link: null,
  items: [],
  error: null,
  permission: null,
  ...extra,
})

function unknown(f: ReadFailure | null): Draft {
  if (!f) return draft("unknown", "notRead")
  return draft("unknown", "notRead", { error: f.error, permission: f.permission, hint: f.permission ? "permission" : f.kind === "auth" ? "auth" : null, params: { permission: f.permission ?? "" } })
}

/** The provider ids of one official provider entry: pp_stripe_<id>, pp_stripe-blik_<id>, pp_stripe-przelewy24_<id>. */
export function providerIds(providerId: string): { card: string; blik: string; p24: string } {
  return {
    card: `pp_${PROVIDER_IDENTIFIERS.card}_${providerId}`,
    blik: `pp_${PROVIDER_IDENTIFIERS.blik}_${providerId}`,
    p24: `pp_${PROVIDER_IDENTIFIERS.p24}_${providerId}`,
  }
}

/* ------------------------------------------------------------------ */

export function checkProvider(input: Pick<ChecksInput, "providers" | "providerId">): Draft {
  if (input.providers === null || isFailure(input.providers)) return unknown(isFailure(input.providers) ? input.providers : null)
  const ids = providerIds(input.providerId)
  const stripe = input.providers.filter((p) => /^pp_stripe(-[a-z0-9]+)?_/.test(p.id))
  const card = input.providers.find((p) => p.id === ids.card)
  if (card) {
    const items: CheckItemDto[] = [ids.card, ids.blik, ids.p24].map((id) => {
      const p = input.providers && !isFailure(input.providers) ? input.providers.find((x) => x.id === id) : undefined
      return { label: id, state: p ? (p.isEnabled ? "registered" : "disabled") : "missing", tone: p?.isEnabled ? "green" : "orange" }
    })
    if (!card.isEnabled) return draft("warn", "disabled", { params: { id: ids.card }, hint: "enableProvider", items })
    return draft("pass", "registered", { params: { id: ids.card }, items })
  }
  if (stripe.length > 0) {
    const other = /^pp_stripe_(.+)$/.exec(stripe.find((p) => p.id.startsWith("pp_stripe_"))?.id ?? "")?.[1] ?? ""
    return draft("warn", "otherId", {
      params: { found: stripe.map((p) => p.id).join(", "), expected: ids.card, suggestion: other },
      hint: other ? "setProviderId" : "addProvider",
      items: stripe.map((p) => ({ label: p.id, state: p.isEnabled ? "registered" : "disabled", tone: "grey" })),
    })
  }
  return draft("fail", "missing", { params: { expected: ids.card }, hint: "addProvider", link: { kind: "docs", url: "https://docs.medusajs.com/resources/commerce-modules/payment/payment-provider/stripe" } })
}

export function checkKey(input: Pick<ChecksInput, "key" | "keyFailure" | "sessionModes" | "dashboard">): Draft {
  const link = { kind: "stripe" as const, url: input.dashboard.apiKeys() }
  const { key } = input
  if (!key.kind) return draft("fail", "missing", { hint: "setKey", link })
  if (key.kind === "publishable") return draft("fail", "publishable", { hint: "useRestricted", link })
  if (input.keyFailure && input.keyFailure.kind === "auth") return draft("fail", "invalid", { hint: "checkKey", link, error: input.keyFailure.error, params: { last4: key.last4 ?? "" } })
  const params = { mode: key.mode ?? "", last4: key.last4 ?? "" }
  const s = input.sessionModes
  if (s && key.mode === "test" && s.live > 0 && s.test === 0) return draft("fail", "modeMismatch", { hint: "matchMode", link, params: { ...params, key: "test", store: "live" } })
  if (s && key.mode === "live" && s.test > 0 && s.live === 0) return draft("fail", "modeMismatch", { hint: "matchMode", link, params: { ...params, key: "live", store: "test" } })
  if (key.mode === "test") return draft("info", "test", { hint: "goLive", link, params })
  if (key.kind === "secret") return draft("warn", "secret", { hint: "useRestricted", link, params })
  if (key.kind === "unknown") return draft("warn", "unknownFormat", { hint: "checkKey", link, params })
  return draft("pass", key.last4 ? "restricted" : "restrictedPlain", { params })
}

export function checkAccount(input: Pick<ChecksInput, "account" | "balanceCurrencies" | "dashboard">): Draft {
  if (input.account === null || isFailure(input.account)) return unknown(isFailure(input.account) ? input.account : null)
  const a = input.account
  const country = String(a.country ?? "").toUpperCase()
  const currency = String(a.default_currency ?? "").toLowerCase()
  const name = a.settings?.dashboard?.display_name || a.business_profile?.name || ""
  const items: CheckItemDto[] = [
    { term: "country", label: country || "?", tone: country === "PL" ? "green" : "grey" },
    { term: "currency", label: currency.toUpperCase() || "?", tone: currency === "pln" ? "green" : "orange" },
    /* Their own state words: Polish agrees the state with its subject, and charges and payouts are plural. */
    { term: "charges", state: a.charges_enabled ? "enabled_many" : "disabled_many", tone: a.charges_enabled ? "green" : "red" },
    { term: "payouts", state: a.payouts_enabled ? "enabled_many" : "disabled_many", tone: a.payouts_enabled ? "green" : "red" },
  ]
  const params = { country, currency: currency.toUpperCase(), name }
  const account = { kind: "stripe" as const, url: input.dashboard.account() }
  if (a.charges_enabled === false) return draft("fail", "chargesDisabled", { params: { ...params, reason: a.requirements?.disabled_reason ?? "" }, hint: "finishOnboarding", link: account, items })
  if (a.payouts_enabled === false) return draft("warn", "payoutsDisabled", { params, hint: "finishOnboarding", link: account, items })
  const due = (a.requirements?.currently_due ?? []).length + (a.requirements?.past_due ?? []).length
  if (due > 0) {
    const deadline = typeof a.requirements?.current_deadline === "number" ? new Date(a.requirements.current_deadline * 1000).toISOString() : ""
    return draft("warn", "requirementsDue", { params: { ...params, count: due, deadline }, hint: "finishOnboarding", link: account, items })
  }
  const plnSettles = (input.balanceCurrencies ?? []).includes("pln")
  if (currency && currency !== "pln" && !plnSettles) {
    return draft("warn", "currency", { params, hint: "plnAccount", link: { kind: "stripe", url: input.dashboard.payoutSettings() }, items })
  }
  if (country && country !== "PL") return draft("info", "country", { params, items })
  return draft("pass", "ready", { params, items })
}

/** The default payment method configuration of the account (no application, no parent), if any. */
export function defaultMethodConfig(configs: RawPaymentMethodConfiguration[]): RawPaymentMethodConfiguration | null {
  const own = configs.filter((c) => !c.application && !c.parent && c.active !== false)
  return own.find((c) => c.is_default === true) ?? own[0] ?? null
}

function shown(config: RawPaymentMethodConfiguration | null, method: string): "on" | "off" | null {
  const entry = config?.[method] as { available?: boolean | null; display_preference?: { value?: string | null } | null } | undefined
  const value = entry?.display_preference?.value
  return value === "on" || value === "off" ? value : null
}

export function checkCapabilities(input: Pick<ChecksInput, "account" | "methodConfigs" | "dashboard">): Draft {
  if (input.account === null || isFailure(input.account)) return unknown(isFailure(input.account) ? input.account : null)
  const caps = input.account.capabilities ?? {}
  const config = input.methodConfigs && !isFailure(input.methodConfigs) ? defaultMethodConfig(input.methodConfigs) : null
  const link = { kind: "stripe" as const, url: input.dashboard.paymentMethods() }
  const rows: Array<{ method: MethodKey; capability: string | null; shown: "on" | "off" | null }> = [
    { method: "card", capability: (caps.card_payments as string | undefined) ?? null, shown: shown(config, "card") },
    { method: "blik", capability: (caps.blik_payments as string | undefined) ?? null, shown: shown(config, "blik") },
    { method: "p24", capability: (caps.p24_payments as string | undefined) ?? null, shown: shown(config, "p24") },
    { method: "apple_pay", capability: null, shown: shown(config, "apple_pay") },
    { method: "google_pay", capability: null, shown: shown(config, "google_pay") },
  ]
  /* One state per method: the capability and, when the configuration was read, whether checkout shows it. */
  const items: CheckItemDto[] = rows
    .filter((r) => r.capability !== null || r.shown !== null)
    .map((r) => {
      const state = r.capability === "active" && r.shown ? `active_${r.shown}` : (r.capability ?? r.shown ?? "")
      const tone: CheckItemDto["tone"] = state === "active" || state === "active_on" || state === "on" ? "green" : state === "inactive" ? "red" : "orange"
      return { method: r.method, state, tone }
    })
  const card = rows[0]
  if (rows.slice(0, 3).every((r) => r.capability === null) && !config) return draft("info", "notReported", { hint: "checkDashboard", link, items })
  if (card.capability !== null && card.capability !== "active") return draft("fail", "cardInactive", { params: { state: card.capability }, hint: "enableMethods", link, items })
  const local = rows.slice(1, 3)
  const pending = local.filter((r) => r.capability === "pending").map((r) => r.method)
  const inactive = local.filter((r) => r.capability !== null && r.capability !== "active" && r.capability !== "pending").map((r) => r.method)
  if (inactive.length > 0) return draft("warn", "inactive", { params: { methods: inactive.join(",") }, hint: "enableMethods", link, items })
  if (pending.length > 0) return draft("warn", "pending", { params: { methods: pending.join(",") }, hint: "waitReview", link, items })
  const hidden = rows.filter((r) => r.shown === "off").map((r) => r.method)
  if (hidden.length > 0) return draft("warn", "hidden", { params: { methods: hidden.join(",") }, hint: "turnOn", link, items })
  return draft("pass", "active", { items })
}

export function checkDeliveries(input: Pick<ChecksInput, "failedEvents" | "now" | "dashboard">): Draft {
  if (input.failedEvents === null || isFailure(input.failedEvents)) return unknown(isFailure(input.failedEvents) ? input.failedEvents : null)
  const now = input.now.getTime()
  const recent = input.failedEvents.filter((e) => {
    const t = typeof e.created === "number" ? e.created * 1000 : NaN
    return Number.isFinite(t) && t >= now - DELIVERY_WINDOW_HOURS * HOUR && t <= now - DELIVERY_GRACE_MINUTES * MINUTE
  })
  if (recent.length === 0) return draft("pass", "none")
  const items: CheckItemDto[] = recent.slice(0, 6).map((e) => ({
    label: String(e.type ?? "event"),
    value: String(e.id ?? ""),
    at: typeof e.created === "number" ? new Date(e.created * 1000).toISOString() : null,
    tone: e.type === EVENT_SUCCEEDED ? "red" : "orange",
  }))
  const succeeded = recent.filter((e) => e.type === EVENT_SUCCEEDED).length
  const link = { kind: "stripe" as const, url: input.dashboard.webhooks() }
  if (succeeded > 0) return draft("fail", "succeeded", { params: { count: recent.length, succeeded }, hint: "fixEndpoint", link, items })
  return draft("warn", "some", { params: { count: recent.length }, hint: "checkEndpoint", link, items })
}

/** A domain as Stripe stores it: lower case, no scheme, no port, no trailing dot. */
export function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string") return null
  let v = value.trim().toLowerCase()
  if (!v) return null
  if (/^[a-z]+:\/\//.test(v)) {
    try {
      v = new URL(v).hostname
    } catch {
      return null
    }
  }
  v = v.replace(/:\d+$/, "").replace(/\.$/, "").replace(/\/.*$/, "")
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : null
}

export function checkDomains(input: Pick<ChecksInput, "domains" | "storefront" | "dashboard">): Draft {
  if (input.domains === null || isFailure(input.domains)) return unknown(isFailure(input.domains) ? input.domains : null)
  const link = { kind: "stripe" as const, url: input.dashboard.domains() }
  const registered = new Map<string, RawPaymentMethodDomain>()
  for (const d of input.domains) {
    const name = normalizeDomain(d.domain_name)
    if (name) registered.set(name, d)
  }
  const expected = [...new Set(input.storefront.domains.map(normalizeDomain).filter((d): d is string => Boolean(d)))]
  const status = (d: RawPaymentMethodDomain | undefined, m: "apple_pay" | "google_pay") => d?.[m]?.status ?? null

  if (expected.length === 0) {
    const items: CheckItemDto[] = [...registered.entries()].map(([name, d]) => ({
      label: name,
      state: d.enabled === false ? "domain_disabled" : status(d, "apple_pay") === "active" ? "active" : "inactive",
      tone: d.enabled !== false && status(d, "apple_pay") === "active" ? "green" : "orange",
    }))
    if (items.some((i) => i.state === "active")) return draft("info", "unknownStorefront", { params: { domains: [...registered.keys()].join(", ") }, hint: "setStorefront", link, items })
    return draft("warn", "none", { hint: "register", link, items })
  }

  const missing: string[] = []
  const disabled: string[] = []
  const inactive: string[] = []
  let error = ""
  const items: CheckItemDto[] = expected.map((name) => {
    const d = registered.get(name)
    if (!d) {
      missing.push(name)
      return { label: name, state: "missing", tone: "red" }
    }
    if (d.enabled === false) {
      disabled.push(name)
      return { label: name, state: "domain_disabled", tone: "orange" }
    }
    const apple = status(d, "apple_pay")
    const google = status(d, "google_pay")
    if (apple !== "active" || (google !== null && google !== "active")) {
      inactive.push(name)
      error ||= d.apple_pay?.status_details?.error_message || d.google_pay?.status_details?.error_message || ""
      return { label: name, state: "inactive", value: [apple !== "active" ? "Apple Pay" : "", google !== null && google !== "active" ? "Google Pay" : ""].filter(Boolean).join(", "), tone: "orange" }
    }
    return { label: name, state: "active", tone: "green" }
  })
  if (missing.length > 0) return draft("warn", "missing", { params: { domains: missing.join(", ") }, hint: "register", link, items })
  if (disabled.length > 0) return draft("warn", "disabled", { params: { domains: disabled.join(", ") }, hint: "enableDomain", link, items })
  if (inactive.length > 0) return draft("warn", "inactive", { params: { domains: inactive.join(", "), error }, hint: "verify", link, items })
  return draft("pass", "ok", { params: { domains: expected.join(", ") }, items })
}

/** Whether the store's recent intents show BLIK and Przelewy24 inside the Payment Element (automatic payment methods). */
export function elementOffers(payments: readonly PaymentFacts[]): { blik: boolean; p24: boolean } {
  const auto = payments.filter((p) => p.sessionId && p.automatic && p.currency === "pln")
  return { blik: auto.some((p) => p.methodTypes.includes("blik")), p24: auto.some((p) => p.methodTypes.includes("p24")) }
}

export function checkRegions(input: Pick<ChecksInput, "regions" | "providerId" | "payments">): Draft {
  if (input.regions === null || isFailure(input.regions)) return unknown(isFailure(input.regions) ? input.regions : null)
  const ids = providerIds(input.providerId)
  const pln = input.regions.filter((r) => r.currency === "pln")
  if (pln.length === 0) return draft("info", "noPln", { params: { currencies: [...new Set(input.regions.map((r) => r.currency.toUpperCase()))].join(", ") } })
  const payments = input.payments && !isFailure(input.payments) ? input.payments : []
  const element = elementOffers(payments)
  const noStripe: string[] = []
  const missing: Array<{ region: string; methods: MethodKey[] }> = []
  let viaElement = false
  const items: CheckItemDto[] = []
  for (const r of pln) {
    const name = r.name || r.id
    const card = r.providers.includes(ids.card)
    const blikProvider = r.providers.includes(ids.blik)
    const p24Provider = r.providers.includes(ids.p24)
    if (!card && !blikProvider && !p24Provider) {
      noStripe.push(name)
      items.push({ label: name, state: "noStripe", tone: "red", url: `/settings/regions/${r.id}` })
      continue
    }
    const blik = blikProvider || (card && element.blik)
    const p24 = p24Provider || (card && element.p24)
    if ((!blikProvider && blik) || (!p24Provider && p24)) viaElement = true
    const lacking: MethodKey[] = [...(blik ? [] : (["blik"] as MethodKey[])), ...(p24 ? [] : (["p24"] as MethodKey[]))]
    if (lacking.length > 0) missing.push({ region: name, methods: lacking })
    items.push({ label: name, state: lacking.length > 0 ? "missing" : "ok", value: lacking.join(","), tone: lacking.length > 0 ? "orange" : "green", url: `/settings/regions/${r.id}` })
  }
  const first = pln[0]
  const adminLink = { kind: "admin" as const, url: `/settings/regions/${first.id}` }
  if (noStripe.length > 0) return draft("fail", "noStripe", { params: { regions: noStripe.join(", "), card: ids.card }, hint: "enableProviders", link: adminLink, items })
  if (missing.length > 0) {
    return draft("warn", "missingMethods", {
      params: { regions: missing.map((m) => m.region).join(", "), methods: [...new Set(missing.flatMap((m) => m.methods))].join(","), blik: ids.blik, p24: ids.p24 },
      hint: "enableOrElement",
      link: adminLink,
      items,
    })
  }
  return draft("pass", viaElement ? "viaElement" : "ok", { params: { regions: pln.map((r) => r.name || r.id).join(", ") }, items })
}

/** How the store's own card payments were captured over the read (Medusa's intents with automatic payment methods). */
export function captureModeOf(payments: readonly PaymentFacts[]): CaptureMode {
  const own = payments.filter((p) => p.sessionId && p.captureMethod)
  if (own.length === 0) return "unknown"
  const manual = own.some((p) => p.captureMethod === "manual")
  const automatic = own.some((p) => p.captureMethod !== "manual")
  return manual && automatic ? "mixed" : manual ? "manual" : "automatic"
}

/** Every PLN region offers BLIK and Przelewy24 as providers of their own (the alternative to automatic capture). */
export function separateProviders(regions: Read<RegionFacts[]>, providerId: string): boolean {
  if (!regions || isFailure(regions)) return false
  const ids = providerIds(providerId)
  const pln = regions.filter((r) => r.currency === "pln")
  return pln.length > 0 && pln.every((r) => r.providers.includes(ids.blik) && r.providers.includes(ids.p24))
}

export function checkCapture(input: Pick<ChecksInput, "payments" | "regions" | "providerId">): Draft {
  if (input.payments === null || isFailure(input.payments)) return unknown(isFailure(input.payments) ? input.payments : null)
  const own = input.payments.filter((p) => p.sessionId && p.currency === "pln")
  if (own.length === 0) return draft("info", "noData")
  const manualElement = own.filter((p) => p.automatic && p.captureMethod === "manual")
  if (manualElement.length === 0) return draft("pass", "automatic", { params: { count: own.length } })
  if (separateProviders(input.regions, input.providerId)) return draft("pass", "manualCards", { params: { count: manualElement.length } })
  const items: CheckItemDto[] = manualElement.slice(0, 3).map((p) => ({ label: p.id, value: p.methodTypes.join(", "), tone: "orange" }))
  return draft("warn", "manual", { params: { count: manualElement.length }, hint: "captureTrue", items })
}

export function checkOrphans(input: Pick<ChecksInput, "payments" | "ordersFailure" | "now" | "orderOf" | "dashboard">): Draft {
  if (input.payments === null || isFailure(input.payments)) return unknown(isFailure(input.payments) ? input.payments : null)
  if (input.ordersFailure) return unknown(input.ordersFailure)
  const now = input.now.getTime()
  const orphans = input.payments.filter((p) => p.status === "succeeded" && p.sessionId && !p.orderId && p.created >= now - ORPHAN_WINDOW_DAYS * DAY && p.created <= now - ORPHAN_GRACE_MINUTES * MINUTE)
  if (orphans.length === 0) return draft("pass", "none", { params: { days: ORPHAN_WINDOW_DAYS } })
  const items: CheckItemDto[] = orphans.slice(0, 10).map((p) => ({
    label: p.id,
    money: { amount: p.amount, currency: p.currency },
    at: new Date(p.created).toISOString(),
    value: p.cartId,
    url: input.dashboard.payment(p.id),
    tone: "red",
  }))
  return draft("fail", "found", { params: { count: orphans.length, days: ORPHAN_WINDOW_DAYS }, hint: "completeOrRefund", items })
}

/* ------------------------------------------------------------------ */

export function runChecks(input: ChecksInput): CheckResultDto[] {
  const payments = input.payments && !isFailure(input.payments) ? input.payments : []
  const run: Record<CheckKey, () => Draft> = {
    provider: () => checkProvider(input),
    key: () => checkKey(input),
    account: () => checkAccount(input),
    capabilities: () => checkCapabilities(input),
    webhook: () => {
      const r = checkWebhook({
        endpoints: input.endpoints,
        backendHosts: input.backendHosts,
        expectedUrl: input.expectedWebhookUrl,
        providerId: input.providerId,
        captureMode: captureModeOf(payments),
        dashboard: input.dashboard,
        demo: input.demo,
      })
      const { key: _key, demo: _demo, ...rest } = r
      return rest
    },
    deliveries: () => checkDeliveries(input),
    domains: () => checkDomains(input),
    regions: () => checkRegions(input),
    capture: () => checkCapture(input),
    orphans: () => checkOrphans(input),
  }
  return CHECK_KEYS.map((key) => {
    if (input.enabled[key] === false) return { key, demo: input.demo, ...draft("off", "off") }
    try {
      return { key, demo: input.demo, ...run[key]() }
    } catch (err) {
      return { key, demo: input.demo, ...draft("unknown", "notRead", { error: err instanceof Error ? err.message : String(err) }) }
    }
  })
}

const SEVERITY: Record<Verdict, number> = { fail: 5, warn: 4, unknown: 3, info: 2, pass: 1, off: 0 }

export function summarize(results: readonly Pick<CheckResultDto, "verdict">[]): HealthSummaryDto {
  const out: HealthSummaryDto = { pass: 0, warn: 0, fail: 0, info: 0, off: 0, unknown: 0, worst: "pass" }
  let worst = 0
  for (const r of results) {
    out[r.verdict] += 1
    if (SEVERITY[r.verdict] > worst) {
      worst = SEVERITY[r.verdict]
      out.worst = r.verdict
    }
  }
  if (results.length === 0 || worst === 0) out.worst = results.length === 0 ? "unknown" : "off"
  return out
}
