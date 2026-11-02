import { model } from "@medusajs/framework/utils"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN, with who changed them and when, one
 * row per key (lib/settings.ts):
 *
 *   demo:writer:shipment, sandbox:writer:pickup, live:writer:fulfillmentStatus...   writer toggles
 *   demo:settings, sandbox:settings, live:settings                                   the label page
 *   demo:seeded                                                                      the demo shipments were built
 *
 * The key is unique among the rows not deleted (the scope Medusa gives every
 * index, written out); lib/store.ts names the same scope in its `on conflict`.
 */
const DpdSetting = model
  .define("dpd_setting", {
    id: model.id({ prefix: "dpdset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true, where: "deleted_at IS NULL" }])

export default DpdSetting
