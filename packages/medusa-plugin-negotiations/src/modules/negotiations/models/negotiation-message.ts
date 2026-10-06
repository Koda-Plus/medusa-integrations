import { model } from "@medusajs/framework/utils"
import Negotiation from "./negotiation"

/**
 * ONE MESSAGE OF A THREAD, oldest first. The table keeps the name and the
 * columns of the app module this plugin was extracted from; `kind`,
 * `amount`, `internal` and `metadata` are new.
 *
 *   author_type  customer, admin (the team) or system (the plugin)
 *   kind         message, counter, accepted, rejected, expired, note or
 *                draft_order (see `lib/constants.ts`)
 *   amount       the price the message carries, minor units of the thread
 *   internal     notes and writer records: never shown to the customer
 *   metadata     `text: { en, pl }` for the demo story
 *
 * Old system messages are Polish text ("Kontroferta: 38.5"); the admin
 * reads them by `lib/legacy.ts`.
 */
const NegotiationMessage = model
  .define("negotiation_message", {
    id: model.id({ prefix: "negmsg" }).primaryKey(),
    negotiation: model.belongsTo(() => Negotiation, { mappedBy: "messages" }),
    author_type: model.text().default("system"),
    author_id: model.text().nullable(),
    body: model.text(),
    attachments: model.json().nullable(),
    kind: model.text().default("message"),
    amount: model.number().nullable(),
    internal: model.boolean().default(false),
    metadata: model.json().nullable(),
  })
  .indexes([{ on: ["negotiation_id", "created_at"], where: "deleted_at IS NULL" }])

export default NegotiationMessage
