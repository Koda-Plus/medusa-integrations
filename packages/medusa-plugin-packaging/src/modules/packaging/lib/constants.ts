/**
 * Constants of the Packaging module. ZERO IMPORTS on purpose: this file is
 * shared by the server and the admin bundle without a build step.
 */

/** Container key of the module service. */
export const PACKAGING_MODULE = "packaging"

/* TABLE NAMES, namespaced. */
export const PRODUCT_TABLE = "packaging_product"
export const UNIT_TABLE = "packaging_unit"

/* ------------------------------------------------------------------ */
/* Ids                                                                 */
/* ------------------------------------------------------------------ */

export const ID_PREFIX = {
  product: "ppr",
  unit: "pku",
} as const

/* ------------------------------------------------------------------ */
/* The ladder                                                          */
/* ------------------------------------------------------------------ */

/** The units of the ladder, from the smallest: piece, box, pallet. */
export const UNIT_NAMES = ["szt.", "karton", "paleta"] as const
export type UnitName = (typeof UNIT_NAMES)[number]

export function isUnitName(value: unknown): value is UnitName {
  return typeof value === "string" && (UNIT_NAMES as readonly string[]).includes(value)
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

export const PIECES_MAX = 100_000
export const UNITS_MAX = 4
export const LIST_MAX = 500
export const EAN_MAX = 14
export const SSCC_PREFIX_MAX = 10
