import type { CreditOrderState, LimitStatus } from "./constants"

/** The credit terms of one customer. */
export interface LimitDto {
  id: string
  customer_id: string
  customer_email: string | null
  customer_name: string | null
  currency_code: string
  /** In the store's price units (major units in the demo). */
  limit_amount: number
  used_amount: number
  remaining_amount: number
  net_days: number
  status: LimitStatus
  blocked: boolean
  exhausted: boolean
  demo: boolean
  updated_at: string
  /** Store mode: what is overdue on the account, and its oldest overdue order in days. */
  overdue_amount?: number
  oldest_overdue_days?: number
  open_orders?: number
  /** Store mode: no limit set on the account (only terms). */
  no_limit?: boolean
  company?: string | null
  note?: string | null
}

/** One order on the customer's account, with its due date. */
export interface CreditOrderDto {
  id: string
  order_id: string
  display_id: number | null
  customer_id: string
  currency_code: string
  total_amount: number
  net_days: number
  due_at: string
  paid_at: string | null
  state: CreditOrderState
  demo: boolean
  /** Store mode: what is still unpaid, days past due, the document the term runs from. */
  unpaid_amount?: number
  overdue_days?: number
  document?: string | null
  payment_label?: string | null
  reminded_at?: string | null
  placed_by?: string | null
  /** Store mode: no due date yet (for example no invoice), counted in the limit. */
  no_due_date?: boolean
  /** Store mode: the payment reminders sent, the next one and why there are none. */
  reminders?: Array<{ at: string; stage: string; ok: boolean; manual?: boolean; overdue?: boolean }>
  next_reminder?: { at: string | null; stage: string } | null
  reminders_note?: string | null
}

/** GET /admin/credit/orders/:id/reminder: the reminder before it is sent. */
export interface ReminderPreviewResponse {
  to: string
  subject: string
  html: string
  stage: string
  warning: string | null
}

/** The whole status the Credit page renders in one call. */
export interface StatusResponse {
  demo: boolean
  enforce: boolean
  /** "own": the plugin keeps the credit; "store": the page over the credit the store keeps. */
  mode?: "own" | "store"
  capabilities?: { block: boolean; pause: boolean }
  netDayChoices?: number[]
  maxNetDays?: number
  ruleText?: string | null
  markPaidPath?: string | null
  /** Store mode: payment reminders can be sent from the page, and where the e-mail log of an order is. */
  reminders?: { send: boolean; emailsLogPath: string | null }
  counts: {
    limits: number
    blocked: number
    exhausted: number
    overdue: number
    used_total: number
    /** Store mode: the overdue amount of all accounts. */
    overdue_total?: number
  }
  limits: LimitDto[]
  orders: CreditOrderDto[]
}
