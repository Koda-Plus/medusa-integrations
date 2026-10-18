import type { MedusaContainer } from "@medusajs/framework/types"
import { PromotionActions } from "@medusajs/framework/utils"
import { addToCartWorkflow, deleteLineItemsWorkflow, updateCartPromotionsWorkflow, updateLineItemInCartWorkflow } from "@medusajs/medusa/core-flows"
import { basketPayload, cartTotalMinor, currencySupported, lineItemFor } from "../../modules/inpostpay/lib/basket"
import { BINDING_PLACES, type BindingPlace } from "../../modules/inpostpay/lib/constants"
import type { StoreBasketResponse } from "../../modules/inpostpay/lib/contract"
import { maskPhone, normalizePhone } from "../../modules/inpostpay/lib/confirm"
import { offeredDeliveries } from "../../modules/inpostpay/lib/delivery"
import { inpostPaySvc, readSettings, statusOf, withEvent } from "../../modules/inpostpay/lib/store"
import { loadCart, shippingOptionsFor, type LoadedCart } from "./carts"
import { InpostPayFlowError, clientOf, loggerOf, optionsOf } from "./runtime"

/**
 * THE BASKET SIDE of InPost Pay: binding a Medusa cart (the button), the
 * basket as the app shows it, and what the app changes (confirmation,
 * quantities, codes, suggested products, unbinding).
 */

export async function basketRow(scope: MedusaContainer, id: string): Promise<Record<string, any> | null> {
  if (!/^ipbsk_[A-Za-z0-9]+$/.test(id)) return null
  const rows = (await inpostPaySvc(scope).listInpostPayBaskets({ id }, { take: 1 })) ?? []
  return rows[0] ?? null
}

export async function basketRowByCart(scope: MedusaContainer, cartId: string): Promise<Record<string, any> | null> {
  const rows = (await inpostPaySvc(scope).listInpostPayBaskets({ cart_id: cartId }, { take: 1 })) ?? []
  return rows[0] ?? null
}

export async function updateRow(scope: MedusaContainer, id: string, patch: Record<string, unknown>): Promise<Record<string, any>> {
  const updated = await inpostPaySvc(scope).updateInpostPayBaskets({ id, ...patch })
  return (Array.isArray(updated) ? updated[0] : updated) as Record<string, any>
}

export function storeBasketDto(row: Record<string, any>): StoreBasketResponse["basket"] {
  return {
    id: String(row.id),
    status: statusOf(row.status),
    demo: row.demo === true,
    masked_phone: row.masked_phone ?? null,
    order_id: row.order_id ?? null,
    payment_status: row.payment_status ?? null,
  }
}

/** The basket payload of a row's cart, as InPost wants it in the app. */
export async function payloadForCart(scope: MedusaContainer, cart: LoadedCart): Promise<Record<string, unknown>> {
  const o = optionsOf(scope)
  const settings = await readSettings(scope)
  const options = await shippingOptionsFor(scope, cart.id)
  const offered = offeredDeliveries(settings.delivery, options, o.demo)
  const now = Date.now()
  return basketPayload(cart, {
    deliveries: offered.map((d) => ({ type: d.type, gross: options.find((x) => x.id === d.optionId)?.amount ?? 0 })),
    shippingVatRate: o.shippingVatRate,
    storefrontUrl: o.storefrontUrl,
    expiresAt: new Date(now + o.basketTtlHours * 60 * 60 * 1000),
    deliveryDate: new Date(now + 2 * 24 * 60 * 60 * 1000),
  })
}

export async function payloadForRow(scope: MedusaContainer, row: Record<string, any>): Promise<Record<string, unknown>> {
  const cart = await loadCart(scope, String(row.cart_id))
  if (!cart) throw new InpostPayFlowError(404, "BASKET_NOT_FOUND", "The cart of this basket is gone")
  return payloadForCart(scope, cart)
}

/**
 * The button: bind a cart to InPost Pay. Creates (or reuses) the basket row
 * of the cart, asks the Basket App for the binding key Widget 2.0 needs
 * (idempotent on InPost's side too) and, when the basket is already linked,
 * sends the changed basket. Demo mode binds in memory and returns no widget.
 */
