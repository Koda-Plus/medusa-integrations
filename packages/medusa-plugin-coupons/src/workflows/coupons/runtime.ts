/**
 * Shared plumbing of the coupon reads and writes: the module service, Query,
 * the database handle and the modules of Medusa the plugin talks to. All of
 * it from the outside: the service stays thin.
 */
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type KodaCouponsModuleService from "../../modules/coupons/service"
import { COUPONS_MODULE } from "../../modules/coupons/lib/constants"

export type Scope = MedusaContainer | { resolve<T = unknown>(key: string, options?: { allowUnregistered?: boolean }): T }

function resolve<T>(scope: Scope, key: string): T {
  return (scope as { resolve<R>(k: string): R }).resolve<T>(key)
}

export function resolveOptional<T>(scope: Scope, key: string): T | null {
  try {
    return ((scope as { resolve<R>(k: string, o?: { allowUnregistered?: boolean }): R }).resolve<T>(key, { allowUnregistered: true }) ?? null) as T | null
  } catch {
    return null
  }
}

export function couponsService(scope: Scope): KodaCouponsModuleService {
  return resolve<KodaCouponsModuleService>(scope, COUPONS_MODULE)
}

export interface QueryLike {
  graph(args: Record<string, unknown>): Promise<{ data: unknown[] }>
}

export function queryOf(scope: Scope): QueryLike {
  return resolve<QueryLike>(scope, ContainerRegistrationKeys.QUERY)
}

export interface SqlLike {
  raw(sql: string, bindings?: readonly unknown[]): Promise<{ rows?: any[] }>
}

export function sqlOf(scope: Scope): SqlLike {
  return resolve<SqlLike>(scope, ContainerRegistrationKeys.PG_CONNECTION)
}

export interface PromotionModuleLike {
  listPromotions(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string; code?: string | null; metadata?: Record<string, unknown> | null }>>
  updatePromotions(data: Record<string, unknown>): Promise<unknown>
}

export function promotionModule(scope: Scope): PromotionModuleLike {
  return resolve<PromotionModuleLike>(scope, Modules.PROMOTION)
}

export interface CustomerModuleLike {
  listCustomers(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Array<{ id: string; email?: string | null; first_name?: string | null; last_name?: string | null; company_name?: string | null }>>
}

export function customerModule(scope: Scope): CustomerModuleLike {
  return resolve<CustomerModuleLike>(scope, Modules.CUSTOMER)
}

export const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null)
export const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
