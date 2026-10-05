import { model } from "@medusajs/framework/utils"

/**
 * One run of a writer: a dry run (what would be sent) or an applied run (what
 * was sent and what OLX answered). Counters plus up to 50 item results; the
 * admin shows the latest runs per writer, older ones are pruned.
 */
const OlxWriterRun = model.define("olx_writer_run", {
  id: model.id({ prefix: "olxwr" }).primaryKey(),
  writer: model.text(),
  mode: model.text(),
  trigger: model.text(),
  status: model.text(),
  planned: model.number().default(0),
  attempted: model.number().default(0),
  succeeded: model.number().default(0),
  failed: model.number().default(0),
  quarantined: model.number().default(0),
  unknown: model.number().default(0),
  skipped: model.number().default(0),
  message: model.text().nullable(),
  items: model.json().nullable(),
  actor: model.text().nullable(),
  duration_ms: model.number().default(0),
  started_at: model.dateTime(),
  finished_at: model.dateTime().nullable(),
  demo: model.boolean().default(false),
})

export default OlxWriterRun
