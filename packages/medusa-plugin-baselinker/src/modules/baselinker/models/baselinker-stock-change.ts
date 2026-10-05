import { model } from "@medusajs/framework/utils"

/**
 * THE LATEST STOCK PLAN, one row per inventory level that would change.
 * Replaced after every complete catalog read, so the admin always shows what
 * BaseLinker would do to Medusa right now: Medusa stocked and reserved, the
 * BaseLinker number, the target and the units added or removed.
 *
 * In `plan` mode every row stays `planned`. In `write` mode the rows within
 * `maxStockChangesPerRun` become `applied` with `after_stocked` read back from
 * Medusa, the rest `over_cap` (they go in the next run).
 */
const BaseLinkerStockChange = model
  .define("baselinker_stock_change", {
    id: model.id({ prefix: "blstk" }).primaryKey(),
    run_id: model.text().nullable(),
    variant_id: model.text(),
    product_id: model.text().nullable(),
    sku: model.text().nullable(),
    product_title: model.text().nullable(),
    bl_product_id: model.text(),
    inventory_item_id: model.text(),
    location_id: model.text(),
    level_id: model.text().nullable(),
    medusa_stocked: model.number().nullable(),
    medusa_reserved: model.number().default(0),
    bl_stock: model.number(),
    target: model.number(),
    delta: model.number(),
    kind: model.text(),
    status: model.text().default("planned"),
    after_stocked: model.number().nullable(),
    applied_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([{ on: ["demo", "delta"], where: "deleted_at IS NULL" }])

export default BaseLinkerStockChange
