import { model } from "@medusajs/framework/utils"

/**
 * One background run: a catalog read, a stock plan, a pass of the order
 * outbox or a status read. The admin shows the latest runs; each kind keeps
 * its last 50.
 *
 * `complete = false` on a catalog run is the most important flag here: an
 * incomplete read adds and updates links but never removes one, and never
 * plans stock, because a card missing from a broken list looks exactly like
 * a deleted one.
 */
const BaseLinkerSyncRun = model
  .define("baselinker_sync_run", {
    id: model.id({ prefix: "blrun" }).primaryKey(),
    kind: model.text(),
    source: model.text(),
    trigger: model.text(),
    status: model.text(),
    complete: model.boolean().default(false),
    counts: model.json().nullable(),
    message: model.text().nullable(),
    duration_ms: model.number().default(0),
    started_at: model.dateTime(),
    finished_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["kind", "started_at"], where: "deleted_at IS NULL" }])

export default BaseLinkerSyncRun
