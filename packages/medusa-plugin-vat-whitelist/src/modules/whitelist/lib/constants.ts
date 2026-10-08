/**
 * Constants of the VAT Whitelist module. ZERO IMPORTS on purpose: this file
 * is shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const WHITELIST_MODULE = "whitelist"

/* TABLE NAMES, namespaced. */
export const ENTITY_TABLE = "whitelist_entity"
export const CHECK_TABLE = "whitelist_check"

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const ID_PREFIX = {
  entity: "wen",
  check: "wch",
} as const

/* ------------------------------------------------------------------ */
/* Checks                                                              */
/* ------------------------------------------------------------------ */

/** Where the answer came from. */
export const SOURCES = ["whitelist", "vies", "gus"] as const
export type CheckSource = (typeof SOURCES)[number]

/**
 * The normalized state of a counterparty, whatever the source said:
 *
 *   active      VAT payer, on the whitelist (Czynny)
 *   exempt      VAT exempt (Zwolniony)
 *   not_found   not in the register
 *   invalid     the NIP or VAT number does not validate
 *   unavailable the registry could not answer
 */
export const STATES = ["active", "exempt", "not_found", "invalid", "unavailable"] as const
export type CheckState = (typeof STATES)[number]

export function isState(value: unknown): value is CheckState {
  return typeof value === "string" && (STATES as readonly string[]).includes(value)
}

/** The raw MF values and the state they map to. */
export const MF_STATUS_TO_STATE: Record<string, CheckState> = {
  Czynny: "active",
  Zwolniony: "exempt",
  Niezarejestrowany: "not_found",
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const NIP_DIGITS = 10
/** A Polish NIP: 10 digits with a valid checksum. */
export const NIP_PATTERN = /^\d{10}$/
/** An EU VAT number: a two-letter country code and 2 to 12 characters. */
export const VAT_PATTERN = /^[A-Z]{2}[A-Z0-9+*]{2,12}$/
export const NAME_MAX = 400
export const ADDRESS_MAX = 400
export const ACCOUNTS_MAX = 5
export const LIST_MAX = 500
