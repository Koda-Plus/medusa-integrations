import { model } from "@medusajs/framework/utils"

/**
 * One line of a plan: what the stock push, the price push or the publish by
 * EAN would change, from what to what, and why. One row per kind and target
 * (an Allegro offer id, or a variant id for publish), kept between runs so
 * the failures of an item are counted across runs and the item can be
 * quarantined. A plan run rewrites the rows; an apply run moves them to
 * `applied` or `failed`.
 *
 * `current` and `target` are small json values: `{ quantity }`, `{ amount,
 * currency }`, or the catalog product for publish. No personal data.
 */
const AllegroPlanItem = model
  .define("allegro_plan_item", {
    id: model.id({ prefix: "algpln" }).primaryKey(),
    kind: model.text(),
    target_key: model.text(),
    allegro_id: model.text().nullable(),
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),
    sku: model.text().nullable(),
    title: model.text().nullable(),
    action: model.text(),
    reason: model.text(),
    status: model.text(),
    current: model.json().nullable(),
    target: model.json().nullable(),
    failures: model.number().default(0),
    last_error: model.text().nullable(),
    command_id: model.text().nullable(),
    planned_at: model.dateTime().nullable(),
    applied_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["kind", "target_key"], unique: true, where: "deleted_at IS NULL" },
    { on: ["kind", "status"], where: "deleted_at IS NULL" },
  ])

export default AllegroPlanItem
