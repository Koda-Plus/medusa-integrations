/**
 * A scripted Stripe and a fake Medusa container for the flow tests (not a
 * test itself: the runner picks up `*.test.ts` only). The fake Query answers
 * the entities the plugin asks for (payment sessions, regions, orders by id
 * or by customer) from plain objects; the scripted Stripe answers paths from
 * handlers and counts every call. Nothing here touches the network.
 */
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import KodaStripeModuleService from "../src/modules/stripe/service.ts"
import { STRIPE_MODULE } from "../src/modules/stripe/lib/constants.ts"
import { StripeApiError } from "../src/modules/stripe/lib/errors.ts"
import type { StripePluginOptions } from "../src/modules/stripe/lib/options.ts"
import type { StripeParams } from "../src/modules/stripe/lib/client.ts"
import { CLIENT_KEY } from "../src/workflows/stripe/runtime.ts"

export const silent = { info() {}, warn() {}, error() {}, debug() {}, log() {} }

type Handler = (params: StripeParams | undefined) => unknown

export class FakeStripe {
  calls: Array<{ path: string; params?: StripeParams }> = []
  readonly routes: Record<string, Handler>
  constructor(routes: Record<string, Handler>) {
    this.routes = routes
  }
  private answer(path: string, params?: StripeParams): unknown {
    this.calls.push({ path, params })
    const exact = this.routes[path]
    const prefix = Object.entries(this.routes).find(([k]) => k.endsWith("/*") && path.startsWith(k.slice(0, -1)))?.[1]
    const handler = exact ?? prefix
    if (!handler) throw new StripeApiError({ kind: "not_found", message: `No such route ${path}`, status: 404 })
    return handler(params)
  }
  async get<T>(path: string, params?: StripeParams): Promise<T> {
    return this.answer(path, params) as T
  }
  async list<T>(path: string, params: StripeParams): Promise<{ data: T[]; complete: boolean; pages: number }> {
    return { data: this.answer(path, params) as T[], complete: true, pages: 1 }
  }
  count(path: string): number {
    return this.calls.filter((c) => c.path === path || (path.endsWith("/*") && c.path.startsWith(path.slice(0, -1)))).length
  }
}

export class RefusingStripe {
  calls = 0
  async get(): Promise<never> {
    this.calls += 1
    throw new Error("this read must not call Stripe")
  }
  async list(): Promise<never> {
    this.calls += 1
    throw new Error("this read must not call Stripe")
  }
}

export interface MedusaData {
  sessions?: Record<string, { orderId?: string; displayId?: number; cartId?: string }>
  sessionModes?: Array<{ livemode: boolean }>
  regions?: Array<{ id: string; name: string; currency_code: string; payment_providers?: Array<{ id: string; is_enabled: boolean }> }>
  orders?: Array<Record<string, unknown>>
  providers?: Array<{ id: string; is_enabled: boolean }>
  storeCors?: string
}

export interface QueryCall {
  entity: unknown
  fields: string[]
  filters: Record<string, unknown>
}

const list = (v: unknown): unknown[] | null => (v === undefined ? null : Array.isArray(v) ? v : [v])

export function graph(m: MedusaData, calls: QueryCall[] = []) {
  return async (args: Record<string, unknown>) => {
    const filters = (args.filters ?? {}) as Record<string, unknown>
    calls.push({ entity: args.entity, fields: (args.fields as string[]) ?? [], filters })
    if (args.entity === "payment_session" && Array.isArray(filters.id)) {
      return {
        data: (filters.id as string[])
          .filter((id) => m.sessions?.[id])
          .map((id) => {
            const s = m.sessions![id]
            return { id, payment_collection: { id: `pay_col_${id}`, order: s.orderId ? { id: s.orderId, display_id: s.displayId ?? null } : null, cart: s.cartId ? { id: s.cartId } : null } }
          }),
      }
    }
    if (args.entity === "payment_session") return { data: (m.sessionModes ?? []).map((s, i) => ({ id: `payses_mode${i}`, data: { id: `pi_mode${i}`, livemode: s.livemode, client_secret: "pi_mode_secret_x" } })) }
    if (args.entity === "region") return { data: m.regions ?? [] }
    if (args.entity === "order") {
      const ids = list(filters.id)
      const customers = list(filters.customer_id)
      let rows = (m.orders ?? []).filter((o) => (!ids || ids.includes(o.id)) && (!customers || customers.includes(o.customer_id)))
      const pagination = (args.pagination ?? {}) as { take?: number; order?: Record<string, string> }
      if (pagination.order?.created_at) rows = [...rows].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      if (typeof pagination.take === "number") rows = rows.slice(0, pagination.take)
      return { data: rows }
    }
    return { data: [] }
  }
}

export function container(options: StripePluginOptions, medusa: MedusaData = {}, client?: unknown, extra: Record<string, unknown> = {}) {
  const svc = new KodaStripeModuleService({ logger: silent as never }, options)
  const queries: QueryCall[] = []
  const registry: Record<string, unknown> = {
    [STRIPE_MODULE]: svc,
    [ContainerRegistrationKeys.QUERY]: { graph: graph(medusa, queries) },
    [Modules.PAYMENT]: { listPaymentProviders: async () => medusa.providers ?? [] },
    [ContainerRegistrationKeys.CONFIG_MODULE]: { projectConfig: { http: { storeCors: medusa.storeCors ?? "" } } },
    [CLIENT_KEY]: client,
    logger: silent,
    ...extra,
  }
  return {
    svc,
    queries,
    resolve<T>(key: string, o?: { allowUnregistered?: boolean }): T {
      if (registry[key] !== undefined) return registry[key] as T
      if (o?.allowUnregistered) return undefined as T
      throw new Error(`not registered: ${key}`)
    },
  }
}

export const PROVIDERS = ["pp_system_default", "pp_stripe_stripe", "pp_stripe-blik_stripe", "pp_stripe-przelewy24_stripe"].map((id) => ({ id, is_enabled: true }))
export const REGIONS = [{ id: "reg_FixturePL", name: "Polska", currency_code: "pln", payment_providers: [{ id: "pp_stripe_stripe", is_enabled: true }] }]

/** An order as Query returns it, paid through the given provider (the PaymentIntent id in the payment's data, as the official provider keeps it). */
export function paidOrder(id: string, displayId: number, provider: string, paymentIntent: string | null, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    display_id: displayId,
    customer_id: "cus_FixtureA",
    created_at: new Date().toISOString(),
    currency_code: "pln",
    total: "150.00",
    payment_collections: [
      {
        payments: [{ provider_id: provider, data: paymentIntent ? { id: paymentIntent, client_secret: `${paymentIntent}_secret_DoNotLeak` } : {}, amount: 150, currency_code: "pln", captured_at: new Date().toISOString(), canceled_at: null, refunds: [] }],
        payment_sessions: [{ provider_id: provider, data: paymentIntent ? { id: paymentIntent } : {} }],
      },
    ],
    ...over,
  }
}
