import { model } from "@medusajs/framework/utils"

/**
 * One sync run: where the adverts came from, whether the read was complete
 * and what changed. The admin shows the latest runs; older ones are pruned.
 *
 * `complete = false` is the most important flag here: an incomplete read
 * adds and updates links but never removes one, because an advert missing
 * from a broken list looks exactly like an ended one.
 */
const OlxSyncRun = model.define("olx_sync_run", {
  id: model.id({ prefix: "olxrun" }).primaryKey(),
  source: model.text(),
  trigger: model.text(),
  status: model.text(),
  complete: model.boolean().default(false),
  pages: model.number().default(0),
  adverts: model.number().default(0),
  statuses: model.json().nullable(),
  linked: model.number().default(0),
  linked_live: model.number().default(0),
  unmatched_live: model.number().default(0),
  created_count: model.number().default(0),
  updated_count: model.number().default(0),
  removed_count: model.number().default(0),
  message: model.text().nullable(),
  duration_ms: model.number().default(0),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
})

export default OlxSyncRun
