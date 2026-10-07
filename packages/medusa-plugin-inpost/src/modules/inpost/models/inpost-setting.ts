import { model } from "@medusajs/framework/utils"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN, with who changed them and when, one
 * row per key:
 *
 *   demo:writer:shipment, live:writer:fulfillmentStatus...   writer toggles
 *   demo:settings, live:settings                              sender, default parcel, label size
 *   demo:seeded                                               the demo shipments were built
 *   webhook:last                                              the last webhook delivery (time, event)
 */
const InpostSetting = model
  .define("inpost_setting", {
    id: model.id({ prefix: "inset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true }])

export default InpostSetting
