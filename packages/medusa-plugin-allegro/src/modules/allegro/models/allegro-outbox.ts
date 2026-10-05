import { model } from "@medusajs/framework/utils"

/**
 * Something to send to Allegro once: a parcel number, a seller status or an
 * invoice. UNIQUE per `dedupe_key` (`parcel:<form>:<waybill>`, `status:<form>:SENT`,
 * `invoice:<form>:<document>`), written before anything goes to the network.
 * Claimed atomically with a lease; an unclear answer becomes `unknown` and is
 * looked up on Allegro before anything is sent again.
 *
 * `payload` holds a waybill and a carrier, a status, or a document reference
 * (number, file name, Fakturownia id, an https address). No personal data.
 */
const AllegroOutbox = model
  .define("allegro_outbox", {
    id: model.id({ prefix: "algout" }).primaryKey(),
    writer: model.text(),
    dedupe_key: model.text(),
    checkout_form_id: model.text(),
    order_id: model.text().nullable(),
    payload: model.json().nullable(),
    status: model.text(),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    last_error: model.text().nullable(),
    result: model.json().nullable(),
    done_at: model.dateTime().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["dedupe_key"], unique: true, where: "deleted_at IS NULL" },
    { on: ["writer", "status"], where: "deleted_at IS NULL" },
    { on: ["checkout_form_id"], where: "deleted_at IS NULL" },
  ])

export default AllegroOutbox
