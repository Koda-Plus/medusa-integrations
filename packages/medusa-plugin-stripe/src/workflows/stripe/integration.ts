import { needsAttention } from "../../modules/stripe/lib/attention"
import { COUNTER_MAX_AGE_SECONDS, SUMMARY_READS } from "../../modules/stripe/lib/constants"
import type { OrderPaymentDto, StripeMode } from "../../modules/stripe/lib/contract"
import { STRIPE_EXTERNAL_HOSTS, customerSummary, orderSummary, stripeCounters, type CustomerOrderInput, type PaymentInput, type SummaryContext } from "../../modules/stripe/lib/integration"
import { integrationEn, integrationPl } from "../../modules/stripe/lib/integration-texts"
import { KIT_META } from "../../modules/stripe/lib/kit-meta"
import { integrationRoutes, textFor, type IntegrationContext, type MessageDraft, type SummaryDraft } from "../../modules/stripe/lib/kit-routes"
import { minorToDecimal } from "../../modules/stripe/lib/money"
import { unreadPayment } from "../../modules/stripe/lib/order-payment"
import { loadChecks } from "./health"
import { cachedPayment, demoPaymentOf, liveMode, paymentFromSnapshot, stripePaymentsOf } from "./order"
import { readCustomersPayments, readDemoOrdersById, readDemoOrdersOfCustomers, readOrdersPayments, requestOrigin, stripeService, type OrderPaymentRef } from "./runtime"
import { lastReadAt, snapshotOrStale } from "./snapshot"

/**
 * koda.integration/1 for Stripe: the manifest, one line per order and per
 * customer, and the board counters.
 *
 *   GET /admin/stripe/integration
 *   GET /admin/stripe/integration/summary?entity=order&id=order_...      (or ids=, up to 50)
 *   GET /admin/stripe/integration/summary?entity=customer&id=cus_...
 *   GET /admin/stripe/integration/attention?scope=orders,integration
 *
 * Reads only, and Stripe only through the plugin's cache:
 *   - an order: its payments in Medusa (one query for every id), then each
 *     PaymentIntent from the cache the order widget fills (the widget and the
 *     summary of one order cost one read together); one answer reads at most
 *     a few PaymentIntents, the rest come from the cache or from Medusa's own
 *     record;
 *   - a customer: the orders in Medusa (one query), the payments from the
 *     30 days the panel read and from the widget's cache, never a new read
 *     per payment;
 *   - the counters: the panel's read and the checks, reused up to 15 minutes.
 * When Stripe does not answer, the last good read is served with `stale`.
 * No metadata, no write, no demo seeding (demo answers come from the same
 * sample account the panel shows).
 */

const texts = { en: integrationEn, pl: integrationPl }

function summaryContext(ctx: IntegrationContext, mode: StripeMode, now: Date): SummaryContext {
  return {
    mode,
    now,
    /* Stripe's amounts are minor units: the decimal point moves by the currency's exponent before Intl formats it. */
    money: (minor, currency) => ctx.money(Number(minorToDecimal(minor, currency)), currency),
    date: (iso) => ctx.date(iso),
    text: (m: MessageDraft) => textFor(texts, ctx.lang, m),
  }
}

const originOf = (ctx: IntegrationContext): string | null => requestOrigin(ctx.req as unknown as { headers?: Record<string, string | string[] | undefined>; protocol?: string })

function inputOf(ref: OrderPaymentRef, read: OrderPaymentDto | null): PaymentInput {
  return { paymentIntentId: ref.paymentIntentId, providerId: ref.providerId, medusa: ref.medusa, read }
}

/** A demo payment as the summary reads it: Medusa's side of a sample payment is paid and captured. */
function demoInput(read: OrderPaymentDto): PaymentInput {
  return { paymentIntentId: read.id, providerId: read.providerId, medusa: { payment: true, capturedAt: read.payment?.created ?? null, canceledAt: null, refunds: 0 }, read }
}

async function summarizeOrders(ctx: IntegrationContext, ids: string[]): Promise<Map<string, SummaryDraft>> {
  const out = new Map<string, SummaryDraft>()
  const svc = stripeService(ctx.scope)
  const now = new Date()
  if (svc.isDemo()) {
    const sctx = summaryContext(ctx, "demo", now)
    const orders = await readDemoOrdersById(ctx.scope, ids, svc.getOptions().demoOrders)
    for (const id of ids) {
      const order = orders.get(id)
      const read = order ? await demoPaymentOf(ctx.scope, order, { origin: originOf(ctx), now }) : null
      if (!order || !read) continue
      const draft = orderSummary([demoInput(read)], { ...sctx, orderId: id, displayId: order.displayId })
      if (draft) out.set(id, draft)
    }
    return out
  }
  const mode = liveMode(ctx.scope)
  const sctx = summaryContext(ctx, mode, now)
  const orders = await readOrdersPayments(ctx.scope, ids)
  const budget = { left: SUMMARY_READS }
  for (const id of ids) {
    const order = orders.get(id)
    if (!order || order.refs.length === 0) continue
    const reads = await stripePaymentsOf(ctx.scope, order.refs, { id, displayId: order.displayId }, { mode, now, budget })
    const draft = orderSummary(
      order.refs.map((r, i) => inputOf(r, reads[i] ?? null)),
      { ...sctx, orderId: id, displayId: order.displayId },
    )
    if (draft) out.set(id, draft)
  }
  return out
}

