import type { ConsentPurpose, DsrStatus, DsrType, OperatorKind } from "./constants"

/** A manufacturer, importer or responsible person, shown and edited in the panel. */
export interface ResponsiblePersonDto {
  id: string
  kind: OperatorKind
  name: string
  address: string | null
  email: string | null
  country_code: string | null
  demo: boolean
}

/** The GPSR record of one product: who made it, who is responsible in the EU, what to warn about. */
export interface ProductComplianceDto {
  id: string
  product_id: string
  sku: string | null
  title: string | null
  manufacturer_id: string | null
  responsible_person_id: string | null
  warnings: string[]
  safety_info: string | null
  complete: boolean
  demo: boolean
}

/** A single consent decision, as recorded by the storefront or the account page. */
export interface ConsentDto {
  id: string
  customer_id: string | null
  purpose: ConsentPurpose
  granted: boolean
  version: string | null
  source: string
  demo: boolean
  created_at: string
}

/** A data subject request: a customer asks to access, erase or port their data. */
export interface DsrDto {
  id: string
  customer_id: string
  customer_email: string | null
  type: DsrType
  status: DsrStatus
  note: string | null
  demo: boolean
  created_at: string
  updated_at: string
}

/** One price snapshot of a variant, for the Omnibus "lowest price of the last 30 days". */
export interface PriceSnapshotDto {
  sku: string
  variant_id: string
  currency_code: string
  /** The amount in the store's price units (the same units as `price.amount`). */
  amount: number
  captured_at: string
}

export interface ProductPriceDto {
  sku: string
  product_id: string
  title: string | null
  currency_code: string
  /** Current catalog price, minor units; null when the variant has no price. */
  amount: number | null
  /** Lowest price of the last 30 days (snapshots plus the current price), minor units. */
  lowest_30d: number | null
  snapshots: number
}

/** The whole status the compliance page renders in one call. */
export interface StatusResponse {
  demo: boolean
  sections: { gpsr: boolean; rodo: boolean; omnibus: boolean }
  counts: {
    responsible_persons: number
    products_total: number
    products_complete: number
    dsr_open: number
    consent_total: number
    snapshots: number
  }
  responsible_persons: ResponsiblePersonDto[]
  products: ProductComplianceDto[]
  dsr: DsrDto[]
  consent: { purpose: ConsentPurpose; granted: number; declined: number }[]
  prices: ProductPriceDto[]
}
