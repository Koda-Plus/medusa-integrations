import { model } from "@medusajs/framework/utils"

/**
 * One Allegro checkout form on its way into Medusa. UNIQUE per checkout form:
 * the row exists before anything is created, and it is the memory of the
 * import (pending, importing, imported, held, skipped, cancelled, unknown).
 *
 * Claims are atomic SQL updates (`lib/store.ts`): `claim_token` and
 * `lease_until` belong to the process importing the form right now. A lease
 * that runs out turns the row `unknown`, and the next attempt looks the
 * order up in Medusa before it creates anything.
 *
 * NO PERSONAL DATA HERE: ids, statuses, amounts and reasons only. The
 * buyer's name, address and e-mail land in the Medusa order, like any order
 * placed in the store, and nowhere else.
 */
const AllegroOrderImport = model
  .define("allegro_order_import", {
    id: model.id({ prefix: "algimp" }).primaryKey(),
    checkout_form_id: model.text(),
    status: model.text(),
    source: model.text(),
    reason_code: model.text().nullable(),
    reason: model.text().nullable(),
    order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    allegro_status: model.text().nullable(),
    fulfillment_status: model.text().nullable(),
    payment_type: model.text().nullable(),
    paid: model.boolean().default(false),
    total: model.json().nullable(),
    medusa_total: model.json().nullable(),
    total_mismatch: model.boolean().default(false),
    line_count: model.number().default(0),
    bought_at: model.dateTime().nullable(),
    last_event_id: model.text().nullable(),
    last_event_type: model.text().nullable(),
    attempts: model.number().default(0),
    next_attempt_at: model.dateTime().nullable(),
    claim_token: model.text().nullable(),
    lease_until: model.dateTime().nullable(),
    attention: model.text().nullable(),
    cancel_requested: model.boolean().default(false),
    refresh_requested: model.boolean().default(false),
    cancelled_on_allegro_at: model.dateTime().nullable(),
    imported_at: model.dateTime().nullable(),
    details: model.json().nullable(),
    demo: model.boolean().default(false),
  })
  .indexes([
    { on: ["checkout_form_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["status"], where: "deleted_at IS NULL" },
    { on: ["order_id"], where: "deleted_at IS NULL" },
  ])

export default AllegroOrderImport
