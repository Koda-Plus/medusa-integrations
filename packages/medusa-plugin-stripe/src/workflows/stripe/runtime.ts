/**
 * Shared plumbing of the Stripe reads: the module service, one client and
 * one cache per service, and the reads from Medusa (payment providers,
 * regions, payment sessions, orders). Everything here calls Medusa from the
 * outside, through the payment module and Query; the service stays thin.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type KodaStripeModuleService from "../../modules/stripe/service"
import { TtlCache } from "../../modules/stripe/lib/cache"
import type { ProviderFacts, RegionFacts } from "../../modules/stripe/lib/checks"
import { providerIds } from "../../modules/stripe/lib/checks"
import { StripeReadClient } from "../../modules/stripe/lib/client"
import { SESSION_CHUNK, STRIPE_MODULE } from "../../modules/stripe/lib/constants"
import type { OrderLinkDto } from "../../modules/stripe/lib/contract"
import type { DemoOrder, DemoRegion } from "../../modules/stripe/lib/demo"
import { domainsFromCors } from "../../modules/stripe/lib/options"
import { safeStripeId } from "../../modules/stripe/lib/security"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

export function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function stripeService(scope: Scope): KodaStripeModuleService {
  return resolve<KodaStripeModuleService>(scope, STRIPE_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

/* ------------------------------------------------------------------ */
/* One client and one cache per service instance                       */
/* ------------------------------------------------------------------ */

/** Container key a custom (or test) client may be registered under. */
export const CLIENT_KEY = "kodaStripeClient"

export interface ReadClient {
  get: StripeReadClient["get"]
  list: StripeReadClient["list"]
}

const clients = new WeakMap<object, StripeReadClient>()
const caches = new WeakMap<object, TtlCache>()

/** The Stripe client of this store: a registered one first (tests), otherwise one per service. */
export function clientFor(scope: Scope, svc: KodaStripeModuleService): ReadClient {
  const registered = resolveOptional<ReadClient>(scope, CLIENT_KEY)
  if (registered) return registered
  let client = clients.get(svc)
  if (!client) {
    const o = svc.getOptions()
    client = new StripeReadClient({ apiKey: o.apiKey, requestsPerSecond: o.requestsPerSecond, timeoutMs: o.timeoutMs })
    clients.set(svc, client)
  }
  return client
}

export function cacheFor(svc: KodaStripeModuleService): TtlCache {
  let cache = caches.get(svc)
  if (!cache) {
    cache = new TtlCache()
    caches.set(svc, cache)
  }
  return cache
}

/* ------------------------------------------------------------------ */
/* Reads from Medusa                                                   */
/* ------------------------------------------------------------------ */

interface PaymentModuleLike {
  listPaymentProviders(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string; is_enabled?: boolean | null }>>
}

/** Every payment provider this Medusa registered (the payment module's own list). */
export async function readProviders(scope: Scope): Promise<ProviderFacts[]> {
  const payment = resolve<PaymentModuleLike>(scope, Modules.PAYMENT)
  const list = await payment.listPaymentProviders({}, { take: 500 })
  return list.filter((p) => typeof p?.id === "string").map((p) => ({ id: p.id, isEnabled: p.is_enabled !== false }))
}

type RegionRecord = { id?: string; name?: string | null; currency_code?: string | null; payment_providers?: Array<{ id?: string; is_enabled?: boolean | null } | null> | null }

/** Regions with their enabled payment providers. */
export async function readRegions(scope: Scope): Promise<RegionFacts[]> {
  const { data } = await queryOf(scope).graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "payment_providers.id", "payment_providers.is_enabled"],
    pagination: { take: 500 },
  })
  return (data as RegionRecord[])
    .filter((r) => typeof r?.id === "string")
    .map((r) => ({
      id: String(r.id),
      name: r.name ?? null,
      currency: String(r.currency_code ?? "").toLowerCase(),
      providers: (r.payment_providers ?? []).filter((p): p is { id: string; is_enabled?: boolean | null } => typeof p?.id === "string" && p.is_enabled !== false).map((p) => p.id),
    }))
}

