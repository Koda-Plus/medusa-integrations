/**
 * DIRECTIONS AND WRITERS. Pure; type-only imports, so the options module can
 * import the writer keys without a cycle at runtime.
 *
 * A WRITER is anything that changes data on one side because of the other:
 * importing products, creating cards, writing stock or prices, creating
 * orders, writing invoice numbers. Every writer has TWO switches:
 *
 *   hard switch   the plugin options (`writers.<key>: false`, and for stock
 *                 `stockSync` other than "write"). `false` wins; the admin
 *                 cannot override it.
 *   arm           a toggle a person flips in the admin, stored in the
 *                 database with who flipped it and when. Off by default.
 *
 * A writer writes only when it is ACTIVE (its direction is in use), ALLOWED
 * (no hard switch against it), ARMED and CONFIGURED. Everything else plans
 * and shows the plan.
 *
 * One exception keeps version 0.1 working: `stockSync: "write"` used to write
 * BaseLinker stock into Medusa right away. While nobody has touched the
 * `stockToMedusa` arm in the admin, that option arms it ("armed by the plugin
 * options"); the first click in the admin takes over.
 */

import type { CatalogSource, ResolvedBaseLinkerOptions, StockSource } from "./options"

export type WriterKey = "catalogImport" | "cards" | "stockToMedusa" | "stockToBaseLinker" | "prices" | "orderImport" | "invoiceNumbers"

export const WRITER_KEYS: readonly WriterKey[] = [
  "catalogImport",
  "cards",
  "stockToMedusa",
  "stockToBaseLinker",
  "prices",
  "orderImport",
  "invoiceNumbers",
]

export function isWriterKey(value: unknown): value is WriterKey {
  return typeof value === "string" && (WRITER_KEYS as readonly string[]).includes(value)
}

/** The BaseLinker method each writer may send; null when it writes into Medusa. */
export const WRITER_METHOD: Readonly<Record<WriterKey, string | null>> = {
  catalogImport: null,
  cards: "addInventoryProduct",
  stockToMedusa: null,
  stockToBaseLinker: "updateInventoryProductsStock",
  prices: "updateInventoryProductsPrices",
  orderImport: null,
  invoiceNumbers: "setOrderFields",
}

export interface Directions {
  catalog: CatalogSource
  stock: StockSource
}

/**
 * The directions in force: the options, or in demo mode what a visitor picked
 * in the admin (the simulation has nothing to protect, so the demo lets people
 * look at both directions).
 */
export function effectiveDirections(o: Pick<ResolvedBaseLinkerOptions, "catalogSource" | "stockSource" | "demo">, demoPick?: Partial<Directions> | null): Directions {
  const base: Directions = { catalog: o.catalogSource, stock: o.stockSource }
  if (!o.demo || !demoPick) return base
  return {
    catalog: demoPick.catalog === "baselinker" || demoPick.catalog === "medusa" ? demoPick.catalog : base.catalog,
    stock: demoPick.stock === "medusa" || demoPick.stock === "baselinker" ? demoPick.stock : base.stock,
  }
}

/** What the database says about one arm. */
export interface ArmRecord {
  armed: boolean
  changedBy: string | null
  changedByLabel: string | null
  changedAt: string | null
}

export type WriterBlock = "inactive_direction" | "hard_off" | "stock_not_write" | "not_configured" | "not_armed"

export interface WriterState {
  key: WriterKey
  /** In use with the current directions and options. */
  active: boolean
  /** No hard switch against it. */
  allowed: boolean
  /** Which hard switch is against it, when one is. */
  hardSwitch: "hard_off" | "stock_not_write" | null
  /** The options it needs are set (always true in demo mode). */
  configured: boolean
  armed: boolean
  /** Who armed it: a person in the admin, or the 0.1 option `stockSync: "write"`. */
  armedBy: "admin" | "options" | null
  /** Writes happen now: active, allowed, configured and armed. */
  live: boolean
  /** The first reason it does not write, or null when it does. */
  blocked: WriterBlock | null
  changedBy: string | null
  changedByLabel: string | null
  changedAt: string | null
}

