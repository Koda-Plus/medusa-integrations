/**
 * STORE MODE: the store already keeps trade credit (limits, terms, its own
 * rule of what is owed and when) and the plugin becomes the page over it.
 * With `store` in the options the plugin keeps no limits and records no
 * orders of its own: the credit page, the integration lines and
 * /store/credit/me read the store's accounts and orders through these
 * functions, and a change made on the page is written back through `update`.
 * The plugin's own subscriber and daily job do nothing in this mode, and the
 * plugin never gates a checkout (the store's own gate stays the only one).
 */

export interface StoreCreditAccount {
  customer_id: string
  email: string | null
  name: string | null
  company?: string | null
  /** null: no limit set. */
  limit_amount: number | null
  net_days: number
  used_amount: number
  overdue_amount: number
  oldest_overdue_days: number
  open_orders: number
  blocked?: boolean
  paused?: boolean
  /** A short line from the store (for example who placed orders for a salon). */
  note?: string | null
}

export interface StoreCreditOrder {
  order_id: string
  display_id: number | null
  customer_id: string
  total_amount: number
  unpaid_amount: number
  /** The due date (YYYY-MM-DD); null while the store has no due date yet (no invoice). */
  due_at: string | null
  overdue_days: number
  /** The document the term runs from (an invoice number), when there is one. */
  document?: string | null
  /** How it is paid, in the store's words ("termin", "pobranie"). */
  payment_label?: string | null
  /** The last payment reminder the store sent, when it sends them. */
  reminded_at?: string | null
  /** Placed for this account by someone else (an account manager for a salon). */
  placed_by?: string | null
}

export interface StoreCreditPatch {
  limit_amount?: number | null
  net_days?: number
  blocked?: boolean
  paused?: boolean
}

export interface CreditStoreAdapter {
  /** All accounts with credit terms (and any account the store counts debt on). */
  accounts(scope: unknown): Promise<StoreCreditAccount[]>
  /** Open orders on credit, for the given accounts or all of them. */
  orders(scope: unknown, customerIds?: string[]): Promise<StoreCreditOrder[]>
  /** Write a change made on the page (the store validates and clamps it). */
  update(scope: unknown, customerId: string, patch: StoreCreditPatch, actor: { id: string | null }): Promise<void>
  /** What the store supports; the page hides what it does not. */
  capabilities?: { block?: boolean; pause?: boolean }
  /** The terms offered on the page, in days (default the plugin's 0/14/30/60). */
  netDayChoices?: number[]
  /** The longest term the store accepts. */
  maxNetDays?: number
  /** The store's own words on the page: how its rule works (one or two sentences). */
  ruleText?: string
  /** Where an order is marked paid in this store (an admin path with :id), for a link on the page. */
  markPaidPath?: string
}

export function isStoreAdapter(v: unknown): v is CreditStoreAdapter {
  const a = v as CreditStoreAdapter
  return Boolean(a && typeof a === "object" && typeof a.accounts === "function" && typeof a.orders === "function" && typeof a.update === "function")
}
