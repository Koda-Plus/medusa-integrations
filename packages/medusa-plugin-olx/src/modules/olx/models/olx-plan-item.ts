import { model } from "@medusajs/framework/utils"

/**
 * One planned write of the lifecycle or the price writer, ONE ROW PER ADVERT
 * AND WRITER (unique). The row is the plan (action, from, to), the state of
 * its application (pending, held, applying, done, failed, quarantined,
 * unknown, idle) and, for the lifecycle writer, the memory that the plugin
 * paused this advert (`paused_at`): only such adverts are ever reactivated.
 *
 * `claim_token` and `lease_until` belong to the one process that applies the
 * row (atomic claim in `lib/store.ts`). A lease that runs out turns the row
 * `unknown`, and an unknown row is read on OLX before anything else happens.
 */
const OlxPlanItem = model
  .define("olx_plan_item", {
    id: model.id({ prefix: "olxpi" }).primaryKey(),
    writer: model.text(),
    olx_id: model.text(),
    action: model.text(),
    reason: model.text().nullable(),
    from_value: model.json().nullable(),
    to_value: model.json().nullable(),
    approved_value: model.json().nullable(),
    state: model.text().default("pending"),
    attempts: model.number().default(0),
    last_error: model.text().nullable(),
    note: model.text().nullable(),
    planned_at: model.dateTime().nullable(),
    last_attempt_at: model.dateTime().nullable(),
    done_at: model.dateTime().nullable(),
    paused_at: model.dateTime().nullable(),
    unknown_since: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    title: model.text().nullable(),
    variant_id: model.text().nullable(),
    product_id: model.text().nullable(),
    sku: model.text().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["writer", "olx_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["state"], where: "deleted_at IS NULL" },
    { on: ["product_id"], where: "deleted_at IS NULL" },
  ])

export default OlxPlanItem
