import { model } from "@medusajs/framework/utils"

/**
 * THE ORDER OUTBOX, and what BaseLinker did with each order afterwards.
 *
 * A row is written on `order.placed` BEFORE anything goes to the network, so
 * an order placed while BaseLinker is down is sent when it is back, without
 * anyone resending it by hand. A failure leaves `pending` with a later
 * `next_attempt_at`; after the backoff runs out, `failed`, waiting for a
 * person and the "Send again" button. A row never disappears by itself.
 *
 * NO PAYLOAD IS STORED. The `addOrder` payload carries the buyer's name,
 * address, phone and tax id; it is rebuilt from the order at send time. The
 * row holds ids, statuses, tracking and errors.
 *
 * Statuses: `pending`, `sent` (`bl_order_id` set), `failed`, `skipped`
 * (`order.metadata.baselinker_skip`, or canceled before it reached
 * BaseLinker). One row per order and mode: the unique index makes two
 * subscribers racing for the same order meet on the same row, and `demo`
 * keeps the simulated queue apart.
 *
 * The second half is the way back: status, tracking and the fulfillment
 * created from a closing status.
 */
const BaseLinkerOrder = model
  .define("baselinker_order", {
    id: model.id({ prefix: "blord" }).primaryKey(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    status: model.text().default("pending"),
    bl_order_id: model.text().nullable(),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    last_error: model.text().nullable(),
    last_error_code: model.text().nullable(),
    sent_at: model.dateTime().nullable(),
    bl_status_id: model.number().nullable(),
    bl_status_name: model.text().nullable(),
    tracking_number: model.text().nullable(),
    tracking_url: model.text().nullable(),
    carrier: model.text().nullable(),
    status_checked_at: model.dateTime().nullable(),
    fulfilled_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["order_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["status", "next_attempt_at"], where: "deleted_at IS NULL" },
    { on: ["bl_order_id"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerOrder
