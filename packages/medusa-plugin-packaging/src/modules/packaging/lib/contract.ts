import type { UnitName } from "./constants"

/** The packaging of one product: the MOQ, the order step and the ladder. */
export interface ProductDto {
  id: string
  product_id: string
  sku: string | null
  title: string | null
  /** Minimum order quantity in pieces; 0 means no minimum. */
  moq: number
  /** The order step in pieces; 0 means any quantity. */
  step: number
  units: UnitDto[]
  demo: boolean
}

/** One rung of the ladder: how many pieces fit into the unit. */
export interface UnitDto {
  id: string
  product_id: string
  name: UnitName
  pieces: number
  ean: string | null
  sscc_prefix: string | null
}

/** The whole status the Packaging page renders in one call. */
export interface StatusResponse {
  demo: boolean
  gs1Prefix: string
  counts: {
    products: number
    with_moq: number
    with_sscc: number
    units: number
  }
  products: ProductDto[]
}