type WriterOptions = Pick<
  ResolvedBaseLinkerOptions,
  "demo" | "apiToken" | "inventoryId" | "warehouseId" | "stockSync" | "priceGroupId" | "orderImportSources" | "writersOff"
>

function active(key: WriterKey, o: WriterOptions, d: Directions): boolean {
  switch (key) {
    case "catalogImport":
      return d.catalog === "baselinker"
    case "cards":
      return d.catalog === "medusa"
    case "stockToMedusa":
      return d.stock === "baselinker" && o.stockSync !== "off"
    case "stockToBaseLinker":
      return d.stock === "medusa" && o.stockSync !== "off"
    case "prices":
      return d.catalog === "medusa" && (o.demo || o.priceGroupId !== null)
    case "orderImport":
      return o.demo || o.orderImportSources.length > 0
    case "invoiceNumbers":
      return true
  }
}

function configured(key: WriterKey, o: WriterOptions): boolean {
  if (o.demo) return true
  const catalog = Boolean(o.apiToken) && o.inventoryId !== null
  switch (key) {
    case "catalogImport":
    case "cards":
      return catalog
    case "stockToMedusa":
      return catalog && /^[a-z]+_\d+$/.test(o.warehouseId)
    case "stockToBaseLinker":
      return catalog && /^bl_\d+$/.test(o.warehouseId)
    case "prices":
      return catalog && o.priceGroupId !== null
    case "orderImport":
      return Boolean(o.apiToken) && o.orderImportSources.length > 0
    case "invoiceNumbers":
      return Boolean(o.apiToken)
  }
}

/** The state of every writer, in a fixed order, for the jobs and the admin. */
export function writerStates(o: WriterOptions, d: Directions, arms: ReadonlyMap<WriterKey, ArmRecord>): WriterState[] {
  return WRITER_KEYS.map((key) => {
    const isActive = active(key, o, d)
    const hardOff = o.writersOff.includes(key)
    /* Stock writes need stockSync: "write", except in the simulation. */
    const stockGate = (key === "stockToMedusa" || key === "stockToBaseLinker") && !o.demo && o.stockSync !== "write"
    const allowed = !hardOff && !stockGate
    const isConfigured = configured(key, o)
    const record = arms.get(key) ?? null
    let armed = record?.armed === true
    let armedBy: WriterState["armedBy"] = armed ? "admin" : null
    if (!record && key === "stockToMedusa" && !o.demo && o.stockSync === "write") {
      armed = true
      armedBy = "options"
    }
    const blocked: WriterBlock | null = !isActive
      ? "inactive_direction"
      : hardOff
        ? "hard_off"
        : stockGate
          ? "stock_not_write"
          : !isConfigured
            ? "not_configured"
            : !armed
              ? "not_armed"
              : null
    return {
      key,
      active: isActive,
      allowed,
      hardSwitch: hardOff ? "hard_off" : stockGate ? "stock_not_write" : null,
      configured: isConfigured,
      armed,
      armedBy,
      live: blocked === null,
      blocked,
      changedBy: record?.changedBy ?? null,
      changedByLabel: record?.changedByLabel ?? null,
      changedAt: record?.changedAt ?? null,
    }
  })
}

export function writerState(states: readonly WriterState[], key: WriterKey): WriterState {
  return states.find((s) => s.key === key) as WriterState
}

/**
 * Whether a person may arm this writer now. Disarming is always allowed: a
 * kill switch that sometimes refuses is not a kill switch.
 */
export function canArm(state: WriterState): { ok: true } | { ok: false; reason: WriterBlock } {
  if (state.hardSwitch) return { ok: false, reason: state.hardSwitch }
  return { ok: true }
}