/** Regions as the demo generator wants them (no providers: the demo simulates those). */
export async function readDemoRegions(scope: Scope): Promise<DemoRegion[]> {
  const { data } = await queryOf(scope).graph({ entity: "region", fields: ["id", "name", "currency_code"], pagination: { take: 100 } })
  return (data as RegionRecord[]).filter((r) => typeof r?.id === "string").map((r) => ({ id: String(r.id), name: r.name ?? null, currency: String(r.currency_code ?? "pln").toLowerCase() }))
}

export interface SessionLink {
  order: OrderLinkDto | null
  cartId: string | null
}

type SessionRecord = {
  id?: string
  payment_collection?: { id?: string; order?: { id?: string; display_id?: number | null } | null; cart?: { id?: string } | null } | null
}

/**
 * Payment session id to its order (or its cart, when the cart never became
 * an order), in chunks. Sessions Medusa no longer has map to nothing.
 */
export async function readSessionLinks(scope: Scope, sessionIds: readonly string[]): Promise<Map<string, SessionLink>> {
  const ids = [...new Set(sessionIds.filter((id) => typeof id === "string" && /^[A-Za-z0-9_]+$/.test(id)))]
  const out = new Map<string, SessionLink>()
  for (let i = 0; i < ids.length; i += SESSION_CHUNK) {
    const chunk = ids.slice(i, i + SESSION_CHUNK)
    const { data } = await queryOf(scope).graph({
      entity: "payment_session",
      fields: ["id", "payment_collection.id", "payment_collection.order.id", "payment_collection.order.display_id", "payment_collection.cart.id"],
      filters: { id: chunk },
    })
    for (const s of data as SessionRecord[]) {
      if (typeof s?.id !== "string") continue
      const order = s.payment_collection?.order
      out.set(s.id, {
        order: order && typeof order.id === "string" ? { id: order.id, displayId: typeof order.display_id === "number" ? order.display_id : null } : null,
        cartId: !order && typeof s.payment_collection?.cart?.id === "string" ? s.payment_collection.cart.id : null,
      })
    }
  }
  return out
}

/**
 * The mode of the store's recent Stripe payments: the PaymentIntent the
 * official provider stores in each payment session carries `livemode`. Only
 * that flag is read; the session data never leaves this function.
 */
export async function readSessionModes(scope: Scope, providerId: string): Promise<{ live: number; test: number }> {
  const ids = providerIds(providerId)
  const { data } = await queryOf(scope).graph({
    entity: "payment_session",
    fields: ["id", "data", "created_at"],
    filters: { provider_id: [ids.card, ids.blik, ids.p24] },
    pagination: { take: 30, order: { created_at: "DESC" } },
  })
  const out = { live: 0, test: 0 }
  for (const s of data as Array<{ data?: Record<string, unknown> | null }>) {
    const live = s?.data?.livemode
    if (live === true) out.live += 1
    else if (live === false) out.test += 1
  }
  return out
}

interface ConfigModuleLike {
  projectConfig?: { http?: { storeCors?: string } }
}

/** Storefront domains: the option, otherwise the http(s) origins of STORE_CORS. */
export function storefrontDomains(scope: Scope, option: string[] | null): { domains: string[]; source: "option" | "store_cors" | "none" } {
  if (option !== null) return { domains: option, source: "option" }
  const config = resolveOptional<ConfigModuleLike>(scope, ContainerRegistrationKeys.CONFIG_MODULE)
  const domains = domainsFromCors(config?.projectConfig?.http?.storeCors)
  return domains.length > 0 ? { domains, source: "store_cors" } : { domains: [], source: "none" }
}

export interface OrderPaymentRef {
  paymentIntentId: string
  providerId: string | null
}

type OrderPaymentsRecord = {
  id?: string
  display_id?: number | null
  payment_collections?: Array<{
    payments?: Array<{ provider_id?: string | null; data?: Record<string, unknown> | null; created_at?: string | Date | null } | null> | null
    payment_sessions?: Array<{ provider_id?: string | null; data?: Record<string, unknown> | null; created_at?: string | Date | null } | null> | null
  } | null> | null
}

