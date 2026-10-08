import type { MedusaContainer } from "@medusajs/framework/types"
import { LOYALTY_MODULE, isKind, type TxKind } from "./constants"
import type { AccountDto, TxDto } from "./contract"
import type { ResolvedLoyaltyOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes, subscriber and scripts
 * use it from outside the service (through the container). Kept structural
 * so the code never imports the concrete service class and the service stays
 * thin.
 */
export interface LoyaltyServiceLike {
  getOptions(): ResolvedLoyaltyOptions
  isDemo(): boolean

  listLoyaltyAccounts(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountLoyaltyAccounts(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  createLoyaltyAccounts(data: unknown | unknown[]): Promise<Row[]>
  updateLoyaltyAccounts(data: unknown | unknown[]): Promise<Row[]>

  listLoyaltyTransactions(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createLoyaltyTransactions(data: unknown | unknown[]): Promise<Row[]>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function loyaltySvc(scope: MedusaContainer): LoyaltyServiceLike {
  return scope.resolve(LOYALTY_MODULE) as LoyaltyServiceLike
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

function metaOf(row: Row): Record<string, unknown> {
  const m = row.metadata
  if (m && typeof m === "object" && !Array.isArray(m)) return m as Record<string, unknown>
  if (typeof m === "string") {
    try {
      const parsed = JSON.parse(m) as unknown
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }
  return {}
}

export function toAccount(row: Row): AccountDto {
  const meta = metaOf(row)
  const redeemed = Array.isArray(meta.redeemed) ? (meta.redeemed as Array<{ name?: unknown; pts?: unknown }>).filter((r) => typeof r?.name === "string" && typeof r?.pts === "number").map((r) => ({ name: r.name as string, pts: r.pts as number })) : []
  return {
    id: row.id,
    customer_id: str(row.customer_id) ?? "",
    customer_email: str(row.customer_email),
    customer_name: str(row.customer_name),
    balance: Math.max(0, num(row.balance)),
    total_earned: num(row.total_earned),
    total_redeemed: num(row.total_redeemed),
    tier_multiplier: num(row.tier_multiplier) || 1,
    total_saved: num(meta.total_saved_pln),
    redeemed,
    demo: row.demo === true,
  }
}

export function toTx(row: Row): TxDto {
  return {
    id: row.id,
    account_id: str(row.account_id) ?? "",
    delta: num(row.delta),
    kind: isKind(row.kind) ? (row.kind as TxKind) : "earn_order",
    reason: str(row.reason),
    order_id: str(row.order_id),
    created_at: toIso(row.created_at),
  }
}
