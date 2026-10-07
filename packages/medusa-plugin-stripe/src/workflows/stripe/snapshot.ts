/**
 * THE SNAPSHOT: 30 DAYS OF STRIPE, READ ONCE, KEPT FOR `cacheSeconds`.
 *
 * Live: five reads in parallel (payments with their charge and balance
 * transaction expanded, refunds and disputes with their PaymentIntent
 * expanded, the balance, the latest payouts), then one Query over the
 * payment sessions to find each payment's order. A part that fails leaves
 * its section empty with the reason (and the permission Stripe asked for);
 * the rest of the page still shows.
 *
 * Demo: the same rows built from the store's own orders (lib/demo.ts),
 * through the same parsers.
 */
import { FORCE_REFRESH_MIN_MS, ERROR_CACHE_MS, DEMO_ORDERS, DISPUTES_LIMIT, PAYOUTS_LIMIT, WINDOW_DAYS } from "../../modules/stripe/lib/constants"
import type { BalanceDto, DisputeRowDto, MethodKey, PaymentRowDto, PayoutRowDto, RefundRowDto, SectionErrorDto, SectionKey } from "../../modules/stripe/lib/contract"
import { DashboardLinks } from "../../modules/stripe/lib/dashboard"
import { buildDemoData, type DemoData } from "../../modules/stripe/lib/demo"
import { toFailure, type ReadFailure } from "../../modules/stripe/lib/errors"
import { normalizeBalance, normalizeDispute, normalizePaymentIntent, normalizePayout, normalizeRefund, sessionOf, sortDisputes, type OrderLookup, type PaymentFacts } from "../../modules/stripe/lib/normalize"
import type { RawBalance, RawDispute, RawPaymentIntent, RawPayout, RawRefund } from "../../modules/stripe/lib/stripe-types"
import { expectedWebhookUrl } from "../../modules/stripe/lib/webhooks"
import { cacheFor, clientFor, readDemoOrders, readDemoRegions, readSessionLinks, storefrontDomains, stripeService, type Scope, type SessionLink } from "./runtime"

const DAY = 24 * 60 * 60 * 1000

export interface Snapshot {
  mode: "live" | "test" | "demo"
  fetchedAt: string
  payments: PaymentRowDto[]
  facts: PaymentFacts[]
  refunds: RefundRowDto[]
  disputes: DisputeRowDto[]
  balance: BalanceDto | null
  payouts: PayoutRowDto[]
  /** The payment read stopped early: the oldest payment it reached (ms). Null when complete. */
  coveredFrom: number | null
  errors: SectionErrorDto[]
  /** The payment read failed altogether. */
  paymentsFailure: ReadFailure | null
  /** Payments could not be matched to orders. */
  ordersFailure: ReadFailure | null
  /** Stripe refused the key (401). */
  keyFailure: ReadFailure | null
  /** Demo mode: the whole sample account, for the checks. */
  demo: DemoData | null
}

export function dashboardFor(mode: "live" | "test" | "demo"): DashboardLinks {
  return new DashboardLinks(mode === "test" ? "test" : "live")
}

function lookupOf(links: Map<string, SessionLink>): OrderLookup {
  return {
    orderOf: (id) => (id ? (links.get(id)?.order ?? null) : null),
    cartOf: (id) => (id ? (links.get(id)?.cartId ?? null) : null),
  }
}

function sectionError(section: SectionKey, f: ReadFailure): SectionErrorDto {
  return { section, message: f.error, status: f.status, permission: f.permission }
}

/** Turns raw Stripe objects into the snapshot rows: shared by the live read and the demo. */
export function buildRows(args: {
  mode: "live" | "test" | "demo"
  now: Date
  paymentIntents: RawPaymentIntent[]
  refunds: RawRefund[]
  disputes: RawDispute[]
  balance: RawBalance | null
  payouts: RawPayout[]
  orders: OrderLookup
}): Pick<Snapshot, "payments" | "facts" | "refunds" | "disputes" | "balance" | "payouts"> {
  const ctx = { dashboard: dashboardFor(args.mode), orders: args.orders, demo: args.mode === "demo" }
  const payments: PaymentRowDto[] = []
  const facts: PaymentFacts[] = []
  for (const pi of args.paymentIntents) {
    const n = normalizePaymentIntent(pi, ctx)
    if (!n) continue
    payments.push(n.row)
    facts.push(n.facts)
  }
  payments.sort((a, b) => b.created.localeCompare(a.created))
  const methodOf = new Map<string, MethodKey | null>(payments.map((p) => [p.id, p.method]))
  const refunds = args.refunds
    .map((r) => normalizeRefund(r, ctx))
    .filter((r): r is RefundRowDto => r !== null)
    .sort((a, b) => b.created.localeCompare(a.created))
  const disputes = sortDisputes(
    args.disputes
      .map((d) => normalizeDispute(d, { ...ctx, now: args.now, methodOf: (pi) => (pi ? (methodOf.get(pi) ?? null) : null) }))
      .filter((d): d is DisputeRowDto => d !== null),
  )
  const payouts = args.payouts.map((p) => normalizePayout(p, ctx)).filter((p): p is PayoutRowDto => p !== null)
  return { payments, facts, refunds, disputes, balance: normalizeBalance(args.balance), payouts }
}

/* ------------------------------------------------------------------ */

async function readLive(scope: Scope, now: Date): Promise<Snapshot> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const client = clientFor(scope, svc)
  const mode = svc.keyInfo().mode === "test" ? "test" : "live"
  const secrets = [o.apiKey]
  const since = Math.floor((now.getTime() - WINDOW_DAYS * DAY) / 1000)

  const [pis, refunds, disputes, balance, payouts] = await Promise.allSettled([
    client.list<RawPaymentIntent>("/payment_intents", { created: { gte: since }, expand: ["data.latest_charge.balance_transaction"] }, { maxPages: o.maxPages }),
    client.list<RawRefund>("/refunds", { created: { gte: since }, expand: ["data.payment_intent"] }, { maxPages: Math.min(5, o.maxPages) }),
    client.list<RawDispute>("/disputes", { expand: ["data.payment_intent"] }, { maxPages: 1, limit: DISPUTES_LIMIT }),
    client.get<RawBalance>("/balance"),
    client.list<RawPayout>("/payouts", {}, { maxPages: 1, limit: PAYOUTS_LIMIT }),
  ])

  const errors: SectionErrorDto[] = []
  const failure = (section: SectionKey, r: PromiseSettledResult<unknown>): ReadFailure | null => {
    if (r.status === "fulfilled") return null
    const f = toFailure(r.reason, secrets)
    errors.push(sectionError(section, f))
    return f
  }
  const paymentsFailure = failure("payments", pis)
  failure("refunds", refunds)
  failure("disputes", disputes)
  failure("balance", balance)
  failure("payouts", payouts)
  const keyFailure = [pis, refunds, disputes, balance, payouts]
    .map((r) => (r.status === "rejected" ? toFailure(r.reason, secrets) : null))
    .find((f) => f?.kind === "auth") ?? null

  const piList = pis.status === "fulfilled" ? pis.value.data : []
  const refundList = refunds.status === "fulfilled" ? refunds.value.data : []
  const disputeList = disputes.status === "fulfilled" ? disputes.value.data : []

  /* Payment session ids of everything on the page, matched to orders in one pass. */
  const sessionIds = [
    ...piList.map((p) => (typeof p.metadata?.session_id === "string" ? p.metadata.session_id : null)),
    ...refundList.map((r) => sessionOf(r.payment_intent)),
    ...disputeList.map((d) => sessionOf(d.payment_intent)),
  ].filter((id): id is string => Boolean(id))
  let links = new Map<string, SessionLink>()
  let ordersFailure: ReadFailure | null = null
  if (sessionIds.length > 0) {
    try {
      links = await readSessionLinks(scope, sessionIds)
    } catch (err) {
      ordersFailure = toFailure(err, secrets)
      errors.push(sectionError("orders", ordersFailure))
    }
  }

  const rows = buildRows({
    mode,
    now,
    paymentIntents: piList,
    refunds: refundList,
    disputes: disputeList,
    balance: balance.status === "fulfilled" ? balance.value : null,
    payouts: payouts.status === "fulfilled" ? payouts.value.data : [],
    orders: lookupOf(links),
  })
  const complete = pis.status === "fulfilled" ? pis.value.complete : true
  const oldest = rows.payments.length > 0 ? Date.parse(rows.payments[rows.payments.length - 1].created) : null
  return {
    mode,
    fetchedAt: now.toISOString(),
    ...rows,
    coveredFrom: complete ? null : oldest,
    errors,
    paymentsFailure,
    ordersFailure,
    keyFailure,
    demo: null,
  }
}

async function readDemo(scope: Scope, now: Date, origin: string | null): Promise<Snapshot> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const [orders, regions] = await Promise.all([readDemoOrders(scope, DEMO_ORDERS).catch(() => []), readDemoRegions(scope).catch(() => [])])
  const data = buildDemoData({
    orders,
    now,
    providerId: o.providerId,
    webhookUrl: expectedWebhookUrl(o.backendUrl ?? origin, o.providerId),
    storefrontDomains: storefrontDomains(scope, o.storefrontDomains).domains,
    regions,
  })
  const rows = buildRows({
    mode: "demo",
    now,
    paymentIntents: data.paymentIntents,
    refunds: data.refunds,
    disputes: data.disputes,
    balance: data.balance,
    payouts: data.payouts,
    orders: {
      orderOf: (id) => (id ? (data.sessions.get(id)?.order ?? null) : null),
      cartOf: (id) => (id ? (data.sessions.get(id)?.cartId ?? null) : null),
    },
  })
  return { mode: "demo", fetchedAt: now.toISOString(), ...rows, coveredFrom: null, errors: [], paymentsFailure: null, ordersFailure: null, keyFailure: null, demo: data }
}

export interface SnapshotHit {
  snapshot: Snapshot
  fresh: boolean
  at: number
}

/**
 * The snapshot of the current mode, from the cache while it is fresh. One
 * read at a time; a forced refresh within 30 seconds of the last read is
 * served from the cache. A read that failed for the key is kept for a minute.
 */
export async function loadSnapshot(scope: Scope, args: { force?: boolean; origin?: string | null; now?: () => Date } = {}): Promise<SnapshotHit> {
  const svc = stripeService(scope)
  const o = svc.getOptions()
  const now = args.now ?? (() => new Date())
  const demo = svc.isDemo()
  /* The demo's sample webhook points at this backend, so its snapshot is kept per address. */
  const key = demo ? `snapshot:demo:${o.backendUrl ?? args.origin ?? ""}` : `snapshot:${svc.keyInfo().mode ?? "none"}`
  const hit = await cacheFor(svc).get<Snapshot>(key, () => (demo ? readDemo(scope, now(), args.origin ?? null) : readLive(scope, now())), {
    ttlMs: o.cacheSeconds * 1000,
    force: args.force,
    forceMinMs: FORCE_REFRESH_MIN_MS,
    errorTtlMs: ERROR_CACHE_MS,
    isFailure: (s) => s.paymentsFailure !== null,
  })
  return { snapshot: hit.value, fresh: hit.fresh, at: hit.at }
}
