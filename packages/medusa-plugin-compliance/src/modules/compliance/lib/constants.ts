/**
 * Constants of the EU Compliance module. ZERO IMPORTS on purpose: this file
 * is shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const COMPLIANCE_MODULE = "compliance"

/*
 * TABLE NAMES, namespaced so they never collide with another module.
 */
export const RESPONSIBLE_PERSON_TABLE = "compliance_responsible_person"
export const PRODUCT_TABLE = "compliance_product"
export const CONSENT_TABLE = "compliance_consent"
export const DSR_TABLE = "compliance_dsr"
export const PRICE_SNAPSHOT_TABLE = "compliance_price_snapshot"

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const ID_PREFIX = {
  responsiblePerson: "crp",
  product: "cpr",
  consent: "ccn",
  dsr: "cdsr",
  priceSnapshot: "cps",
} as const

/* ------------------------------------------------------------------ */
/* GPSR: economic operators                                            */
/* ------------------------------------------------------------------ */

/** The economic operators the GPSR knows; a responsible person is one of them. */
export const OPERATOR_KINDS = ["manufacturer", "responsible_person", "importer", "authorized_representative"] as const
export type OperatorKind = (typeof OPERATOR_KINDS)[number]

export function isOperatorKind(value: unknown): value is OperatorKind {
  return typeof value === "string" && (OPERATOR_KINDS as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* RODO: consent                                                       */
/* ------------------------------------------------------------------ */

/** Purposes consent can be recorded for. The cookie banner maps its categories onto these. */
export const CONSENT_PURPOSES = ["necessary", "functional", "analytics", "marketing"] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export function isConsentPurpose(value: unknown): value is ConsentPurpose {
  return typeof value === "string" && (CONSENT_PURPOSES as readonly string[]).includes(value)
}

/** Where a consent decision was made. */
export const CONSENT_SOURCES = ["cookie_banner", "account", "checkout", "newsletter"] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]

/* ------------------------------------------------------------------ */
/* RODO: data subject requests                                         */
/* ------------------------------------------------------------------ */

export const DSR_TYPES = ["access", "erasure", "portability", "restriction", "objection", "rectification"] as const
export type DsrType = (typeof DSR_TYPES)[number]

export function isDsrType(value: unknown): value is DsrType {
  return typeof value === "string" && (DSR_TYPES as readonly string[]).includes(value)
}

export const DSR_STATUSES = ["pending", "in_progress", "completed", "rejected"] as const
export type DsrStatus = (typeof DSR_STATUSES)[number]

export function isDsrStatus(value: unknown): value is DsrStatus {
  return typeof value === "string" && (DSR_STATUSES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Omnibus: price transparency                                         */
/* ------------------------------------------------------------------ */

/** The window (in days) the Omnibus Directive asks to compare against. */
export const OMNIBUS_WINDOW_DAYS = 30

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const NAME_MAX = 200
export const ADDRESS_MAX = 400
export const EMAIL_MAX = 254
export const COUNTRY_MAX = 2
export const WARNING_MAX = 500
export const WARNINGS_MAX = 12
export const SAFETY_MAX = 4000
export const DSR_NOTE_MAX = 2000
export const PURPOSE_MAX = 40
export const VERSION_MAX = 20
export const LIST_MAX = 500