export async function bindCart(scope: MedusaContainer, input: { cartId: string; bindingPlace?: string | null }): Promise<StoreBasketResponse> {
  const o = optionsOf(scope)
  const client = clientOf(scope)
  if (!client) throw new InpostPayFlowError(503, "NOT_CONFIGURED", "InPost Pay is not configured yet")
  const cart = await loadCart(scope, input.cartId)
  if (!cart) throw new InpostPayFlowError(404, "CART_NOT_FOUND", "Cart not found")
  if (cart.completed_at) throw new InpostPayFlowError(409, "CART_COMPLETED", "This cart is already an order")
  if (!currencySupported(cart.currency_code)) throw new InpostPayFlowError(400, "CURRENCY_NOT_SUPPORTED", "InPost Pay takes PLN only")
  if (!(cart.items ?? []).length) throw new InpostPayFlowError(400, "CART_EMPTY", "The cart has no items")
  const place = typeof input.bindingPlace === "string" && (BINDING_PLACES as readonly string[]).includes(input.bindingPlace) ? (input.bindingPlace as BindingPlace) : null
  const svc = inpostPaySvc(scope)

  let row = await basketRowByCart(scope, cart.id)
  if (!row) {
    try {
      const created = await svc.createInpostPayBaskets({
        cart_id: cart.id,
        status: "created",
        demo: o.demo,
        currency_code: String(cart.currency_code ?? "pln").toLowerCase(),
        amount_minor: cartTotalMinor(cart),
        binding_place: place,
        events: withEvent([], { kind: "bound", message: o.demo ? "Bound in demo mode (simulation, InPost is not called)" : "Bound to InPost Pay", ...(o.demo ? { demo: true } : {}) }),
      })
      row = (Array.isArray(created) ? created[0] : created) as Record<string, any>
    } catch {
      /* Two clicks at once: the unique cart index lets one row through. */
      row = await basketRowByCart(scope, cart.id)
      if (!row) throw new InpostPayFlowError(500, "BIND_FAILED", "The basket could not be saved")
    }
  } else if (row.status === "rejected" || row.status === "unbound" || row.status === "failed") {
    row = await updateRow(scope, row.id, {
      status: row.order_id ? "ordered" : "created",
      error: null,
      amount_minor: cartTotalMinor(cart),
      binding_place: place ?? row.binding_place,
      events: withEvent(row.events, { kind: "bound", message: "Bound again", ...(o.demo ? { demo: true } : {}) }),
    })
  } else {
    row = await updateRow(scope, row.id, { amount_minor: cartTotalMinor(cart), binding_place: place ?? row.binding_place })
  }

  let key = typeof row.binding_key === "string" && row.binding_key ? row.binding_key : ""
  try {
    if (!key) {
      key = (await client.bind(String(row.id))).basket_binding_api_key
      row = await updateRow(scope, row.id, { binding_key: key })
    }
    if (row.status === "linked" && client.mode !== "demo") await client.updateBasket(String(row.id), await payloadForCart(scope, cart))
  } catch (e) {
    const message = (e as Error)?.message ?? String(e)
    loggerOf(scope).warn(`[inpostpay] Binding ${row.id} failed: ${message}`)
    await updateRow(scope, row.id, { error: message.slice(0, 500), events: withEvent(row.events, { kind: "failed", message: `Binding failed: ${message.slice(0, 200)}` }) }).catch(() => undefined)
    throw new InpostPayFlowError(502, "BINDING_FAILED", "InPost Pay could not bind the basket now; try again in a moment")
  }

  return {
    basket: storeBasketDto(row),
    widget: o.demo ? null : { merchant_client_id: o.merchantClientId, basket_binding_api_key: key, script_url: o.widgetUrl },
  }
}

