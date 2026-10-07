import { model } from "@medusajs/framework/utils"

/**
 * THE SEND LOG: one row per message the plugin rendered, unique per
 * idempotency key and mode, with what happened to it.
 *
 *   status    sending (claimed, a lease running), sent, failed, unknown (may
 *             have gone out: a timeout, an idempotency conflict), skipped
 *             (the template is off, or no API key)
 *   kind      event, job, test, app (a notification created by other code),
 *             seed (the demo outbox)
 *
 * PERSONAL DATA: the recipient is stored MASKED ("a***@e***.com"), next to
 * a one-way hash of the address (`recipient_hash`, to find the e-mails of one
 * address and to limit password resets per address) and the Medusa customer
 * id when known. The subject is kept (it may hold a first name). The
 * rendered message is kept only in demo mode, for the simulated outbox, with
 * secret fields hidden. Rows older than `logRetentionDays` are deleted every
 * hour.
 */
const EmailsMessage = model
  .define("emails_message", {
    id: model.id({ prefix: "emmsg" }).primaryKey(),
    key: model.text(),
    template: model.text(),
    locale: model.text().nullable(),
    demo: model.boolean().default(false),
    kind: model.text().default("event"),
    status: model.text(),
    recipient: model.text().nullable(),
    subject: model.text().nullable(),
    trigger: model.text().nullable(),
    resource_type: model.text().nullable(),
    resource_id: model.text().nullable(),
    order_id: model.text().nullable(),
    notification_id: model.text().nullable(),
    external_id: model.text().nullable(),
    resend_key: model.text().nullable(),
    rotation: model.number().default(0),
    attempts: model.number().default(0),
    error_code: model.text().nullable(),
    error: model.text().nullable(),
    retryable: model.boolean().default(false),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    sent_at: model.dateTime().nullable(),
    requested_by: model.text().nullable(),
    body_html: model.text().nullable(),
    body_text: model.text().nullable(),
    customer_id: model.text().nullable(),
    recipient_hash: model.text().nullable(),
  })
  .indexes([
    { on: ["key", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["demo", "created_at"], where: "deleted_at IS NULL" },
    { on: ["template", "demo", "created_at"], where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
    { on: ["status", "demo"], where: "deleted_at IS NULL" },
    { on: ["customer_id", "demo"], where: "deleted_at IS NULL AND customer_id IS NOT NULL" },
    { on: ["recipient_hash", "template", "demo", "created_at"], where: "deleted_at IS NULL AND recipient_hash IS NOT NULL" },
  ])

export default EmailsMessage
