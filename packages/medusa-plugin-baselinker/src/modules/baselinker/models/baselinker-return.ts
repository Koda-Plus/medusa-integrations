import { model } from "@medusajs/framework/utils"

/**
 * RETURNS FROM BASELINKER, READ ONLY: a snapshot of the return manager,
 * linked to the Medusa order when the BaseLinker order is one this plugin
 * sent or imported. Refreshed by every read of the window.
 *
 * NO PERSONAL DATA: the buyer's e-mail, phone, address and bank account that
 * BaseLinker returns are dropped before anything is stored. Products keep
 * name, SKU, quantity, price and the reason.
 */
const BaseLinkerReturn = model
  .define("baselinker_return", {
    id: model.id({ prefix: "blret" }).primaryKey(),
    bl_return_id: model.text(),
    bl_order_id: model.text().nullable(),
    order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    source: model.text().nullable(),
    external_return_id: model.text().nullable(),
    status_id: model.number().nullable(),
    status_name: model.text().nullable(),
    fulfillment_status: model.number().nullable(),
    refunded_minor: model.number().nullable(),
    currency: model.text().nullable(),
    products: model.json().nullable(),
    created_in_bl_at: model.dateTime().nullable(),
    status_changed_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["bl_return_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerReturn
