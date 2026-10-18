import type { DeliveryType } from "./constants"

/**
 * THE BASKET AS INPOST PAY SHOWS IT IN THE APP, built from a Medusa cart.
 * The shape follows the "Basket details" and "Basket confirmation" pages of
 * the Merchant Backend API documentation:
 *
 *   summary    basket_base_price and basket_final_price ({ net, gross, vat },
 *              decimals with two places, without delivery), currency (only
 *              PLN), basket_expiration_date, payment_type ([] from the merchant)
 *   delivery   one entry per delivery type the store offers: delivery_type
 *              (APM, COURIER, DIGITAL), delivery_date, delivery_price
 *   products   one per line item
 *   promo_codes the codes on the cart
 *
 * The products part of those pages could not be read in full: the field
 * names used here (product_id, product_name, product_description,
 * product_link, product_image, ean, base_price, final_price, quantity with
 * quantity_type and quantity_unit) are the ones the readable pages and the
 * basket event page name; check them against the sandbox before going live.
 *
 * Pure: the cart comes in as a plain object, the payload goes out.
 */

export interface Price {
  net: number
  gross: number
  vat: number
}

export interface CartLike {
  id: string
  currency_code?: string | null
  item_total?: unknown
  item_tax_total?: unknown
  original_item_total?: unknown
  original_item_tax_total?: unknown
  total?: unknown
  items?: Array<{
    id: string
    title?: string | null
    product_title?: string | null
    variant_title?: string | null
    variant_id?: string | null
    product_id?: string | null
    product_handle?: string | null
    thumbnail?: string | null
    quantity?: unknown
    unit_price?: unknown
    total?: unknown
    tax_total?: unknown
    original_total?: unknown
    original_tax_total?: unknown
    variant_sku?: string | null
    variant_barcode?: string | null
  }> | null
  promotions?: Array<{ code?: string | null } | null> | null
}

export interface OfferedDelivery {
  type: DeliveryType
  /** The gross price of the shipping option for this cart, major units. */
  gross: number
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : typeof v === "string" ? Number(v) : typeof v === "object" && v !== null && "numeric" in (v as object) ? Number((v as { numeric: unknown }).numeric) : NaN
  return Number.isFinite(x) ? x : 0
}

export const round2 = (v: number): number => Math.round((v + Number.EPSILON) * 100) / 100

/** Gross and VAT to { net, gross, vat }, two decimals, net = gross - vat. */
export function price(gross: number, vat: number): Price {
  const g = round2(gross)
  const v = round2(vat)
  return { net: round2(g - v), gross: g, vat: v }
}

/** A gross price with a VAT rate in percent (the shipping price): the VAT inside the gross. */
export function priceFromRate(gross: number, ratePercent: number): Price {
  const g = round2(gross)
  const net = round2(g / (1 + ratePercent / 100))
  return { net, gross: g, vat: round2(g - net) }
}

/** InPost Pay takes PLN only. */
export function currencySupported(code: string | null | undefined): boolean {
  return String(code ?? "").toLowerCase() === "pln"
}

export function basketTotals(cart: CartLike): { base: Price; final: Price } {
  const base = price(n(cart.original_item_total), n(cart.original_item_tax_total))
  const final = price(n(cart.item_total), n(cart.item_tax_total))
  return { base, final }
}

export function basketPayload(
  cart: CartLike,
  ctx: { deliveries: OfferedDelivery[]; shippingVatRate: number; storefrontUrl: string | null; expiresAt: Date; deliveryDate: Date },
): Record<string, unknown> {
  const { base, final } = basketTotals(cart)
  const items = cart.items ?? []
  const codes = [...new Set((cart.promotions ?? []).map((p) => (p?.code ?? "").trim()).filter(Boolean))]
  return {
    summary: {
      basket_base_price: base,
      basket_final_price: final,
      currency: "PLN",
      basket_expiration_date: ctx.expiresAt.toISOString(),
      payment_type: [],
      free_basket: final.gross === 0,
    },
    delivery: ctx.deliveries.map((d) => ({
      delivery_type: d.type,
      delivery_date: ctx.deliveryDate.toISOString(),
      delivery_price: priceFromRate(d.gross, ctx.shippingVatRate),
    })),
    products: items.map((it) => {
      const qty = Math.max(1, Math.round(n(it.quantity)))
      const link = ctx.storefrontUrl && it.product_handle ? `${ctx.storefrontUrl}/products/${encodeURIComponent(it.product_handle)}` : undefined
      const product: Record<string, unknown> = {
        product_id: it.variant_id ?? it.id,
        product_name: it.product_title || it.title || "Product",
        product_description: it.variant_title && it.variant_title !== "Default variant" ? it.variant_title : undefined,
        product_link: link,
        product_image: it.thumbnail || undefined,
        ean: it.variant_barcode || undefined,
        base_price: price(n(it.original_total) / qty, n(it.original_tax_total) / qty),
        final_price: price(n(it.total) / qty, n(it.tax_total) / qty),
        quantity: { quantity: qty, quantity_type: "INTEGER", quantity_unit: "pcs" },
      }
      for (const k of Object.keys(product)) if (product[k] === undefined) delete product[k]
      return product
    }),
    promo_codes: codes.map((code) => ({ name: code, promo_code_value: code })),
  }
}

/** The line item of a product id the app sends back (the variant id, or the line item id). */
export function lineItemFor(cart: CartLike, productId: string): { id: string; quantity: number } | null {
  const it = (cart.items ?? []).find((x) => x.variant_id === productId || x.id === productId)
  return it ? { id: it.id, quantity: Math.round(n(it.quantity)) } : null
}

/** The cart total in minor units (the payment session amount). */
export function cartTotalMinor(cart: CartLike): number {
  return Math.round(Number((n(cart.total) * 100).toFixed(4)))
}
