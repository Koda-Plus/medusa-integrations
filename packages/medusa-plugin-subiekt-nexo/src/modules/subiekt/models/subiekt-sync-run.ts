import { model } from "@medusajs/framework/utils"

/**
 * One run of a background job: a stock sync, an event feed read or a health
 * check. The admin shows the latest runs per kind; older ones are pruned.
 * `stats` holds counters and a few examples (unmatched SKUs, conflicts).
 */
const SubiektSyncRun = model.define("subiekt_sync_run", {
  id: model.id({ prefix: "sbrun" }).primaryKey(),
  kind: model.text(),
  trigger: model.text(),
  status: model.text(),
  dry_run: model.boolean().default(false),
  message: model.text().nullable(),
  stats: model.json().nullable(),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
  duration_ms: model.number().default(0),
  demo: model.boolean().default(false),
})

export default SubiektSyncRun
