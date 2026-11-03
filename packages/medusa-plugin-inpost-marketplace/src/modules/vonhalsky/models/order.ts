import { model } from "@medusajs/framework/utils"

/**
 * ONE MARKETPLACE ORDER and the Medusa order it became. Unique per
 * marketplace order id: the row is written before anything else happens,
 * so a second import of the same order finds it and creates nothing.
 *
 * No name, address, e-mail or phone of the buyer is kept here: those go on
 * the Medusa order only. The row keeps the delivery type, the parcel
 * locker, the payment type, the lines (offer, variant, quantity, price),
 * the parcels the marketplace shows, money facts (paid, refunded, the
 * discounts of promotions and the price program) and a short history.
 *
 * TRACKING: the seller API takes no tracking number. A ShipX shipment made
 * with the order's InPost e-mail is linked by InPost and shows up in the
 * order's `delivery.parcels`; `tracking_status` says whether the numbers of
 * Medusa's fulfillments are there yet (none, waiting, linked).
 */
const VonHalskyOrder = model
  .define("vonhalsky_order", {
    id: model.id({ prefix: "vhord" }).primaryKey(),
    marketplace_order_id: model.text(),
    /** importing, imported, held */
    status: model.text().default("importing"),
    /** The marketplace's own status (CREATED, ACCEPTED...). */
    remote_status: model.text().nullable(),
    order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    demo: model.boolean().default(false),
    /** APM or COURIER. */
    delivery_type: model.text().nullable(),
    /** The parcel locker the buyer picked (APM). */
    delivery_point: model.text().nullable(),
    shipping_option_id: model.text().nullable(),
    payment_type: model.text().nullable(),
    currency_code: model.text().default("pln"),
    total_minor: model.number().nullable(),
    /** [{ offer_id, variant_id, sku, title, quantity, unit_price_minor }] */
    lines: model.json().nullable(),
    /** none, waiting (Medusa has numbers the marketplace does not show yet), linked */
    tracking_status: model.text().default("none"),
    /** The tracking numbers of Medusa's fulfillments of this order. */
    tracking_numbers: model.json().nullable(),
    tracking_sent_at: model.dateTime().nullable(),
    placed_at: model.dateTime().nullable(),
    imported_at: model.dateTime().nullable(),
    attempts: model.number().default(0),
    /** A masked error of the last failed step (held import, failed tracking). */
    error: model.text().nullable(),
    /** The newest events, at most 40: [{ at, kind, message, demo? }]. */
    events: model.json().nullable(),
    remote_updated_at: model.dateTime().nullable(),
    paid_at: model.dateTime().nullable(),
    /** PERSON or COMPANY (who the invoice is for), when the marketplace says. */
    buyer_kind: model.text().nullable(),
    delivery_minor: model.number().nullable(),
    /** What the lines cost without a promotion or the price program, and the two discounts. */
    base_total_minor: model.number().nullable(),
    promotion_discount_minor: model.number().nullable(),
    program_discount_minor: model.number().nullable(),
    /** The marketplace's parcels: [{ trackingNumber, createdAt, status }]. */
    parcels: model.json().nullable(),
    shipped_at: model.dateTime().nullable(),
    expected_delivery_at: model.dateTime().nullable(),
    refunded_minor: model.number().default(0),
    returns_count: model.number().default(0),
    claims_count: model.number().default(0),
  })
  .indexes([
    { on: ["marketplace_order_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
    { on: ["status"], where: "deleted_at IS NULL" },
    { on: ["tracking_status"], where: "deleted_at IS NULL" },
  ])

export default VonHalskyOrder
