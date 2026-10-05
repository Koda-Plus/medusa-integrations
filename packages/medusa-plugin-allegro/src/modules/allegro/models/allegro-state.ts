import { model } from "@medusajs/framework/utils"

/**
 * Small named values the plugin keeps between runs, one row per `id`:
 *
 *   `order_events_cursor`  the last order event read, and when
 *   `carriers`             the carrier list of Allegro, cached for a day
 *   `messages`             unread message threads, the last count
 *   `demo_overlay`         what the demo writers changed in the simulation today
 *   `lease:<name>`         a run lease, taken atomically across processes
 */
const AllegroState = model.define("allegro_state", {
  id: model.id().primaryKey(),
  value: model.json().nullable(),
})

export default AllegroState
