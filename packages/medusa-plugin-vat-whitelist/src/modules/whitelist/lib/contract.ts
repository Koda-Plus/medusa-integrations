import type { CheckSource, CheckState } from "./constants"

/** The business state in GUS: running, suspended, or ended. */
export type Activity = "active" | "suspended" | "closed"

/** What one registry said in the latest check of a counterparty. */
export interface RegistryAnswerDto {
  source: CheckSource
  state: CheckState
  /** Why the registry did not answer (timeout, missing_key...), when it did not. */
  reason: string | null
}

/** A verified counterparty: the latest registry answer for one number. */
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
  /** GUS: whether the business runs. Null when GUS was not asked. */
  activity: Activity | null
  /** GUS: the start of the business (YYYY-MM-DD). */
  started_at: string | null
  /** The registries of the latest check and what each said. */
  registries: RegistryAnswerDto[]
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
  activity: Activity | null
  reason: string | null
  requested_by: string
  customer_id: string | null
  demo: boolean
  created_at: string
}

/** How a registry answers with the options in use. */
export type RegistryModeDto = "live" | "demo" | "missing_key" | "off"

/** The registries as the settings show them. */
export interface RegistriesStatus {
  /** The registries of a Polish NIP, in order. */
  pl: Array<"gus" | "whitelist" | "vies">
  gus: { mode: RegistryModeDto; environment: "production" | "test"; key: boolean }
  whitelist: { mode: RegistryModeDto; baseUrl: string }
  vies: { mode: RegistryModeDto }
  /** Registries that answer for real in demo mode. */
  live: Array<"gus" | "whitelist" | "vies">
  timeoutMs: number
}

/** The whole status the Whitelist page renders in one call. */
export interface StatusResponse {
  demo: boolean
  staleHours: number
  registries: RegistriesStatus
  counts: {
    entities: number
    active: number
    exempt: number
    inactive: number
    not_found: number
    checks: number
  }
  entities: EntityDto[]
  checks: CheckDto[]
}

/** The answer of a connection test. */
export interface RegistryTestResponse {
  registry: "gus" | "whitelist" | "vies"
  ok: boolean
  message: string
  ms: number
}