const isStripeProvider = (id: unknown) => typeof id === "string" && /^pp_stripe(-[a-z0-9]+)?_/.test(id)

/**
 * The PaymentIntents behind an order. The official provider keeps the
 * PaymentIntent as the payment's data, so `payment.data.id` is its id; a
 * session without a payment yet (not authorized) is read the same way.
 * Payments first, sessions after, each PaymentIntent once, at most five.
 * Only the id is taken out of the data: the client secret stays where it is.
 */
export async function readOrderPaymentRefs(scope: Scope, orderId: string): Promise<{ found: boolean; displayId: number | null; refs: OrderPaymentRef[] }> {
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "payment_collections.payments.provider_id",
      "payment_collections.payments.data",
      "payment_collections.payments.created_at",
      "payment_collections.payment_sessions.provider_id",
      "payment_collections.payment_sessions.data",
      "payment_collections.payment_sessions.created_at",
    ],
    filters: { id: orderId },
  })
  const order = (data as OrderPaymentsRecord[])[0]
  if (!order) return { found: false, displayId: null, refs: [] }
  const refs: OrderPaymentRef[] = []
  const seen = new Set<string>()
  const add = (provider: unknown, value: Record<string, unknown> | null | undefined) => {
    if (!isStripeProvider(provider)) return
    const id = safeStripeId(value?.id, "pi")
    if (!id || seen.has(id) || refs.length >= 5) return
    seen.add(id)
    refs.push({ paymentIntentId: id, providerId: typeof provider === "string" ? provider : null })
  }
  for (const c of order.payment_collections ?? []) for (const p of c?.payments ?? []) add(p?.provider_id, p?.data)
  for (const c of order.payment_collections ?? []) for (const s of c?.payment_sessions ?? []) add(s?.provider_id, s?.data)
  return { found: true, displayId: typeof order.display_id === "number" ? order.display_id : null, refs }
}

type DemoOrderRecord = { id?: string; display_id?: number | null; created_at?: string | Date | null; total?: unknown; currency_code?: string | null }

const DEMO_ORDER_FIELDS = ["id", "display_id", "created_at", "total", "currency_code"]

function toDemoOrder(o: DemoOrderRecord): DemoOrder | null {
  if (typeof o?.id !== "string") return null
  return { id: o.id, displayId: typeof o.display_id === "number" ? o.display_id : null, createdAt: o.created_at ?? null, total: o.total, currency: String(o.currency_code ?? "pln").toLowerCase() }
}

/** The newest orders, for the demo payments. */
export async function readDemoOrders(scope: Scope, limit: number): Promise<DemoOrder[]> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: DEMO_ORDER_FIELDS, pagination: { take: limit, order: { created_at: "DESC" } } })
  return (data as DemoOrderRecord[]).map(toDemoOrder).filter((o): o is DemoOrder => o !== null)
}

export async function readDemoOrder(scope: Scope, orderId: string): Promise<DemoOrder | null> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: DEMO_ORDER_FIELDS, filters: { id: orderId } })
  return toDemoOrder((data as DemoOrderRecord[])[0] ?? {})
}

/* ------------------------------------------------------------------ */
/* The address of this backend                                         */
/* ------------------------------------------------------------------ */

type HeaderBag = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim() ?? ""

/**
 * The public origin the admin was opened on: the proxy's forwarded host and
 * protocol (Railway, a load balancer), otherwise the Host header. Used only
 * to say which webhook URL this backend expects.
 */
export function requestOrigin(req: { headers?: HeaderBag; protocol?: string }): string | null {
  const headers = req.headers ?? {}
  const host = first(headers["x-forwarded-host"]) || first(headers.host)
  if (!host || !/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null
  const proto = (first(headers["x-forwarded-proto"]) || req.protocol || "https").toLowerCase()
  return `${proto === "http" ? "http" : "https"}://${host.toLowerCase()}`
}
