import { model } from "@medusajs/framework/utils"

/**
 * One Allegro order (checkout form) in the read-only journal.
 *
 * NO PERSONAL DATA: no buyer, no address, no phone, no e-mail, no payment
 * details. `lines` holds the offer, signature, quantity and price of every
 * line plus the variant it was linked to, so the admin needs no joins.
 * Orders stay in Allegro; this table only shows them next to the store.
 */
const AllegroOrder = model
  .define("allegro_order", {
    id: model.id({ prefix: "algord" }).primaryKey(),
    allegro_id: model.text(),
    status: model.text(),
    fulfillment_status: model.text().nullable(),
    total: model.json().nullable(),
    bought_at: model.dateTime().nullable(),
    allegro_updated_at: model.dateTime().nullable(),
    delivery_method: model.text().nullable(),
    line_count: model.number().default(0),
    unmatched_lines: model.number().default(0),
    lines: model.json().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["allegro_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["bought_at"], where: "deleted_at IS NULL" },
  ])

export default AllegroOrder
