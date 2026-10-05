import { model } from "@medusajs/framework/utils"

/**
 * A customer return, a dispute or a claim, as Allegro reports it. Read only:
 * the plugin never answers, accepts or rejects anything.
 *
 * Stored: ids, the status, the reason CODE, dates, the item count and the
 * checkout form id (to link the imported Medusa order). Never stored: the
 * buyer, the description, the chat or the attachments.
 */
const AllegroIssue = model
  .define("allegro_issue", {
    id: model.id({ prefix: "algiss" }).primaryKey(),
    kind: model.text(),
    allegro_id: model.text(),
    checkout_form_id: model.text().nullable(),
    status: model.text(),
    reason_code: model.text().nullable(),
    reference_number: model.text().nullable(),
    opened_at: model.dateTime().nullable(),
    due_at: model.dateTime().nullable(),
    needs_reply: model.boolean().default(false),
    is_open: model.boolean().default(true),
    items: model.number().default(0),
    last_message_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["kind", "allegro_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["checkout_form_id"], where: "deleted_at IS NULL" },
  ])

export default AllegroIssue
