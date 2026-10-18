import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  addShippingMethodToCartWorkflow,
  completeCartWorkflow,
  createPaymentCollectionForCartWorkflow,
  createPaymentSessionsWorkflow,
  updateCartWorkflow,
} from "@medusajs/medusa/core-flows"
import { cartTotalMinor } from "../../modules/inpostpay/lib/basket"
import { confirmDecision } from "../../modules/inpostpay/lib/confirm"
import type { DeliveryType } from "../../modules/inpostpay/lib/constants"
import { pickShippingOption, shippingMethodData } from "../../modules/inpostpay/lib/delivery"
import { proofSecret, sessionProof } from "../../modules/inpostpay/lib/proof"
import { readSettings, withEvent } from "../../modules/inpostpay/lib/store"
import { basketRow, updateRow } from "./baskets"
import { loadCart, shippingOptionsFor } from "./carts"
import { InpostPayFlowError, loggerOf, optionsOf, withBasketLock } from "./runtime"

/**
 * PLACING THE ORDER of a basket, the same path for the demo confirmation
 * and for InPost's `POST /v1/izi/order`:
 *
 *   1. the buyer's e-mail and addresses go on the cart (updateCartWorkflow)
 *   2. the shipping option of the delivery type (the admin mapping; demo: the
 *      first one the cart can use) with the parcel locker in its data
 *   3. a payment collection and a session with this plugin's provider; the
 *      session data carries the proof only this server can make
 *   4. completeCartWorkflow: Medusa authorizes the session and makes the order
 *
 * Idempotent: one flow per basket at a time (a lock in the process), a basket
 * that already has an order returns it, and a cart Medusa already completed
 * answers with the same order.
 */

export interface Buyer {
  email: string
  first_name: string
  last_name: string
  phone: string | null
  address: { address_1: string; address_2?: string | null; city: string; postal_code: string; country_code: string }
}

export interface PlaceInput {
  basketId: string
  buyer: Buyer
  delivery: { type: DeliveryType; point: string | null }
  /** InPost's payment status at the time of the order (live), or the demo one. */
  payment: { status: string | null; type: string | null }
  /** The gross basket price InPost charged (live): must match the cart total. */
  expectedTotalMinor?: number | null
  /** What the history says. */
  source: "demo" | "inpost"
}

export interface PlaceResult {
  orderId: string
  already: boolean
}

async function orderOfCart(scope: MedusaContainer, cartId: string): Promise<string | null> {
  try {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data } = await query.graph({ entity: "cart", fields: ["id", "order.id"], filters: { id: cartId } })
    const id = (data as any[])[0]?.order?.id
    return typeof id === "string" ? id : null
  } catch {
    return null
  }
}

