/**
 * Constants of the Loyalty module. ZERO IMPORTS on purpose: this file is
 * shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const LOYALTY_MODULE = "loyalty"

/* TABLE NAMES, kept from the original app module so the data carries over. */
export const ACCOUNT_TABLE = "loyalty_account"
export const TRANSACTION_TABLE = "loyalty_transaction"

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export const KINDS = ["earn_order", "redeem", "bonus", "adjust", "expire"] as const
export type TxKind = (typeof KINDS)[number]

export function isKind(value: unknown): value is TxKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const REASON_MAX = 300
export const LIST_MAX = 500
