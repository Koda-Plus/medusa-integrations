import { model } from "@medusajs/framework/utils"

/**
 * FAILURES PER ITEM, across runs. An item that fails `quarantineAfter` runs
 * in a row (3 by default) is quarantined: the plans keep showing it, no
 * writer touches it, and a person releases it in the admin after fixing the
 * cause. A success resets the count. One row per writer kind and item.
 */
const BaseLinkerQuarantine = model
  .define("baselinker_quarantine", {
    id: model.id({ prefix: "blqua" }).primaryKey(),
    kind: model.text(),
    item_key: model.text(),
    label: model.text().nullable(),
    failures: model.number().default(0),
    last_error: model.text().nullable(),
    quarantined_at: model.dateTime().nullable(),
    released_at: model.dateTime().nullable(),
    released_by: model.text().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([{ on: ["kind", "item_key", "demo"], unique: true, where: "deleted_at IS NULL" }])

export default BaseLinkerQuarantine
