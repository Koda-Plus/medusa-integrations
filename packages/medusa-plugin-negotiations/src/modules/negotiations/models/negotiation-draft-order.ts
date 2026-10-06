import { model } from "@medusajs/framework/utils"

/**
 * THE DRAFT ORDER OUTBOX: one row per accepted thread the draft order writer
 * is asked to handle, and what came of it.
 *
 *   pending   queued (accepted while the writer was armed, or by a person)
 *   creating  claimed by one process, with a token and a lease
 *   created   the draft order exists (`draft_order_id`, `display_id`)
 *   failed    Medusa refused; retried a few times, then it waits for a person
 *   unknown   the process stopped mid-create; looked up before anything else
 *   blocked   the thread cannot become a draft (`error` says why)
 *
 * A unique index on (negotiation_id, demo) makes a second row for a thread
 * impossible, and the claim is one conditional update: a draft order is
 * created at most once per thread.
 */
const NegotiationDraftOrder = model
  .define("negotiation_draft_order", {
    id: model.id({ prefix: "negdo" }).primaryKey(),
    negotiation_id: model.text(),
    demo: model.boolean().default(false),
    state: model.text().default("pending"),
    draft_order_id: model.text().nullable(),
    display_id: model.number().nullable(),
    error: model.text().nullable(),
    attempts: model.number().default(0),
    claim_token: model.text().nullable(),
    claimed_at: model.dateTime().nullable(),
    lease_until: model.dateTime().nullable(),
    payload: model.json().nullable(),
    requested_by: model.text().nullable(),
  })
  .indexes([
    { on: ["negotiation_id", "demo"], unique: true, where: "deleted_at IS NULL" },
    { on: ["demo", "state"], where: "deleted_at IS NULL" },
  ])

export default NegotiationDraftOrder
