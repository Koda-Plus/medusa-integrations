import type { MedusaContainer } from "@medusajs/framework/types"
import { COMPLIANCE_MODULE, isOperatorKind, type OperatorKind } from "./constants"
import type { ConsentDto, DsrDto, ProductComplianceDto, ResponsiblePersonDto } from "./contract"
import type { ResolvedComplianceOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes and the seed scripts use it
 * from outside the service (through the container). Kept structural so the
 * code never imports the concrete service class and the service stays thin.
 */
export interface ComplianceServiceLike {
  getOptions(): ResolvedComplianceOptions
  isDemo(): boolean

  listComplianceOperators(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountComplianceOperators(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  retrieveComplianceOperator(id: string, config?: Record<string, unknown>): Promise<Row>
  createComplianceOperators(data: unknown | unknown[]): Promise<Row[]>
  updateComplianceOperators(data: unknown | unknown[]): Promise<Row[]>
  deleteComplianceOperators(ids: string | string[]): Promise<void>

  listComplianceProducts(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountComplianceProducts(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  createComplianceProducts(data: unknown | unknown[]): Promise<Row[]>
  updateComplianceProducts(data: unknown | unknown[]): Promise<Row[]>

  listComplianceConsents(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createComplianceConsents(data: unknown | unknown[]): Promise<Row[]>

  listComplianceDsrs(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  listAndCountComplianceDsrs(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<[Row[], number]>
  createComplianceDsrs(data: unknown | unknown[]): Promise<Row[]>
  updateComplianceDsrs(data: unknown | unknown[]): Promise<Row[]>

  listCompliancePriceSnapshots(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createCompliancePriceSnapshots(data: unknown | unknown[]): Promise<Row[]>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function complianceSvc(scope: MedusaContainer): ComplianceServiceLike {
  return scope.resolve(COMPLIANCE_MODULE) as ComplianceServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function toResponsiblePerson(row: Row): ResponsiblePersonDto {
  const kind = isOperatorKind(row.kind) ? (row.kind as OperatorKind) : ("responsible_person" as OperatorKind)
  return {
    id: row.id,
    kind,
    name: str(row.name) ?? "",
    address: str(row.address),
    email: str(row.email),
    country_code: str(row.country_code),
    demo: row.demo === true,
  }
}

/** The GPSR record is complete when it names the manufacturer and the responsible person. */
export function completeOf(product: Row): boolean {
  return Boolean(str(product.manufacturer_id) && str(product.responsible_person_id))
}

export function toProductCompliance(row: Row): ProductComplianceDto {
  const warnings = Array.isArray(row.warnings) ? row.warnings.filter((w): w is string => typeof w === "string").slice(0, 100) : []
  return {
    id: row.id,
    product_id: str(row.product_id) ?? "",
    sku: str(row.sku),
    title: str(row.title),
    manufacturer_id: str(row.manufacturer_id),
    responsible_person_id: str(row.responsible_person_id),
    warnings,
    safety_info: str(row.safety_info),
    complete: completeOf(row),
    demo: row.demo === true,
  }
}

export function toConsent(row: Row): ConsentDto {
  return {
    id: row.id,
    customer_id: str(row.customer_id),
    purpose: (str(row.purpose) ?? "necessary") as ConsentDto["purpose"],
    granted: row.granted === true,
    version: str(row.version),
    source: str(row.source) ?? "cookie_banner",
    demo: row.demo === true,
    created_at: toIso(row.created_at),
  }
}

export function toDsr(row: Row): DsrDto {
  return {
    id: row.id,
    customer_id: str(row.customer_id) ?? "",
    customer_email: str(row.customer_email),
    type: (str(row.type) ?? "access") as DsrDto["type"],
    status: (str(row.status) ?? "pending") as DsrDto["status"],
    note: str(row.note),
    demo: row.demo === true,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at ?? row.created_at),
  }
}

export function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "string") return v
  return new Date().toISOString()
}
