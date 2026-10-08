/**
 * Constants of the Trade Credit module. ZERO IMPORTS on purpose: this file
 * is shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const CREDIT_MODULE = "credit"

/* TABLE NAMES, namespaced. */
export const LIMIT_TABLE = "credit_limit"
export const ORDER_TABLE = "credit_order"

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const ID_PREFIX = {
  limit: "crl",
  order: "cro",
} as const

/* ------------------------------------------------------------------ */
/* Limits and orders                                                   */
/* ------------------------------------------------------------------ */

/** The payment terms: net days, 0 means immediate payment. */
export const NET_DAYS = [0, 14, 30, 60] as const
export type NetDays = (typeof NET_DAYS)[number]

export const LIMIT_STATUSES = ["active", "paused"] as const
export type LimitStatus = (typeof LIMIT_STATUSES)[number]

/** The state of one credit order, kept by the overdue job and the payment events. */
export const ORDER_STATES = ["open", "overdue", "paid"] as const
export type CreditOrderState = (typeof ORDER_STATES)[number]

export function isOrderState(value: unknown): value is CreditOrderState {
  return typeof value === "string" && (ORDER_STATES as readonly string[]).includes(value)
}

/**
 * Medusa payment statuses that still owe money: an order with any of these
 * counts into the customer's used amount.
 */
export const OPEN_PAYMENT_STATUSES = ["not_paid", "awaiting", "requires_action", "partially_captured"] as const

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const AMOUNT_MIN = 0
export const AMOUNT_MAX = 10_000_000
export const LIST_MAX = 500
