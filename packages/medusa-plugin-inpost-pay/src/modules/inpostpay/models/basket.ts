import { model } from "@medusajs/framework/utils"

/**
 * ONE BASKET bound to InPost Pay: the Medusa cart behind it, where it stands
 * (created, linked, rejected, ordered, failed, unbound), the masked phone of
 * the app user, the order it became and the InPost payment and order
 * statuses, plus a short history. The plugin's own record: decisions never
 * come from cart or order metadata.
 *
 * The id is also the `basket_id` InPost knows the basket by (the merchant
 * assigns it). Amounts are minor units (grosze): `model.number` is an
 * integer column.
 */
const InpostPayBasket = model
  .define("inpost_pay_basket", {
    id: model.id({ prefix: "ipbsk" }).primaryKey(),
    cart_id: model.text(),
    /** created, linked, rejected, ordered, failed, unbound */
    status: model.text().default("created"),
    /** A row of demo mode (a simulated confirmation, or a sample built for the panel). */
    demo: model.boolean().default(false),
    /** The app user's phone as InPost masks it ("60*****00"). The full number is never stored. */
    masked_phone: model.text().nullable(),
    order_id: model.text().nullable(),
    /** APM, COURIER or DIGITAL, from the order. */
    delivery_type: model.text().nullable(),
    /** The parcel locker the customer picked (APM). */
    delivery_point: model.text().nullable(),
    /** The InPost Pay payment status (UNPAID ... AUTHORIZED, DECLINED, COD). */
    payment_status: model.text().nullable(),
    payment_type: model.text().nullable(),
    /** The InPost Pay order status (ORDER_PROCESSING, ORDER_COMPLETED, ORDER_REJECTED). */
    order_status: model.text().nullable(),
    currency_code: model.text().nullable(),
    /** The order (or cart) total in minor units. */
    amount_minor: model.number().nullable(),
    /** Where the button was (PRODUCT_CARD, BASKET_SUMMARY, ...). */
    binding_place: model.text().nullable(),
    /** InPost's `basket_binding_api_key` for Widget 2.0 (it goes to the browser anyway). */
    binding_key: model.text().nullable(),
    /** InPost's own id of the basket in the app (from the confirmation). */
    inpost_basket_id: model.text().nullable(),
    linked_at: model.dateTime().nullable(),
    ordered_at: model.dateTime().nullable(),
    /** A masked error of the last failed step. */
    error: model.text().nullable(),
    /** The newest events, at most 50: [{ at, kind, message, demo?, data? }]. */
    events: model.json().nullable(),
  })
  .indexes([
    { on: ["cart_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
    { on: ["status"], where: "deleted_at IS NULL" },
    { on: ["created_at"], where: "deleted_at IS NULL" },
  ])

export default InpostPayBasket
