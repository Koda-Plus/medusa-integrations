import type { MedusaContainer } from "@medusajs/framework/types"
import { WHITELIST_MODULE, isState, type CheckSource, type CheckState } from "./constants"
import type { CheckDto, EntityDto } from "./contract"
import type { ResolvedWhitelistOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes and scripts use it from
 * outside the service (through the container). Kept structural so the code
 * never imports the concrete service class and the service stays thin.
 */
export interface WhitelistServiceLike {
  getOptions(): ResolvedWhitelistOptions
  isDemo(): boolean

  listWhitelistEntities(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountWhitelistEntities(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  retrieveWhitelistEntity(id: string, config?: Record<string, unknown>): Promise<Row>
  createWhitelistEntities(data: unknown | unknown[]): Promise<Row[]>
  updateWhitelistEntities(data: unknown | unknown[]): Promise<Row[]>

  listWhitelistChecks(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createWhitelistChecks(data: unknown | unknown[]): Promise<Row[]>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function whitelistSvc(scope: MedusaContainer): WhitelistServiceLike {
  return scope.resolve(WHITELIST_MODULE) as WhitelistServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

function stateOf(v: unknown): CheckState {
  return isState(v) ? v : "unavailable"
}

function sourceOf(v: unknown): CheckSource {
  return v === "vies" ? "vies" : "whitelist"
}

export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string") return v
  return new Date().toISOString()
}

export function toEntity(row: Row, staleHours: number): EntityDto {
  const checkedAt = toIso(row.checked_at)
  const stale = new Date(checkedAt).getTime() + staleHours * 60 * 60 * 1000 < Date.now()
  return {
    id: row.id,
    nip: str(row.nip) ?? "",
    country_code: str(row.country_code) ?? "PL",
    source: sourceOf(row.source),
    state: stateOf(row.state),
    status_vat: str(row.status_vat),
    name: str(row.name),
    address: str(row.address),
    bank_accounts: Array.isArray(row.bank_accounts) ? row.bank_accounts.filter((a): a is string => typeof a === "string").slice(0, 5) : [],
    customer_id: str(row.customer_id),
    checked_at: checkedAt,
    stale,
    demo: row.demo === true,
  }
}

export function toCheck(row: Row): CheckDto {
  return {
    id: row.id,
    entity_id: str(row.entity_id),
    nip: str(row.nip) ?? "",
    country_code: str(row.country_code) ?? "PL",
    source: sourceOf(row.source),
    state: stateOf(row.state),
    status_vat: str(row.status_vat),
    name: str(row.name),
    bank_accounts: Array.isArray(row.bank_accounts) ? row.bank_accounts.filter((a): a is string => typeof a === "string").slice(0, 5) : [],
    requested_by: str(row.requested_by) ?? "",
    customer_id: str(row.customer_id),
    demo: row.demo === true,
    created_at: toIso(row.created_at),
  }
}
