import { model } from "@medusajs/framework/utils"
import NegotiationMessage from "./negotiation-message"

/**
 * ONE NEGOTIATION THREAD: a customer, what it is about (a product, a variant
 * or a cart), the quantity, the prices on both sides and the status.
 *
 * THE TABLE KEEPS ITS OLD NAME. `negotiation` is the table of the app module
 * this plugin was extracted from; the migration adds the new columns with
 * `add column if not exists` and touches nothing that was there. Old rows
 * may still carry `target_price numeric` (and `raw_target_price jsonb`), the
 * one price the app module had: this model does not declare them, the code
 * reads such rows through `lib/thread.ts` and moves their price into the
 * columns below on the first change.
 *
 * MONEY IS INTEGER MINOR UNITS in the thread's currency (`currency_code`):
 * 469.00 PLN is 46900. Unit prices for a product or variant, the whole cart
 * for a cart thread. See `lib/money.ts`.
 *
 *   requested_amount  the customer's latest target
 *   offered_amount    the team's latest counter offer
 *   agreed_amount     the price both sides accepted
 *   price_amount      the price on the table (the latest of the above)
 *   list_amount       the catalog price (the cart's value) when it opened
 *
 * `demo` keeps threads of demo mode apart from real ones: the admin and the
 * Store API show one mode at a time. `waiting_for`, `last_activity_at` and
 * `message_count` are kept with every move, so the queue sorts and filters
 * without reading messages.
 */
const Negotiation = model
  .define("negotiation", {
    id: model.id({ prefix: "neg" }).primaryKey(),
    ref: model.text().searchable(),
    status: model.text().default("open"),
    customer_id: model.text().nullable(),
    cart_id: model.text().nullable(),
    order_id: model.text().nullable(),
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),
    sku: model.text().nullable(),
    qty: model.number().default(1),
    assigned_to: model.text().nullable(),
    metadata: model.json().nullable(),
    demo: model.boolean().default(false),
    source: model.text().default("store"),
    subject: model.text().nullable(),
    title: model.text().nullable(),
    currency_code: model.text().nullable(),
    requested_amount: model.number().nullable(),
    offered_amount: model.number().nullable(),
    agreed_amount: model.number().nullable(),
    price_amount: model.number().nullable(),
    list_amount: model.number().nullable(),
    items: model.json().nullable(),
    waiting_for: model.text().nullable(),
    last_activity_at: model.dateTime().nullable(),
    message_count: model.number().default(0),
    expires_at: model.dateTime().nullable(),
    closed_at: model.dateTime().nullable(),
    closed_by: model.text().nullable(),
    messages: model.hasMany(() => NegotiationMessage, { mappedBy: "negotiation" }),
  })
  .indexes([
    { on: ["demo", "status", "last_activity_at"], where: "deleted_at IS NULL" },
    { on: ["customer_id", "demo"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
    { on: ["ref"] },
  ])

export default Negotiation