export async function placeOrder(scope: MedusaContainer, input: PlaceInput): Promise<PlaceResult> {
  return withBasketLock(input.basketId, async () => {
    const o = optionsOf(scope)
    const row = await basketRow(scope, input.basketId)
    if (!row) throw new InpostPayFlowError(404, "BASKET_NOT_FOUND", "Basket not found")
    const decision = confirmDecision(row as { status: string; order_id: string | null })
    if (decision.action === "return_order") return { orderId: decision.orderId, already: true }
    if (decision.action === "refuse") throw new InpostPayFlowError(409, decision.code, decision.message)

    const cartId = String(row.cart_id)
    let cart = await loadCart(scope, cartId)
    if (!cart) throw new InpostPayFlowError(404, "BASKET_NOT_FOUND", "The cart of this basket is gone")
    if (cart.completed_at) {
      const existing = await orderOfCart(scope, cartId)
      if (existing) {
        await updateRow(scope, row.id, { status: "ordered", order_id: existing, ordered_at: row.ordered_at ?? new Date(), error: null })
        return { orderId: existing, already: true }
      }
    }

    try {
      const b = input.buyer
      const address = {
        first_name: b.first_name.slice(0, 100),
        last_name: b.last_name.slice(0, 100),
        address_1: b.address.address_1.slice(0, 200),
        address_2: b.address.address_2 ? b.address.address_2.slice(0, 200) : undefined,
        city: b.address.city.slice(0, 100),
        postal_code: b.address.postal_code.slice(0, 20),
        country_code: b.address.country_code.toLowerCase().slice(0, 2),
        phone: b.phone ?? undefined,
      }
      await updateCartWorkflow(scope).run({ input: { id: cartId, email: b.email, shipping_address: address, billing_address: address } })

      const available = await shippingOptionsFor(scope, cartId)
      const settings = await readSettings(scope)
      const pick = pickShippingOption({ type: input.delivery.type, mapping: settings.delivery, available, demo: o.demo })
      if (!pick.ok) throw new InpostPayFlowError(422, pick.code, pick.message)
      await addShippingMethodToCartWorkflow(scope).run({ input: { cart_id: cartId, options: [{ id: pick.id, data: shippingMethodData(input.delivery.type, input.delivery.point) }] } })

      cart = (await loadCart(scope, cartId))!
      const amountMinor = cartTotalMinor(cart)
      /* Whether InPost's basket_price includes the delivery is not said in the readable docs: either total passes. */
      const withoutShipping = amountMinor - Math.round(Number((Number((cart as { shipping_total?: unknown }).shipping_total ?? 0) * 100).toFixed(4)))
      if (typeof input.expectedTotalMinor === "number" && Math.abs(input.expectedTotalMinor - amountMinor) > 1 && Math.abs(input.expectedTotalMinor - withoutShipping) > 1) {
        throw new InpostPayFlowError(409, "BASKET_PRICE_CHANGED", `InPost charged ${input.expectedTotalMinor / 100}, the cart now costs ${amountMinor / 100}`)
      }

      let collectionId = cart.payment_collection?.id ?? null
      if (!collectionId) {
        const { result } = await createPaymentCollectionForCartWorkflow(scope).run({ input: { cart_id: cartId } })
        collectionId = (result as { id: string }).id
      }
      const data = {
        inpostpay: true,
        basket_id: String(row.id),
        cart_id: cartId,
        amount_minor: amountMinor,
        demo: o.demo,
        mode: o.mode,
        inpost_payment_status: input.payment.status,
        inpost_payment_type: input.payment.type,
      }
      await createPaymentSessionsWorkflow(scope).run({
        input: { payment_collection_id: collectionId, provider_id: o.paymentProviderId, data: { ...data, proof: sessionProof(proofSecret(o), data) } },
      })

      const { result } = await completeCartWorkflow(scope).run({ input: { id: cartId } })
      const orderId = (result as { id: string }).id
      await updateRow(scope, row.id, {
        status: "ordered",
        order_id: orderId,
        ordered_at: new Date(),
        error: null,
        amount_minor: amountMinor,
        delivery_type: input.delivery.type,
        delivery_point: input.delivery.point,
        payment_status: input.payment.status,
        payment_type: input.payment.type,
        order_status: "ORDER_PROCESSING",
        events: withEvent(row.events, {
          kind: "ordered",
          message: input.source === "demo" ? "Order placed from the simulated app confirmation (demo)" : "Order placed from InPost Pay",
          ...(o.demo ? { demo: true } : {}),
          data: { order_id: orderId, shipping_option_id: pick.id, ...(pick.fallback ? { fallback: true } : {}) },
        }),
      })
      return { orderId, already: false }
    } catch (e) {
      const message = (e as Error)?.message ?? String(e)
      loggerOf(scope).warn(`[inpostpay] Order of basket ${row.id} failed: ${message}`)
      await updateRow(scope, row.id, { status: "failed", error: message.slice(0, 500), events: withEvent(row.events, { kind: "failed", message: `The order failed: ${message.slice(0, 200)}`, ...(o.demo ? { demo: true } : {}) }) }).catch(() => undefined)
      if (e instanceof InpostPayFlowError) throw e
      throw new InpostPayFlowError(422, "ORDER_FAILED", message.slice(0, 300))
    }
  })
}
