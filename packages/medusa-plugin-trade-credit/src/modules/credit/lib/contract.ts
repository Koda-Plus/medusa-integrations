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
}

/** The whole status the Credit page renders in one call. */
export interface StatusResponse {
  demo: boolean
  enforce: boolean
  counts: {
    limits: number
    blocked: number
    exhausted: number
    overdue: number
    used_total: number
  }
  limits: LimitDto[]
  orders: CreditOrderDto[]
}
