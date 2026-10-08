import type { MedusaContainer } from "@medusajs/framework/types"
import { PACKAGING_MODULE, isUnitName, type UnitName } from "./constants"
import type { ProductDto, UnitDto } from "./contract"
import type { ResolvedPackagingOptions } from "./options"

/**
 * The generated CRUD of the module, as the routes and scripts use it from
 * outside the service (through the container). Kept structural so the code
 * never imports the concrete service class and the service stays thin.
 */
export interface PackagingServiceLike {
  getOptions(): ResolvedPackagingOptions
  isDemo(): boolean

  listPackagingProducts(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createPackagingProducts(data: unknown | unknown[]): Promise<Row[]>
  updatePackagingProducts(data: unknown | unknown[]): Promise<Row[]>

  listPackagingUnits(filters?: Record<string, unknown>, config?: Record<string, unknown>): Promise<Row[]>
  createPackagingUnits(data: unknown | unknown[]): Promise<Row[]>
  updatePackagingUnits(data: unknown | unknown[]): Promise<Row[]>
  deletePackagingUnits(ids: string | string[]): Promise<void>
}

export type Row = Record<string, unknown> & {
  id: string
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export function packagingSvc(scope: MedusaContainer): PackagingServiceLike {
  return scope.resolve(PACKAGING_MODULE) as PackagingServiceLike
}

export function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}

export function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

export function toUnit(row: Row): UnitDto {
  return {
    id: row.id,
    product_id: str(row.product_id) ?? "",
    name: isUnitName(row.name) ? (row.name as UnitName) : "szt.",
    pieces: num(row.pieces),
    ean: str(row.ean),
    sscc_prefix: str(row.sscc_prefix),
  }
}

export function toProduct(row: Row, units: UnitDto[]): ProductDto {
  return {
    id: row.id,
    product_id: str(row.product_id) ?? "",
    sku: str(row.sku),
    title: str(row.title),
    moq: num(row.moq),
    step: num(row.step),
    units,
    demo: row.demo === true,
  }
}
