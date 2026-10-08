import type { MedusaContainer } from "@medusajs/framework/types"
import { CREDIT_MODULE, isOrderState, type CreditOrderState, type LimitStatus } from "./constants"
import type { CreditOrderDto, LimitDto } from "./contract"
import { limitView } from "./credit"
import type { ResolvedCreditOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes, jobs and subscribers use
 * it from outside the service (through the container). Kept structural so the
 * code never imports the concrete service class and the service stays thin.
 */
export interface CreditServiceLike {
  getOptions(): ResolvedCreditOptions
  isDemo(): boolean

  listCreditLimits(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountCreditLimits(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  retrieveCreditLimit(id: string, config?: Record<string, unknown>): Promise<Row>
  createCreditLimits(data: unknown | unknown[]): Promise<Row[]>
  updateCreditLimits(data: unknown | unknown[]): Promise<Row[]>

  listCreditOrders(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createCreditOrders(data: unknown | unknown[]): Promise<Row[]>
  updateCreditOrders(data: unknown | unknown[]): Promise<Row[]>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function creditSvc(scope: MedusaContainer): CreditServiceLike {
  return scope.resolve(CREDIT_MODULE) as CreditServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string") return v
  return new Date().toISOString()
}

function statusOf(v: unknown): LimitStatus {
  return v === "paused" ? "paused" : "active"
}

export function toLimit(row: Row): LimitDto {
  const view = limitView({
    limit_amount: num(row.limit_amount),
    used_amount: num(row.used_amount),
    net_days: num(row.net_days),
    status: statusOf(row.status),
    blocked: row.blocked === true,
  })
  return {
    id: row.id,
    customer_id: str(row.customer_id) ?? "",
    customer_email: str(row.customer_email),
    customer_name: str(row.customer_name),
    currency_code: str(row.currency_code) ?? "pln",
    limit_amount: view.limit_amount,
    used_amount: view.used_amount,
    remaining_amount: view.remaining_amount,
    net_days: view.net_days,
    status: view.status,
    blocked: view.blocked,
    exhausted: view.exhausted,
    demo: row.demo === true,
    updated_at: toIso(row.updated_at ?? row.created_at),
  }
}

export function toCreditOrder(row: Row): CreditOrderDto {
  return {
    id: row.id,
    order_id: str(row.order_id) ?? "",
    display_id: typeof row.display_id === "number" ? row.display_id : null,
    customer_id: str(row.customer_id) ?? "",
    currency_code: str(row.currency_code) ?? "pln",
    total_amount: num(row.total_amount),
    net_days: num(row.net_days),
    due_at: toIso(row.due_at),
    paid_at: row.paid_at ? toIso(row.paid_at) : null,
    state: isOrderState(row.state) ? (row.state as CreditOrderState) : "open",
    demo: row.demo === true,
  }
}
