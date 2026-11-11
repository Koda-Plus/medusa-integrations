import { model } from "@medusajs/framework/utils"

/**
 * A CPC BID AND A PROMOTION TEXT, per product (the feed offer id) or per
 * Ceneo category, in one mode (demo or live). Bids in grosze (integers).
 *
 *   target_bid / promo_text     what a person wants
 *   current_bid / promo_applied what Ceneo has, as last read or written
 *   planned_bid / plan_reasons  the next step of the bids writer
 *   top10                       the competition as last read (shop names,
 *                               prices, positions; no personal data)
 */
const CeneoBid = model
  .define("ceneo_bid", {
    id: model.id({ prefix: "cbd" }).primaryKey(),
    kind: model.text(),
    key: model.text(),
    ceneo_product_id: model.text().nullable(),
    name: model.text().nullable(),
    current_bid: model.number().nullable(),
    click_rate: model.number().nullable(),
    min_suggested_bid: model.number().nullable(),
    target_bid: model.number().nullable(),
    planned_bid: model.number().nullable(),
    plan_reasons: model.json().nullable(),
    target_by: model.text().nullable(),
    target_at: model.dateTime().nullable(),
    promo_text: model.text().nullable(),
    promo_applied: model.text().nullable(),
    promo_pending: model.boolean().default(false),
    promo_at: model.dateTime().nullable(),
    top10: model.json().nullable(),
    offers_number: model.number().nullable(),
    position: model.number().nullable(),
    lowest_price: model.json().nullable(),
    applied_at: model.dateTime().nullable(),
    error: model.text().nullable(),
    error_at: model.dateTime().nullable(),
    read_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["kind", "key", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["read_at"], where: "deleted_at IS NULL" },
  ])

export default CeneoBid
