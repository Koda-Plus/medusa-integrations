import { NET_DAYS, type LimitStatus } from "./constants"

/**
 * The pure parts of trade credit: the due date of a payment term, the
 * remaining credit and the state of a limit. Testable without a database.
 */

/** The due day of an order placed today with `netDays` terms (0: due today). */
export function dueAt(created: Date, netDays: number): Date {
  const d = new Date(created.getTime())
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.floor(netDays)))
  d.setUTCHours(23, 59, 59, 999)
  return d
}

/** The remaining credit of a limit, never below zero. */
export function remaining(limitAmount: number, usedAmount: number): number {
  return Math.max(0, limitAmount - usedAmount)
}

/** The state of a limit: how much is left, whether it is blocked. */
export interface LimitView {
  limit_amount: number
  used_amount: number
  remaining_amount: number
  net_days: number
  status: LimitStatus
  blocked: boolean
  /** True when the used amount reaches the limit. */
  exhausted: boolean
}

export function limitView(limit: { limit_amount: number; used_amount: number; net_days: number; status: LimitStatus; blocked: boolean }): LimitView {
  const rem = remaining(limit.limit_amount, limit.used_amount)
  return {
    limit_amount: limit.limit_amount,
    used_amount: limit.used_amount,
    remaining_amount: rem,
    net_days: limit.net_days,
    status: limit.status,
    blocked: limit.blocked,
    exhausted: rem <= 0 && limit.limit_amount > 0,
  }
}

/** A net days value from anything the options or a form send; 0 is "immediate". */
export function normalizeNetDays(value: unknown): number {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value)
  if (!Number.isFinite(n)) return 0
  const clamped = Math.min(365, Math.max(0, Math.floor(n)))
  return clamped
}

export const DEFAULT_NET_DAYS = NET_DAYS[2]

/** Why the checkout stops a cart (option `enforce`): blocked, paused, or the order would pass the limit. */
export type CreditHold = { reason: "blocked" | "paused" | "over_limit"; remaining_amount: number; order_amount: number }

/**
 * The credit hold of a cart for a customer with credit terms: blocked or
 * paused terms stop every order, an active limit above zero stops an order
 * that would take the used amount over it. A limit of 0 means no ceiling.
 * Null: the cart may be completed.
 */
export function creditHold(limit: { limit_amount: number; used_amount: number; status: LimitStatus; blocked: boolean }, orderAmount: number): CreditHold | null {
  const order = Number.isFinite(orderAmount) ? Math.max(0, orderAmount) : 0
  const rem = remaining(limit.limit_amount, limit.used_amount)
  if (limit.blocked) return { reason: "blocked", remaining_amount: rem, order_amount: order }
  if (limit.status === "paused") return { reason: "paused", remaining_amount: rem, order_amount: order }
  if (limit.limit_amount > 0 && limit.used_amount + order > limit.limit_amount + 0.005) return { reason: "over_limit", remaining_amount: rem, order_amount: order }
  return null
}
