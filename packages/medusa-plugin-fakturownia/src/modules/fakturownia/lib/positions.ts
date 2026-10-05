/**
 * THE POSITIONS OF A DOCUMENT. Pure: an order in, Fakturownia `positions` out.
 *
 * ONE POSITION PER LINE ITEM: "Product title, variant title", the SKU as
 * `code`, the quantity, the unit, the GROSS total of the line after
 * discounts (`total_price_gross`, the field Fakturownia requires) and the tax
 * rate. Discounts are already inside the line total, so no `discount_percent`
 * is sent and the document total equals what the customer pays.
 *
 * THE TAX RATE comes from the line's Medusa tax lines (the sum of their rates,
 * as Medusa applies each to the same base). A rate of 0 whose tax code is
 * "zw", "np" or "oo" is sent as that code (exempt, not subject, reverse
 * charge). Only a line WITHOUT tax lines gets `defaultVatRate`.
 *
 * ONE POSITION PER SHIPPING METHOD, always, also at 0.00 (free shipping stays
 * visible on the document). With one method the order's `shipping_total` is
 * used: it is computed after shipping discounts, while a method record can
 * come back without its adjustments (measured in production).
 *
 * QUANTITY COMES FROM `items.detail.quantity`. Measured in production on
 * Medusa 2.17: without the `detail` relation the graph returns no quantity.
 * A line without a readable quantity stops the document instead of billing
 * one unit for 0.00. Medusa amounts are in major units (12.34 is 12.34 PLN).
 */

import { round, toNumber, toNumberOrNull } from "./numbers"
import { PayloadError } from "./errors"
import type { TaxValue } from "./options"

export interface TaxLineRecord {
  rate?: unknown
  code?: string | null
}

export interface ItemRecord {
  id: string
  title?: string | null
  subtitle?: string | null
  product_title?: string | null
  variant_title?: string | null
  variant_sku?: string | null
  quantity?: unknown
  detail?: { quantity?: unknown } | null
  unit_price?: unknown
  total?: unknown
  discount_total?: unknown
  is_tax_inclusive?: boolean | null
  tax_lines?: TaxLineRecord[] | null
  variant?: { sku?: string | null; title?: string | null } | null
}

export interface ShippingRecord {
  name?: string | null
  amount?: unknown
  total?: unknown
  is_tax_inclusive?: boolean | null
  tax_lines?: TaxLineRecord[] | null
}

export interface PositionsSource {
  id?: string
  display_id?: number | null
  currency_code?: string | null
  shipping_total?: unknown
  items?: ItemRecord[] | null
  shipping_methods?: ShippingRecord[] | null
}

/** One Fakturownia position as sent. */
export interface Position {
  name: string
  code?: string
  quantity: number
  quantity_unit: string
  total_price_gross: number
  tax: TaxValue
}

export interface PositionOptions {
  defaultVatRate: TaxValue
  shippingPositionName: string
  quantityUnit: string
}

export interface PositionsResult {
  positions: Position[]
  totalGross: number
  currency: string
}

/** Positions are named up to 256 characters (the KSeF limit). */
const NAME_MAX = 256
const CODE_MAX = 50

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const t = value.trim()
  return t.length > 0 ? t : undefined
}

const DEFAULT_VARIANT = /^default( variant)?$/i

/** "Product title, variant title"; just the product when the variant title adds nothing. */
export function lineName(item: ItemRecord): string {
  const product = text(item.product_title) ?? text(item.title)
  const variant = text(item.variant_title) ?? text(item.variant?.title) ?? text(item.subtitle)
  const useVariant = variant && !DEFAULT_VARIANT.test(variant) && variant.toLowerCase() !== (product ?? "").toLowerCase()
  const name = product && useVariant ? `${product}, ${variant}` : product ?? variant ?? text(item.variant_sku) ?? "Item"
  return name.slice(0, NAME_MAX)
}

/** The Fakturownia `tax` of Medusa tax lines, or the fallback when there are none. */
export function taxValue(lines: TaxLineRecord[] | null | undefined, fallback: TaxValue): TaxValue {
  const list = (lines ?? []).filter((l) => l && l.rate !== undefined && l.rate !== null)
  if (list.length === 0) return fallback
  const rate = round(list.reduce((sum, l) => sum + toNumber(l.rate), 0), 2)
  if (rate === 0) {
    for (const l of list) {
      const code = (l.code ?? "").trim().toLowerCase()
      if (code === "zw" || code === "np" || code === "oo") return code
    }
  }
  return rate
}

function percent(tax: TaxValue): number {
  return typeof tax === "number" ? tax : 0
}

function lineQuantity(item: ItemRecord): number {
  const n = toNumberOrNull(item.detail?.quantity ?? item.quantity)
  if (n === null) {
    throw new PayloadError(
      "no_quantity",
      `Line ${item.id} has no readable quantity (items.detail.quantity). The document would be false, so it is not built.`,
    )
  }
  return n
}

/** The gross total of a line after discounts: Medusa's `total`, or rebuilt from the unit price when it is missing. */
function lineGross(item: ItemRecord, quantity: number, tax: TaxValue): number {
  const total = toNumberOrNull(item.total)
  if (total !== null) return round(total, 2)
  const base = toNumber(item.unit_price) * quantity - toNumber(item.discount_total)
  return round(item.is_tax_inclusive ? base : base * (1 + percent(tax) / 100), 2)
}

function shippingGross(method: ShippingRecord, tax: TaxValue): number {
  const total = toNumberOrNull(method.total)
  if (total !== null) return round(total, 2)
  const amount = toNumber(method.amount)
  return round(method.is_tax_inclusive ? amount : amount * (1 + percent(tax) / 100), 2)
}

export function buildPositions(order: PositionsSource, o: PositionOptions): PositionsResult {
  const positions: Position[] = []

  for (const item of order.items ?? []) {
    const quantity = lineQuantity(item)
    /* Lines edited down to zero stay on the order with quantity 0: skip them. */
    if (quantity <= 0) continue
    const tax = taxValue(item.tax_lines, o.defaultVatRate)
    const gross = lineGross(item, quantity, tax)
    if (gross < 0) throw new PayloadError("negative_line", `Line ${item.id} has a negative total (${gross}).`)
    const code = (text(item.variant_sku) ?? text(item.variant?.sku))?.slice(0, CODE_MAX)
    positions.push({
      name: lineName(item),
      ...(code ? { code } : {}),
      quantity,
      quantity_unit: o.quantityUnit,
      total_price_gross: gross,
      tax,
    })
  }

  if (positions.length === 0) {
    throw new PayloadError("no_lines", `Order ${order.display_id ?? order.id ?? ""} has no lines to put on a document.`.replace(/\s+$/, ""))
  }

  const methods = order.shipping_methods ?? []
  const orderShipping = toNumberOrNull(order.shipping_total)
  methods.forEach((method) => {
    const tax = taxValue(method.tax_lines, o.defaultVatRate)
    const gross = methods.length === 1 && orderShipping !== null ? round(orderShipping, 2) : shippingGross(method, tax)
    positions.push({
      name: (text(method.name) ?? o.shippingPositionName).slice(0, NAME_MAX),
      quantity: 1,
      quantity_unit: o.quantityUnit,
      total_price_gross: Math.max(0, gross),
      tax,
    })
  })

  const totalGross = round(
    positions.reduce((sum, p) => sum + p.total_price_gross, 0),
    2,
  )
  const currency = (text(order.currency_code) ?? "pln").toUpperCase().slice(0, 3)
  return { positions, totalGross, currency }
}