/** POST /v1/izi/basket/{id}/confirmation from InPost: the customer linked (SUCCESS) or refused (REJECT) the basket. */
export async function confirmBinding(scope: MedusaContainer, row: Record<string, any>, body: Record<string, any>): Promise<Record<string, any>> {
  const rejected = body.status === "REJECT"
  const phone = normalizePhone(body.phone_number?.phone, body.phone_number?.country_prefix)
  const masked = typeof body.masked_phone_number === "string" && body.masked_phone_number.length <= 20 ? body.masked_phone_number : phone ? maskPhone(phone.phone) : row.masked_phone ?? null
  return updateRow(scope, row.id, {
    status: rejected ? "rejected" : row.order_id ? "ordered" : "linked",
    masked_phone: masked,
    inpost_basket_id: typeof body.inpost_basket_id === "string" ? body.inpost_basket_id.slice(0, 80) : row.inpost_basket_id ?? null,
    linked_at: rejected ? row.linked_at ?? null : new Date(),
    events: withEvent(row.events, { kind: rejected ? "rejected" : "linked", message: rejected ? "The customer refused the basket in the app" : `Linked in the app${masked ? ` (${masked})` : ""}` }),
  })
}

/**
 * POST /v1/izi/basket/{id}/event from InPost: the customer changed the basket
 * in the app. PRODUCTS_QUANTITY sets a line item's quantity (0 removes it),
 * PROMO_CODES adds a code, RELATED_PRODUCTS adds a suggested product (its
 * product_id is a variant id). The cart changes through Medusa's own cart
 * workflows, so prices, promotions and taxes are recomputed as usual.
 */
export async function applyBasketEvent(scope: MedusaContainer, row: Record<string, any>, body: Record<string, any>): Promise<void> {
  const cartId = String(row.cart_id)
  const type = String(body.event_type ?? "")
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, any> | undefined
  let message = `Basket event ${type}`
  if (type === "PRODUCTS_QUANTITY") {
    const data = first(body.quantity_event_data)
    const productId = typeof data?.product_id === "string" ? data.product_id : ""
    const quantity = Math.max(0, Math.round(Number(data?.quantity?.quantity)))
    const cart = await loadCart(scope, cartId)
    const item = cart ? lineItemFor(cart, productId) : null
    if (!item || !Number.isFinite(quantity)) throw new InpostPayFlowError(400, "PRODUCT_NOT_FOUND", "No such product in the basket")
    if (quantity === 0) await deleteLineItemsWorkflow(scope).run({ input: { cart_id: cartId, ids: [item.id] } })
    else await updateLineItemInCartWorkflow(scope).run({ input: { cart_id: cartId, item_id: item.id, update: { quantity } } })
    message = `Quantity of ${productId} set to ${quantity} in the app`
  } else if (type === "PROMO_CODES") {
    const data = first(body.promo_codes_event_data)
    const code = typeof data?.promo_code_value === "string" ? data.promo_code_value.trim().slice(0, 60) : ""
    if (!code) throw new InpostPayFlowError(400, "PROMO_CODE_MISSING", "No promo code in the event")
    await updateCartPromotionsWorkflow(scope).run({ input: { cart_id: cartId, promo_codes: [code], action: PromotionActions.ADD } })
    message = `Promo code ${code} added in the app`
  } else if (type === "RELATED_PRODUCTS") {
    const data = first(body.related_products_event_data)
    const variantId = typeof data?.product_id === "string" ? data.product_id : ""
    const quantity = Math.max(1, Math.round(Number(data?.quantity?.quantity) || 1))
    if (!/^variant_[A-Za-z0-9]+$/.test(variantId)) throw new InpostPayFlowError(400, "PRODUCT_NOT_FOUND", "Unknown suggested product")
    await addToCartWorkflow(scope).run({ input: { cart_id: cartId, items: [{ variant_id: variantId, quantity }] } })
    message = `Suggested product ${variantId} added in the app`
  } else {
    throw new InpostPayFlowError(400, "UNKNOWN_EVENT", `Unknown event_type ${type || "(none)"}`)
  }
  const cart = await loadCart(scope, cartId)
  await updateRow(scope, row.id, { ...(cart ? { amount_minor: cartTotalMinor(cart) } : {}), events: withEvent(row.events, { kind: "basket_event", message }) })
}

/** DELETE /v1/izi/basket/{id}/binding from InPost: the basket is no longer in the app. */
export async function markUnbound(scope: MedusaContainer, row: Record<string, any>, reason: string): Promise<void> {
  await updateRow(scope, row.id, { status: row.order_id ? "ordered" : "unbound", binding_key: null, events: withEvent(row.events, { kind: "unbound", message: reason }) })
}
