import { model } from "@medusajs/framework/utils"

/**
 * THE LATEST PLAN OF EACH WRITER, one row per item that would change (or
 * that cannot, and why). Replaced by every planning run of its kind:
 *
 *   catalog_import   BaseLinker products into Medusa (create, update, draft)
 *   cards            Medusa variants into BaseLinker cards (create, update)
 *   stock_push       Medusa stock into the BaseLinker warehouse
 *   prices           Medusa prices into the BaseLinker price group
 *
 * `action`: create, update, draft, skip or conflict. `changes` lists the
 * fields one by one ({ field, from, to }), so a person reads exactly what an
 * armed writer would do. `status`: planned, applied, failed, over_cap (left
 * for the next run), quarantined, or info (a skip or a conflict). Nothing
 * here is personal data.
 */
const BaseLinkerPlanItem = model
  .define("baselinker_plan_item", {
    id: model.id({ prefix: "blpln" }).primaryKey(),
    kind: model.text(),
    run_id: model.text().nullable(),
    item_key: model.text(),
    action: model.text(),
    status: model.text().default("planned"),
    reason: model.text().nullable(),
    label: model.text().nullable(),
    sku: model.text().nullable(),
    product_id: model.text().nullable(),
    variant_id: model.text().nullable(),
    bl_product_id: model.text().nullable(),
    changes: model.json().nullable(),
    error: model.text().nullable(),
    applied_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["kind", "demo", "status"], where: "deleted_at IS NULL" },
    { on: ["kind", "demo", "action"], where: "deleted_at IS NULL" },
    { on: ["variant_id"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerPlanItem
