import type { CheckSource, CheckState } from "./constants"

/** A verified counterparty: the latest answer of the registry for one number. */
export interface EntityDto {
  id: string
  nip: string
  country_code: string
  source: CheckSource
  state: CheckState
  status_vat: string | null
  name: string | null
  address: string | null
  bank_accounts: string[]
  regon: string | null
  krs: string | null
  legal_form: string | null
  customer_id: string | null
  checked_at: string
  stale: boolean
  demo: boolean
}

/** One run of a check, kept as the audit trail. */
export interface CheckDto {
  id: string
  entity_id: string | null
  nip: string
  country_code: string
  source: CheckSource
  state: CheckState
  status_vat: string | null
  name: string | null
  bank_accounts: string[]
  regon: string | null
  krs: string | null
  legal_form: string | null
  requested_by: string
  customer_id: string | null
  demo: boolean
  created_at: string
}

/** The whole status the Whitelist page renders in one call. */
export interface StatusResponse {
  demo: boolean
  staleHours: number
  counts: {
    entities: number
    active: number
    exempt: number
    not_found: number
    checks: number
  }
  entities: EntityDto[]
  checks: CheckDto[]
}
