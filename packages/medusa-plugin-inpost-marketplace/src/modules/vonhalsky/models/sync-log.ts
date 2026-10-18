import { model } from "@medusajs/framework/utils"

/**
 * ONE LINE OF THE SYNC LOG: what the plugin did (offers built or listed, an
 * order imported or held, tracking sent), with the outcome and a short
 * message. Kept 30 days.
 */
const VonHalskySyncLog = model
  .define("vonhalsky_sync_log", {
    id: model.id({ prefix: "vhlog" }).primaryKey(),
    /** offers, orders, tracking, settings */
    area: model.text(),
    /** What was done: refresh, list, unlist, import, simulate, send, save... */
    action: model.text(),
    /** ok, warning, error */
    outcome: model.text().default("ok"),
    message: model.text(),
    count: model.number().nullable(),
    /** A row of demo mode. */
    demo: model.boolean().default(false),
    /** Ids the line is about (an order id, offer ids), never personal data. */
    refs: model.json().nullable(),
  })
  .indexes([
    { on: ["created_at"], where: "deleted_at IS NULL" },
    { on: ["outcome"], where: "deleted_at IS NULL" },
  ])

export default VonHalskySyncLog
