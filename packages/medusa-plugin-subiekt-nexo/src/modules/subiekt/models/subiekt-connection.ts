import { model } from "@medusajs/framework/utils"

/**
 * State of the link to the bridge. ONE ROW with a fixed id (`CONNECTION_ID`):
 * the last health answer, the last failure and the position in the bridge's
 * event feed.
 *
 * `events_cursor` is text, not a number: bridge event ids are 64-bit
 * integers and an `integer` column would overflow on the first big one.
 */
const SubiektConnection = model.define("subiekt_connection", {
  id: model.id().primaryKey(),
  reachable: model.boolean().default(false),
  health: model.json().nullable(),
  checked_at: model.dateTime().nullable(),
  last_error: model.text().nullable(),
  last_error_at: model.dateTime().nullable(),
  consecutive_failures: model.number().default(0),
  events_cursor: model.text().nullable(),
  events_read_at: model.dateTime().nullable(),
})

export default SubiektConnection
