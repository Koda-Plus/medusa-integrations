import { model } from "@medusajs/framework/utils"

/**
 * THE HISTORY: every status a shipment went through, every action a person
 * or the plugin took, every status pass.
 *
 *   kind     status | action | run
 *   source   poll | queue | create | admin | demo | system
 *
 * A status carries a `dedupe_key` with a unique index: the same event read
 * twice (a repeated poll, a queue that was not confirmed) is one row.
 * `object_id` is the id InfoServices gives an event, so a later CANCEL of
 * that event can find it.
 */
const DpdEvent = model
  .define("dpd_event", {
    id: model.id({ prefix: "dpdevt" }).primaryKey(),
    shipment_id: model.text().nullable(),
    dispatch_id: model.text().nullable(),
    order_id: model.text().nullable(),
    waybill: model.text().nullable(),
    kind: model.text(),
    status: model.text().nullable(),
    previous_status: model.text().nullable(),
    source: model.text().nullable(),
    message: model.text().nullable(),
    data: model.json().nullable(),
    actor: model.text().nullable(),
    dedupe_key: model.text().nullable(),
    object_id: model.text().nullable(),
    mode: model.text(),
    occurred_at: model.dateTime(),
  })
  .indexes([
    { on: ["dedupe_key"], unique: true, where: "dedupe_key IS NOT NULL AND deleted_at IS NULL" },
    { on: ["shipment_id", "occurred_at"], where: "deleted_at IS NULL" },
    { on: ["object_id"], where: "object_id IS NOT NULL AND deleted_at IS NULL" },
    { on: ["kind", "mode", "occurred_at"], where: "deleted_at IS NULL" },
  ])

export default DpdEvent
