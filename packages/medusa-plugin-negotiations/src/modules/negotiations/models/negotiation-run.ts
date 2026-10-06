import { model } from "@medusajs/framework/utils"

/**
 * THE HISTORY OF BACKGROUND RUNS for Settings: expiry passes, draft order
 * writer runs and rebuilds of the demo story, with their counts. The last
 * 50 of each kind and mode are kept.
 */
const NegotiationRun = model
  .define("negotiation_run", {
    id: model.id({ prefix: "negrun" }).primaryKey(),
    kind: model.text(),
    trigger: model.text(),
    status: model.text(),
    demo: model.boolean().default(false),
    counts: model.json().nullable(),
    message: model.text().nullable(),
    started_at: model.dateTime(),
    finished_at: model.dateTime().nullable(),
    duration_ms: model.number().default(0),
  })
  .indexes([{ on: ["kind", "demo", "started_at"], where: "deleted_at IS NULL" }])

export default NegotiationRun
