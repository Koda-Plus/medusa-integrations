/**
 * THE PANEL'S NUMBERS FOR 7 AND 30 DAYS. No runtime imports beyond the pure helpers.
 *
 * One read covers 30 days of PaymentIntents (by creation date); both periods
 * are cut from it at request time, so "7 days" always ends now.
 *
 *   volume       what customers paid (`amount_received` of succeeded payments), per currency
 *   fees, net    from each charge's balance transaction, in the settlement currency
 *   success      succeeded / (succeeded + declined); abandoned checkouts are not attempts
 *   refunds      refunds created in the period, except failed and canceled ones
 *
 * Every sum is an integer sum per currency (MoneyBag). A payment whose fee
 * Stripe has not settled yet counts in the volume and in `feesPending`.
 */
import { METHOD_KEYS } from "./constants"
import type { DisputeRowDto, MethodKey, MethodStatsDto, MoneyDto, PaymentRowDto, PeriodStatsDto, RefundRowDto } from "./contract"
import { MoneyBag } from "./money"
import { attemptFailed } from "./normalize"

const DAY_MS = 24 * 60 * 60 * 1000

interface MethodAcc {
  count: number
  failed: number
  volume: MoneyBag
  fees: MoneyBag
  net: MoneyBag
}

const newAcc = (): MethodAcc => ({ count: 0, failed: 0, volume: new MoneyBag(), fees: new MoneyBag(), net: new MoneyBag() })

/** A per-currency list in the given currency order; a currency not in it goes last, by code. */
export function ordered(list: readonly MoneyDto[], order: readonly string[]): MoneyDto[] {
  const rank = (currency: string) => {
    const i = order.indexOf(currency)
    return i === -1 ? order.length : i
  }
  return [...list].sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
}

export function rate(succeeded: number, failed: number): number | null {
  const attempts = succeeded + failed
  return attempts > 0 ? succeeded / attempts : null
}

export interface PeriodInput {
  days: number
  now: Date
  payments: readonly PaymentRowDto[]
  refunds: readonly RefundRowDto[]
  disputes: readonly DisputeRowDto[]
  /** When the payment read stopped early: the oldest payment it reached (ms). */
  coveredFrom?: number | null
}

export function periodStats(input: PeriodInput): PeriodStatsDto {
  const fromMs = input.now.getTime() - input.days * DAY_MS
  const inPeriod = (iso: string) => {
    const t = Date.parse(iso)
    return Number.isFinite(t) && t >= fromMs && t <= input.now.getTime() + 60_000
  }

  const total = newAcc()
  const byMethod = new Map<MethodKey, MethodAcc>()
  const acc = (m: MethodKey): MethodAcc => {
    let a = byMethod.get(m)
    if (!a) {
      a = newAcc()
      byMethod.set(m, a)
    }
    return a
  }
  let authorized = 0
  let processing = 0
  let incomplete = 0
  let feesPending = 0

  for (const p of input.payments) {
    if (!inPeriod(p.created)) continue
    const method: MethodKey = p.method ?? "other"
    if (p.status === "succeeded") {
      const received = p.received ?? p.amount
      for (const a of [total, acc(method)]) {
        a.count += 1
        a.volume.add(received)
        if (p.fee) a.fees.add(p.fee)
        if (p.net) a.net.add(p.net)
      }
      if (!p.fee || !p.net) feesPending += 1
    } else if (attemptFailed(p)) {
      total.failed += 1
      acc(method).failed += 1
    } else if (p.status === "authorized") authorized += 1
    else if (p.status === "processing" || p.status === "requires_action") processing += 1
    else incomplete += 1
  }

  const refunded = new MoneyBag()
  let refunds = 0
  for (const r of input.refunds) {
    if (!inPeriod(r.created) || r.status === "failed" || r.status === "canceled") continue
    refunds += 1
    refunded.add(r.amount)
  }

  /* One currency order for the whole period (that of the total volume), so every column reads the same way down. */
  const volume = total.volume.list()
  const order = volume.map((m) => m.currency)
  const inOrder = (bag: MoneyBag) => ordered(bag.list(), order)

  const methods: MethodStatsDto[] = [...byMethod.entries()]
    .filter(([, a]) => a.count + a.failed > 0)
    .map(([method, a]) => ({
      method,
      count: a.count,
      failed: a.failed,
      volume: inOrder(a.volume),
      fees: inOrder(a.fees),
      net: inOrder(a.net),
      successRate: rate(a.count, a.failed),
    }))
    .sort((x, y) => y.count - x.count || y.failed - x.failed || METHOD_KEYS.indexOf(x.method) - METHOD_KEYS.indexOf(y.method))

  return {
    days: input.days,
    from: new Date(fromMs).toISOString(),
    succeeded: total.count,
    failed: total.failed,
    authorized,
    processing,
    incomplete,
    successRate: rate(total.count, total.failed),
    volume,
    fees: inOrder(total.fees),
    net: inOrder(total.net),
    feesPending,
    refunded: inOrder(refunded),
    refunds,
    disputesOpened: input.disputes.filter((d) => inPeriod(d.created)).length,
    methods,
    partial: typeof input.coveredFrom === "number" && input.coveredFrom > fromMs,
  }
}

/** The share of a method in the succeeded payments of a period, 0 to 1. */
export function methodShare(period: Pick<PeriodStatsDto, "succeeded">, method: Pick<MethodStatsDto, "count">): number | null {
  return period.succeeded > 0 ? method.count / period.succeeded : null
}

/**
 * Stripe's fees as a share of the volume, when both are in one currency
 * (null otherwise: a ratio across currencies means nothing).
 */
export function effectiveFeeRate(period: Pick<PeriodStatsDto, "volume" | "fees">): number | null {
  if (period.volume.length !== 1 || period.fees.length !== 1) return null
  const [v] = period.volume
  const [f] = period.fees
  if (v.currency !== f.currency || v.amount <= 0) return null
  return f.amount / v.amount
}
