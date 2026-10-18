import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { demoBuyer, maskPhone, normalizePhone } from "../../modules/inpostpay/lib/confirm"
import { inpostPaySvc, withEvent } from "../../modules/inpostpay/lib/store"
import { basketRow, updateRow } from "./baskets"
import { placeOrder, type PlaceResult } from "./checkout"
import { InpostPayFlowError, optionsOf } from "./runtime"

/**
 * DEMO MODE ONLY. The simulated app confirmation and the sample rows of the
 * panel. Nothing here calls InPost.
 */

/**
 * `POST /store/inpostpay/baskets/:id/demo-confirm { phone }`: what the app
 * would do after the customer confirmed. A sample buyer (example.com, a
 * sample street and parcel locker), the first shipping option the cart can
 * use unless the admin mapped one, a payment session of this plugin's
 * provider, the cart completed. A second call returns the same order.
 */
export async function demoConfirm(scope: MedusaContainer, basketId: string, phoneInput: unknown): Promise<PlaceResult> {
  const o = optionsOf(scope)
  if (!o.demo) throw new InpostPayFlowError(404, "NOT_DEMO", "The simulated confirmation exists only in demo mode")
  const phone = normalizePhone(phoneInput)
  if (!phone) throw new InpostPayFlowError(400, "PHONE_INVALID", "Give a phone number (7 to 12 digits)")
  const row = await basketRow(scope, basketId)
  if (!row) throw new InpostPayFlowError(404, "BASKET_NOT_FOUND", "Basket not found")
  if (!row.order_id && row.status !== "linked") {
    await updateRow(scope, row.id, {
      status: "linked",
      masked_phone: maskPhone(phone.phone),
      linked_at: new Date(),
      events: withEvent(row.events, { kind: "linked", message: `Simulated app confirmation (${maskPhone(phone.phone)})`, demo: true }),
    })
  }
  const buyer = demoBuyer(phone)
  return placeOrder(scope, {
    basketId,
    buyer: { email: buyer.email, first_name: buyer.first_name, last_name: buyer.last_name, phone: buyer.phone, address: buyer.address },
    delivery: { type: "APM", point: buyer.locker },
    payment: { status: "AUTHORIZED", type: "BLIK_CODE" },
    source: "demo",
  })
}

const SAMPLES: Array<{ status: string; payment: string | null; order: boolean; phone: string; delivery: "APM" | "COURIER"; point: string | null; place: string }> = [
  { status: "ordered", payment: "AUTHORIZED", order: true, phone: "600100200", delivery: "APM", point: "DEMO01M", place: "PRODUCT_CARD" },
  { status: "ordered", payment: "COD", order: true, phone: "601200300", delivery: "COURIER", point: null, place: "BASKET_SUMMARY" },
  { status: "ordered", payment: "DECLINED", order: true, phone: "602300400", delivery: "APM", point: "DEMO02A", place: "BASKET_SUMMARY" },
  { status: "linked", payment: null, order: false, phone: "603400500", delivery: "APM", point: null, place: "PRODUCT_CARD" },
  { status: "created", payment: null, order: false, phone: "", delivery: "APM", point: null, place: "MINICART_PAGE" },
  { status: "rejected", payment: null, order: false, phone: "604500600", delivery: "APM", point: null, place: "PRODUCT_CARD" },
]

/**
 * Sample rows for the panel of a demo store, built once from the store's
 * newest orders (their carts): every row carries `demo`. Real orders are
 * only read; nothing of them changes.
 */
export async function seedDemo(scope: MedusaContainer): Promise<number> {
  const o = optionsOf(scope)
  if (!o.demo) throw new InpostPayFlowError(404, "NOT_DEMO", "Samples exist only in demo mode")
  const svc = inpostPaySvc(scope)
  const [, count] = await svc.listAndCountInpostPayBaskets({}, { take: 1 })
  if (count > 0) return 0
  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any
  const { data } = await query.graph({ entity: "order", fields: ["id", "total", "currency_code", "created_at", "cart.id"], pagination: { take: SAMPLES.length, order: { created_at: "DESC" } } })
  const orders = (data as any[]).filter((x) => x?.cart?.id)
  let made = 0
  for (let i = 0; i < Math.min(orders.length, SAMPLES.length); i++) {
    const s = SAMPLES[i]
    const order = orders[i]
    const at = new Date(order.created_at ?? Date.now())
    const total = Math.round(Number((Number(order.total ?? 0) * 100).toFixed(4)))
    const masked = s.phone ? maskPhone(s.phone) : null
    let events = withEvent([], { at: at.toISOString(), kind: "bound", message: "Sample basket (demo)", demo: true })
    if (masked) events = withEvent(events, { at: new Date(at.getTime() + 60_000).toISOString(), kind: s.status === "rejected" ? "rejected" : "linked", message: s.status === "rejected" ? "The customer refused the basket in the app (sample)" : `Linked in the app (${masked}, sample)`, demo: true })
    if (s.order) {
      events = withEvent(events, { at: new Date(at.getTime() + 120_000).toISOString(), kind: "ordered", message: "Order placed from InPost Pay (sample)", demo: true })
      events = withEvent(events, { at: new Date(at.getTime() + 180_000).toISOString(), kind: "payment", message: `InPost: payment ${s.payment} (sample)`, demo: true })
    }
    try {
      await svc.createInpostPayBaskets({
        cart_id: String(order.cart.id),
        status: s.status,
        demo: true,
        masked_phone: masked,
        order_id: s.order ? order.id : null,
        delivery_type: s.order ? s.delivery : null,
        delivery_point: s.order ? s.point : null,
        payment_status: s.payment,
        payment_type: s.payment === "COD" ? "CASH_ON_DELIVERY" : s.order ? "BLIK_CODE" : null,
        order_status: s.order ? "ORDER_PROCESSING" : null,
        currency_code: String(order.currency_code ?? "pln"),
        amount_minor: Number.isFinite(total) ? total : null,
        binding_place: s.place,
        linked_at: masked && s.status !== "rejected" ? new Date(at.getTime() + 60_000) : null,
        ordered_at: s.order ? new Date(at.getTime() + 120_000) : null,
        events,
      })
      made += 1
    } catch {
      /* a cart that already has a row */
    }
  }
  return made
}