async function summarizeCustomers(ctx: IntegrationContext, ids: string[]): Promise<Map<string, SummaryDraft>> {
  const out = new Map<string, SummaryDraft>()
  const svc = stripeService(ctx.scope)
  const now = new Date()
  if (svc.isDemo()) {
    const sctx = summaryContext(ctx, "demo", now)
    const byCustomer = await readDemoOrdersOfCustomers(ctx.scope, ids, svc.getOptions().demoOrders)
    for (const id of ids) {
      const orders: CustomerOrderInput[] = []
      for (const order of byCustomer.get(id) ?? []) {
        const read = await demoPaymentOf(ctx.scope, order, { origin: originOf(ctx), now })
        if (read) orders.push({ orderId: order.id, displayId: order.displayId, payments: [demoInput(read)] })
      }
      const draft = customerSummary(orders, sctx)
      if (draft) out.set(id, draft)
    }
    return out
  }
  const mode = liveMode(ctx.scope)
  const sctx = summaryContext(ctx, mode, now)
  const orders = (await readCustomersPayments(ctx.scope, ids)).filter((o) => o.refs.length > 0)
  if (orders.length === 0) return out
  /* The 30 days the panel read (reused up to 15 minutes), then the widget's cache; Stripe is never asked per payment. */
  const snap = svc.isConfigured() ? await snapshotOrStale(ctx.scope, { origin: originOf(ctx), maxAgeMs: COUNTER_MAX_AGE_SECONDS * 1000 }) : null
  const readOf = (ref: OrderPaymentRef): OrderPaymentDto | null => {
    if (!svc.isConfigured()) return unreadPayment(ref.paymentIntentId, ref.providerId, "unconfigured")
    return cachedPayment(ctx.scope, ref, mode, now) ?? (snap ? paymentFromSnapshot(snap.snapshot, ref, { now, at: snap.at, stale: snap.stale }) : null)
  }
  for (const id of ids) {
    const mine: CustomerOrderInput[] = orders
      .filter((o) => o.customerId === id)
      .map((o) => ({ orderId: o.id, displayId: o.displayId, payments: o.refs.map((r) => inputOf(r, readOf(r))) }))
    const draft = customerSummary(mine, sctx)
    if (draft) out.set(id, draft)
  }
  return out
}

export const stripeIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/stripe",
  entities: ["order", "customer"],
  attention: ["orders", "integration"],
  widgets: [{ id: "stripe.order", zone: "order.details" }],
  texts,
  externalHosts: [...STRIPE_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = stripeService(ctx.scope)
    const key = svc.keyInfo()
    const demo = svc.isDemo()
    const configured = svc.isConfigured()
    const problems: MessageDraft[] = []
    if (demo) problems.push({ key: "integration.problem.demo" })
    else if (!configured) problems.push({ key: "integration.problem.not_configured" })
    else if (key.kind === "publishable") problems.push({ key: "integration.problem.publishable" })
    else if (key.kind === "secret") problems.push({ key: "integration.problem.secret" })
    return {
      mode: demo ? "demo" : !configured ? "off" : key.mode === "test" ? "sandbox" : "live",
      configured,
      lastSyncAt: lastReadAt(ctx.scope, originOf(ctx)),
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    if (entity === "order") return summarizeOrders(ctx, ids)
    if (entity === "customer") return summarizeCustomers(ctx, ids)
    return new Map()
  },

  async count(ctx, scopes) {
    const svc = stripeService(ctx.scope)
    if (!svc.isConfigured()) return []
    const origin = originOf(ctx)
    const maxAgeMs = COUNTER_MAX_AGE_SECONDS * 1000
    let orders: Parameters<typeof stripeCounters>[0]["orders"] = null
    let checksFailing: number | null = null
    if (scopes.includes("orders")) {
      const snap = await snapshotOrStale(ctx.scope, { origin, maxAgeMs })
      if (snap) {
        const now = Date.now()
        const attention = snap.snapshot.payments.filter((p) => needsAttention(p, now))
        const open = snap.snapshot.disputes.filter((d) => d.open)
        const ids = (list: Array<{ order: { id: string } | null }>) => [...new Set(list.map((x) => x.order?.id).filter((x): x is string => Boolean(x)))]
        orders = { paymentsFailed: attention.length, paymentsFailedOrders: ids(attention), disputesOpen: open.length, disputeOrders: ids(open) }
      }
    }
    if (scopes.includes("integration")) {
      try {
        const checks = await loadChecks(ctx.scope, { origin, maxAgeMs })
        checksFailing = checks.results.filter((r) => r.verdict === "fail").length
      } catch {
        checksFailing = null
      }
    }
    return stripeCounters({ orders, checksFailing })
  },
})
