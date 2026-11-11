import { model } from "@medusajs/framework/utils"

/**
 * A KUP TERAZ ORDER AS CENEO REPORTS IT. One row per Ceneo order id (a
 * GUID), written by the sync. No personal data: shipping, invoice and
 * pickup data stay at Ceneo and are read when an order is opened.
 * `medusa_order_id` is set by the import of stage 6.
 */
const CeneoOrder = model
  .define("ceneo_order", {
    id: model.id({ prefix: "cor" }).primaryKey(),
    ceneo_order_id: model.text(),
    displayed_order_id: model.text().nullable(),
    shop_order_id: model.text().nullable(),
    state_id: model.number().nullable(),
    ordered_at: model.dateTime().nullable(),
    /* `{ order, products, delivery }` in PLN, as Ceneo sends them: json, because `model.float` is a 4-byte real. */
    amounts: model.json().nullable(),
    delivery_form: model.text().nullable(),
    payment_type_id: model.number().nullable(),
    payment_method_id: model.number().nullable(),
    items: model.json().nullable(),
    matched: model.boolean().default(false),
    problems: model.json().nullable(),
    medusa_order_id: model.text().nullable(),
    demo: model.boolean().default(false),
    synced_at: model.dateTime(),
  })
  .indexes([
    { on: ["ceneo_order_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["ordered_at"], where: "deleted_at IS NULL" },
  ])

export default CeneoOrder
