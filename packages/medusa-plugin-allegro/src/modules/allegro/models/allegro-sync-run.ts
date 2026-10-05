import { model } from "@medusajs/framework/utils"

/**
 * One run of the offer sync or the order journal: where the data came from,
 * whether the read was complete and what changed. The admin shows the latest
 * runs; older ones are pruned.
 *
 * `complete = false` is the most important flag here: an incomplete offer
 * read adds and updates links but never removes one, because an offer
 * missing from a broken list looks exactly like an ended one.
 */
const AllegroSyncRun = model.define("allegro_sync_run", {
  id: model.id({ prefix: "algrun" }).primaryKey(),
  kind: model.text(),
  source: model.text(),
  trigger: model.text(),
  status: model.text(),
  complete: model.boolean().default(false),
  pages: model.number().default(0),
  items: model.number().default(0),
  statuses: model.json().nullable(),
  linked: model.number().default(0),
  linked_live: model.number().default(0),
  unmatched_live: model.number().default(0),
  issues: model.number().default(0),
  created_count: model.number().default(0),
  updated_count: model.number().default(0),
  removed_count: model.number().default(0),
  message: model.text().nullable(),
  duration_ms: model.number().default(0),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
})

export default AllegroSyncRun
