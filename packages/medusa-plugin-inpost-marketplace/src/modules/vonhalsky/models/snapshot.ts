import { model } from "@medusajs/framework/utils"

/**
 * ONE DAY OF THE CHANNEL: offers per marketplace status, stock, and the
 * counts of the price program and of promotions, as they stood that day.
 * The seller API keeps events for 72 hours only, so the history of the
 * offers lives here. Orders need no snapshot: their rows stay.
 */
const VonHalskySnapshot = model
  .define("vonhalsky_snapshot", {
    id: model.id({ prefix: "vhsnap" }).primaryKey(),
    /** YYYY-MM-DD (UTC). */
    day: model.text(),
    data: model.json(),
    demo: model.boolean().default(false),
  })
  .indexes([{ on: ["day"], unique: true, where: "deleted_at IS NULL" }])

export default VonHalskySnapshot
