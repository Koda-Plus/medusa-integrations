import { model } from "@medusajs/framework/utils"

/**
 * The runtime toggle of one writer (`id` is the writer key: stock, orders,
 * shipping, invoices, prices, publish). A person flips it in the admin; the
 * row remembers who and when. The hard switch lives in the plugin options
 * (`writes`) and always wins.
 *
 * `mode` is where the toggle was flipped (demo or live): a writer armed in
 * demo mode does not arm a real account connected later.
 *
 * The circuit breaker writes here too: `failure_streak` counts consecutive
 * systemic failures, and when it reaches the threshold the breaker sets
 * `armed = false` with `tripped_at` and `trip_reason`, so the admin says why.
 */
const AllegroWriter = model.define("allegro_writer", {
  id: model.id().primaryKey(),
  armed: model.boolean().default(false),
  mode: model.text().nullable(),
  changed_by: model.text().nullable(),
  changed_by_id: model.text().nullable(),
  changed_at: model.dateTime().nullable(),
  failure_streak: model.number().default(0),
  last_failure: model.text().nullable(),
  last_failure_at: model.dateTime().nullable(),
  tripped_at: model.dateTime().nullable(),
  trip_reason: model.text().nullable(),
  last_run_at: model.dateTime().nullable(),
  last_success_at: model.dateTime().nullable(),
})

export default AllegroWriter
