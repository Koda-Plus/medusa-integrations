import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { listShippingOptionsForCartWorkflow } from "@medusajs/medusa/core-flows"
import type { CartLike } from "../../modules/inpostpay/lib/basket"
import type { ShippingOptionLite } from "../../modules/inpostpay/lib/contract"

/**
 * Reading a cart the way the basket needs it. Totals come from the cart
 * module only with the relations in full (`items.*`, the tax lines and the
 * adjustments): with partial item fields Query computes them from
 * incomplete rows.
 */
export const CART_FIELDS = [
  "id",
  "currency_code",
  "region_id",
  "email",
  "completed_at",
  "total",
  "subtotal",
  "tax_total",
  "item_total",
  "item_tax_total",
  "original_item_total",
  "original_item_tax_total",
  "discount_total",
  "shipping_total",
  "items.*",
  "items.tax_lines.*",
  "items.adjustments.*",
  "shipping_methods.*",
  "shipping_methods.tax_lines.*",
  "shipping_methods.adjustments.*",
  "promotions.code",
  "payment_collection.id",
  "payment_collection.payment_sessions.id",
  "payment_collection.payment_sessions.provider_id",
]

export type LoadedCart = CartLike & {
  region_id?: string | null
  email?: string | null
  completed_at?: string | Date | null
  payment_collection?: { id: string; payment_sessions?: Array<{ id: string; provider_id: string }> | null } | null
}

export async function loadCart(scope: MedusaContainer, cartId: string): Promise<LoadedCart | null> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({ entity: "cart", fields: CART_FIELDS, filters: { id: cartId } })
  const cart = (data as any[])[0]
  if (!cart) return null
  return cart as LoadedCart
}

export type PricedOption = ShippingOptionLite & { amount: number }

/** The shipping options this cart can use, with their price for the cart. */
export async function shippingOptionsFor(scope: MedusaContainer, cartId: string): Promise<PricedOption[]> {
  try {
    const { result } = await listShippingOptionsForCartWorkflow(scope).run({ input: { cart_id: cartId } })
    return ((result ?? []) as any[]).map((o) => {
      const raw = o.calculated_price?.calculated_amount ?? o.amount ?? 0
      const amount = typeof raw === "number" ? raw : Number(raw?.numeric ?? raw)
      return { id: String(o.id), name: String(o.name ?? o.id), provider_id: o.provider_id ?? null, amount: Number.isFinite(amount) ? amount : 0 }
    })
  } catch {
    return []
  }
}
