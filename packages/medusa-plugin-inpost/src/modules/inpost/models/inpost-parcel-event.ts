import { model } from "@medusajs/framework/utils"

/**
 * THE HISTORY: every status a shipment went through, every webhook that
 * arrived, every action a person or the plugin took, every status pass.
 *
 *   kind     status | webhook | action | run
 *   source   webhook | poll | create | admin | demo | system
 *
 * A webhook delivery and a status change carry a `dedupe_key` with a unique
 * index: the same delivery twice is one row, which is what keeps the webhook
 * idempotent. Rows older than 120 days are deleted by the status pass.
 */
const InpostParcelEvent = model
  .define("inpost_parcel_event", {
    id: model.id({ prefix: "inpev" }).primaryKey(),
    parcel_id: model.text().nullable(),
    order_id: model.text().nullable(),
    shipment_id: model.text().nullable(),
    kind: model.text(),
    status: model.text().nullable(),
    previous_status: model.text().nullable(),
    source: model.text().nullable(),
    message: model.text().nullable(),
    data: model.json().nullable(),
    actor: model.text().nullable(),
    dedupe_key: model.text().nullable(),
    demo: model.boolean().default(false),
    occurred_at: model.dateTime(),
  })
  .indexes([
    { on: ["dedupe_key"], unique: true, where: "dedupe_key IS NOT NULL AND deleted_at IS NULL" },
    { on: ["parcel_id", "occurred_at"], where: "deleted_at IS NULL" },
    { on: ["kind", "demo", "occurred_at"], where: "deleted_at IS NULL" },
  ])

export default InpostParcelEvent
