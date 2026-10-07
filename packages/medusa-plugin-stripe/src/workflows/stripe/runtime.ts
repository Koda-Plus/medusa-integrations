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
import { demoQualifies, type DemoOrder, type DemoPaymentRecord, type DemoRegion } from "../../modules/stripe/lib/demo"
import { decimalString } from "../../modules/stripe/lib/money"
import { domainsFromCors, type DemoOrderRule } from "../../modules/stripe/lib/options"
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

/** Tests only: a cache with a clock of its own for this service. */
export function setCacheForTests(svc: KodaStripeModuleService, cache: TtlCache): void {
  caches.set(svc, cache)
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

/** What Medusa itself records about the payment behind a PaymentIntent. */
export interface MedusaPaymentFacts {
  /** Medusa has a payment (authorized at checkout); a session alone was never authorized. */
  payment: boolean
  /** Major units, as Medusa keeps them (a decimal string). */
  amount: string | null
  currency: string | null
  capturedAt: string | null
  canceledAt: string | null
  refunds: number
}

export interface OrderPaymentRef {
  paymentIntentId: string
  providerId: string | null
  /** Changes when Medusa captures, cancels or refunds the payment, so the widget and the summary read Stripe again. */
  stamp: string
  medusa: MedusaPaymentFacts
}

export interface OrderPayments {
  id: string
  displayId: number | null
  customerId: string | null
  createdAt: string | null
  /** The order has at least one payment collection. */
  collections: number
  refs: OrderPaymentRef[]
}

type PaymentRecord = {
  provider_id?: string | null
  data?: Record<string, unknown> | null
  amount?: unknown
  currency_code?: string | null
  captured_at?: string | Date | null
  canceled_at?: string | Date | null
  refunds?: Array<{ id?: string } | null> | null
}

type OrderPaymentsRecord = {
  id?: string
  display_id?: number | null
  customer_id?: string | null
  created_at?: string | Date | null
  payment_collections?: Array<{
    payments?: Array<PaymentRecord | null> | null
    payment_sessions?: Array<{ provider_id?: string | null; data?: Record<string, unknown> | null } | null> | null
  } | null> | null
}

const ORDER_PAYMENT_FIELDS = [
  "id",
  "display_id",
  "customer_id",
  "created_at",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  "payment_collections.payments.amount",
  "payment_collections.payments.currency_code",
  "payment_collections.payments.captured_at",
  "payment_collections.payments.canceled_at",
  "payment_collections.payments.refunds.id",
  "payment_collections.payment_sessions.provider_id",
  "payment_collections.payment_sessions.data",
]

const isoOf = (v: unknown): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const isStripeProvider = (id: unknown) => typeof id === "string" && /^pp_stripe(-[a-z0-9]+)?_/.test(id)

/**
 * The PaymentIntents behind an order. The official provider keeps the
 * PaymentIntent as the payment's data, so `payment.data.id` is its id; a
 * session without a payment yet (not authorized) is read the same way.
 * Payments first, sessions after, each PaymentIntent once, at most five.
 * Only the id is taken out of the data: the client secret stays where it is.
 * Never metadata: what Medusa's payment module recorded is the record.
 */
export function orderPaymentsOf(order: OrderPaymentsRecord): OrderPayments | null {
  if (typeof order?.id !== "string") return null
  const refs: OrderPaymentRef[] = []
  const seen = new Set<string>()
  const add = (provider: unknown, value: Record<string, unknown> | null | undefined, p: PaymentRecord | null) => {
    if (!isStripeProvider(provider)) return
    const id = safeStripeId(value?.id, "pi")
    if (!id || seen.has(id) || refs.length >= 5) return
    seen.add(id)
    const medusa: MedusaPaymentFacts = {
      payment: p !== null,
      amount: p ? decimalString(p.amount) : null,
      currency: p && typeof p.currency_code === "string" ? p.currency_code.toLowerCase() : null,
      capturedAt: p ? isoOf(p.captured_at) : null,
      canceledAt: p ? isoOf(p.canceled_at) : null,
      refunds: p ? (p.refunds ?? []).filter(Boolean).length : 0,
    }
    refs.push({
      paymentIntentId: id,
      providerId: typeof provider === "string" ? provider : null,
      stamp: medusa.payment ? `${medusa.capturedAt ?? "-"}.${medusa.canceledAt ?? "-"}.${medusa.refunds}` : "session",
      medusa,
    })
  }
  const collections = (order.payment_collections ?? []).filter(Boolean)
  for (const c of collections) for (const p of c?.payments ?? []) if (p) add(p.provider_id, p.data, p)
  for (const c of collections) for (const s of c?.payment_sessions ?? []) add(s?.provider_id, s?.data, null)
  return {
    id: order.id,
    displayId: typeof order.display_id === "number" ? order.display_id : null,
    customerId: typeof order.customer_id === "string" ? order.customer_id : null,
    createdAt: isoOf(order.created_at),
    collections: collections.length,
    refs,
  }
}

/** The Stripe payments of many orders in one query (ids are checked by the caller). */
export async function readOrdersPayments(scope: Scope, ids: readonly string[]): Promise<Map<string, OrderPayments>> {
  const out = new Map<string, OrderPayments>()
  if (ids.length === 0) return out
  const { data } = await queryOf(scope).graph({ entity: "order", fields: ORDER_PAYMENT_FIELDS, filters: { id: [...ids] } })
  for (const o of data as OrderPaymentsRecord[]) {
    const read = orderPaymentsOf(o)
    if (read) out.set(read.id, read)
  }
  return out
}

/** The Stripe payments of the orders of some customers, newest first, in one query. */
export async function readCustomersPayments(scope: Scope, customerIds: readonly string[], perCustomer = 50): Promise<OrderPayments[]> {
  if (customerIds.length === 0) return []
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: ORDER_PAYMENT_FIELDS,
    filters: { customer_id: [...customerIds] },
    pagination: { take: Math.min(2_000, customerIds.length * perCustomer), order: { created_at: "DESC" } },
  })
  return (data as OrderPaymentsRecord[]).map(orderPaymentsOf).filter((o): o is OrderPayments => o !== null)
}

export async function readOrderPaymentRefs(scope: Scope, orderId: string): Promise<{ found: boolean; displayId: number | null; refs: OrderPaymentRef[] }> {
  const read = (await readOrdersPayments(scope, [orderId])).get(orderId)
  if (!read) return { found: false, displayId: null, refs: [] }
  return { found: true, displayId: read.displayId, refs: read.refs }
}

type DemoOrderRecord = DemoPaymentRecord & { id?: string; display_id?: number | null; created_at?: string | Date | null; total?: unknown; currency_code?: string | null }

/* Providers only: whether Stripe would have taken the payment. Never metadata. */
const DEMO_ORDER_FIELDS = ["id", "display_id", "created_at", "currency_code", "payment_collections.payments.provider_id", "payment_collections.payment_sessions.provider_id"]

function toDemoOrder(o: DemoOrderRecord, total: unknown, provider: string | null): DemoOrder | null {
  if (typeof o?.id !== "string") return null
  return { id: o.id, displayId: typeof o.display_id === "number" ? o.display_id : null, createdAt: o.created_at ?? null, total, currency: String(o.currency_code ?? "pln").toLowerCase(), provider }
}

/**
 * Totals of some orders: one query, and one order at a time only when that
 * fails (Medusa refuses to compute the totals of an order whose shipping
 * method has no version, as some imported orders carry; in one query a single
 * such order would empty the whole demo). An order without a total gets no
 * sample payment.
 */
async function readTotals(scope: Scope, ids: string[]): Promise<Map<string, unknown>> {
  const totals = new Map<string, unknown>()
  if (ids.length === 0) return totals
  try {
    const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "total"], filters: { id: ids } })
    for (const o of data as DemoOrderRecord[]) if (typeof o?.id === "string") totals.set(o.id, o.total ?? null)
    return totals
  } catch {
    for (const id of ids) {
      try {
        const { data } = await queryOf(scope).graph({ entity: "order", fields: ["id", "total"], filters: { id } })
        totals.set(id, (data as DemoOrderRecord[])[0]?.total ?? null)
      } catch {
        totals.set(id, null)
      }
    }
    return totals
  }
}

async function demoOrdersOf(scope: Scope, records: DemoOrderRecord[], rule: DemoOrderRule, limit: number): Promise<DemoOrder[]> {
  const picked = records
    .map((o) => ({ o, q: demoQualifies(o, rule) }))
    .filter((x) => typeof x.o?.id === "string" && x.q.ok)
    .slice(0, limit)
  const totals = await readTotals(scope, picked.map((x) => String(x.o.id)))
  return picked.map((x) => toDemoOrder(x.o, totals.get(String(x.o.id)) ?? null, x.q.provider)).filter((o): o is DemoOrder => o !== null)
}

/** The newest orders Stripe would have paid (option `demoOrders`), for the demo payments. */
export async function readDemoOrders(scope: Scope, limit: number, rule: DemoOrderRule = "stripe"): Promise<DemoOrder[]> {
  const { data } = await queryOf(scope).graph({ entity: "order", fields: DEMO_ORDER_FIELDS, pagination: { take: limit * 3, order: { created_at: "DESC" } } })
  return demoOrdersOf(scope, data as DemoOrderRecord[], rule, limit)
}

/** Some orders by id, those Stripe would have paid; the others are left out. */
export async function readDemoOrdersById(scope: Scope, ids: readonly string[], rule: DemoOrderRule = "stripe"): Promise<Map<string, DemoOrder>> {
  if (ids.length === 0) return new Map()
  const { data } = await queryOf(scope).graph({ entity: "order", fields: DEMO_ORDER_FIELDS, filters: { id: [...ids] } })
  const orders = await demoOrdersOf(scope, data as DemoOrderRecord[], rule, ids.length)
  return new Map(orders.map((o) => [o.id, o]))
}

/** The orders of some customers that Stripe would have paid, newest first, per customer. */
export async function readDemoOrdersOfCustomers(scope: Scope, customerIds: readonly string[], rule: DemoOrderRule = "stripe", perCustomer = 50): Promise<Map<string, DemoOrder[]>> {
  const out = new Map<string, DemoOrder[]>()
  if (customerIds.length === 0) return out
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: [...DEMO_ORDER_FIELDS, "customer_id"],
    filters: { customer_id: [...customerIds] },
    pagination: { take: Math.min(2_000, customerIds.length * perCustomer), order: { created_at: "DESC" } },
  })
  const records = data as Array<DemoOrderRecord & { customer_id?: string | null }>
  const customerOf = new Map(records.map((r) => [String(r.id), typeof r.customer_id === "string" ? r.customer_id : null]))
  for (const order of await demoOrdersOf(scope, records, rule, records.length)) {
    const customer = customerOf.get(order.id)
    if (!customer) continue
    out.set(customer, [...(out.get(customer) ?? []), order])
  }
  return out
}

/** One order for the demo widget, or null when it is unknown or Stripe would not have paid it. */
export async function readDemoOrder(scope: Scope, orderId: string, rule: DemoOrderRule = "stripe"): Promise<DemoOrder | null> {
  return (await readDemoOrdersById(scope, [orderId], rule)).get(orderId) ?? null
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
