import { model } from "@medusajs/framework/utils"

/**
 * MARKETPLACE ORDERS FROM BASELINKER INTO MEDUSA, exactly once per
 * BaseLinker order id.
 *
 * A row is written when an order is discovered, BEFORE anything is created
 * in Medusa: the unique index on (`bl_order_id`, `demo`) is the first lock.
 * The Medusa order id lands here (and the BaseLinker id on the Medusa order)
 * the moment the order exists, so a retry finds it instead of creating a
 * second one.
 *
 * Statuses: `pending` (discovered, waiting for the armed writer), `imported`,
 * `skipped` (with the reason: imported by another plugin, too old...),
 * `failed` (waiting for a person). `flag` marks what needs a person
 * afterwards, for example `cancel_blocked`: canceled in BaseLinker, but
 * already fulfilled in Medusa.
 *
 * No buyer data here: names, addresses and e-mails live on the Medusa order
 * only. Money is stored in minor units (`total_minor`).
 */
const BaseLinkerImport = model
  .define("baselinker_import", {
    id: model.id({ prefix: "blimp" }).primaryKey(),
    bl_order_id: model.text(),
    source: model.text(),
    source_id: model.text().nullable(),
    external_order_id: model.text().nullable(),
    marketplace_ref: model.text().nullable(),
    status: model.text().default("pending"),
    order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    last_error: model.text().nullable(),
    last_error_code: model.text().nullable(),
    confirmed_at: model.dateTime().nullable(),
    total_minor: model.number().nullable(),
    currency: model.text().nullable(),
    lines: model.number().default(0),
    unlinked_lines: model.number().default(0),
    payment_state: model.text().nullable(),
    bl_status_id: model.number().nullable(),
    bl_status_name: model.text().nullable(),
    tracking_number: model.text().nullable(),
    tracking_url: model.text().nullable(),
    carrier: model.text().nullable(),
    status_checked_at: model.dateTime().nullable(),
    flag: model.text().nullable(),
    imported_at: model.dateTime().nullable(),
    canceled_at: model.dateTime().nullable(),
    fulfilled_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["bl_order_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["status", "next_attempt_at"], where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
    { on: ["marketplace_ref"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerImport
