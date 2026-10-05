import { model } from "@medusajs/framework/utils"

/**
 * INVOICE NUMBERS INTO BASELINKER ORDERS, exactly once per document.
 *
 * The Fakturownia plugin emits `fakturownia.document.issued`; a row is
 * written here first (unique per document id and mode), then the armed
 * writer reads the BaseLinker order, writes the number into the chosen order
 * field when it is empty, adopts it when it already holds the same number,
 * and stops with `conflict` when it holds another one. Statuses: pending,
 * written, conflict, skipped, failed.
 */
const BaseLinkerInvoice = model
  .define("baselinker_invoice", {
    id: model.id({ prefix: "blinv" }).primaryKey(),
    document_id: model.text(),
    external_id: model.text().nullable(),
    order_id: model.text(),
    display_id: model.number().nullable(),
    bl_order_id: model.text().nullable(),
    kind: model.text(),
    number: model.text().nullable(),
    field: model.text(),
    status: model.text().default("pending"),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    last_error: model.text().nullable(),
    last_error_code: model.text().nullable(),
    written_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["document_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["status", "next_attempt_at"], where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
  ])

export default BaseLinkerInvoice
