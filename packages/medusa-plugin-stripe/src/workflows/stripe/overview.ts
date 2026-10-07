/**
 * THE PANEL: periods, methods, payments, disputes, refunds, balance and
 * payouts, cut from the snapshot at request time.
 */
import { FIRST_PAGE, PERIODS, RECENT_REFUNDS } from "../../modules/stripe/lib/constants"
import type { MethodKey, PaymentFilter, PaymentRowDto, StripeMode, StripeOverviewResponse, StripePaymentsResponse } from "../../modules/stripe/lib/contract"
import { periodStats } from "../../modules/stripe/lib/aggregate"
import { attemptFailed } from "../../modules/stripe/lib/normalize"
import { splitPayouts } from "../../modules/stripe/lib/normalize"
import { dashboardFor, type Snapshot } from "./snapshot"

export function overviewOf(snapshot: Snapshot, args: { now: Date; cacheSeconds: number; fresh: boolean; configured: boolean }): StripeOverviewResponse {
  const periods = PERIODS.map((days) =>
    periodStats({ days, now: args.now, payments: snapshot.payments, refunds: snapshot.refunds, disputes: snapshot.disputes, coveredFrom: snapshot.coveredFrom }),
  )
  const closedSince = args.now.getTime() - 30 * 24 * 60 * 60 * 1000
  const closed = snapshot.disputes.filter((d) => !d.open && Date.parse(d.created) >= closedSince)
  const mode: StripeMode = snapshot.mode
  return {
    mode,
    configured: args.configured,
    fetchedAt: snapshot.paymentsFailure && snapshot.payments.length === 0 && !snapshot.balance ? null : snapshot.fetchedAt,
    cacheSeconds: args.cacheSeconds,
    fresh: args.fresh,
    periods,
    payments: snapshot.payments.slice(0, FIRST_PAGE),
    paymentsTotal: snapshot.payments.length,
    disputes: snapshot.disputes.filter((d) => d.open),
    disputesClosed: { won: closed.filter((d) => d.status === "won").length, lost: closed.filter((d) => d.status === "lost").length },
    refunds: snapshot.refunds.slice(0, RECENT_REFUNDS),
    balance: snapshot.balance,
    payouts: splitPayouts(snapshot.payouts),
    errors: snapshot.errors,
    dashboardUrl: dashboardFor(snapshot.mode).base,
  }
}

/** An overview with nothing read: no key yet, so the page shows the setup. */
export function emptyOverview(args: { cacheSeconds: number; mode: StripeMode }): StripeOverviewResponse {
  const now = new Date()
  return {
    mode: args.mode,
    configured: false,
    fetchedAt: null,
    cacheSeconds: args.cacheSeconds,
    fresh: false,
    periods: PERIODS.map((days) => periodStats({ days, now, payments: [], refunds: [], disputes: [] })),
    payments: [],
    paymentsTotal: 0,
    disputes: [],
    disputesClosed: { won: 0, lost: 0 },
    refunds: [],
    balance: null,
    payouts: { upcoming: [], past: [] },
    errors: [],
    dashboardUrl: dashboardFor("live").base,
  }
}

export const PAYMENT_FILTERS: readonly PaymentFilter[] = ["all", "succeeded", "failed", "attention", "refunded", "disputed", "outside"]

export function matchesFilter(p: PaymentRowDto, filter: PaymentFilter): boolean {
  switch (filter) {
    case "succeeded":
      return p.status === "succeeded"
    case "failed":
      return attemptFailed(p)
    case "attention":
      return attemptFailed(p) || p.status === "requires_action" || p.status === "authorized" || (p.status === "succeeded" && p.fromMedusa && !p.order)
    case "refunded":
      return p.refunded !== null
    case "disputed":
      return p.disputed
    case "outside":
      return !p.fromMedusa
    default:
      return true
  }
}

/** Matches a payment id, a card's last four digits, a Przelewy24 reference, or an order number (#1042 or 1042). */
export function matchesSearch(p: PaymentRowDto, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  if (p.id.toLowerCase().includes(s)) return true
  const order = s.replace(/^#/, "")
  if (/^\d+$/.test(order) && p.order?.displayId !== null && p.order?.displayId !== undefined && String(p.order.displayId) === order) return true
  if (p.order?.id.toLowerCase() === s) return true
  if (p.detail?.last4 && p.detail.last4 === s) return true
  if (p.detail?.reference && p.detail.reference.toLowerCase().includes(s)) return true
  return false
}

export function paymentsPage(snapshot: Snapshot, args: { filter: PaymentFilter; method: MethodKey | "all"; q: string; offset: number; limit: number }): StripePaymentsResponse {
  /* A checkout that never got as far as a method is listed under all methods only, not as "Other". */
  const byMethod = (p: PaymentRowDto) => args.method === "all" || p.method === args.method
  const searched = snapshot.payments.filter((p) => matchesSearch(p, args.q))
  const rows = searched.filter((p) => byMethod(p) && matchesFilter(p, args.filter))
  const counts = Object.fromEntries(PAYMENT_FILTERS.map((f) => [f, searched.filter((p) => byMethod(p) && matchesFilter(p, f)).length])) as Record<PaymentFilter, number>
  const methods: Partial<Record<MethodKey, number>> = {}
  for (const p of searched.filter((x) => matchesFilter(x, args.filter))) {
    if (p.method) methods[p.method] = (methods[p.method] ?? 0) + 1
  }
  return {
    payments: rows.slice(args.offset, args.offset + args.limit),
    count: rows.length,
    offset: args.offset,
    limit: args.limit,
    fetchedAt: snapshot.fetchedAt,
    counts,
    methods,
  }
}
