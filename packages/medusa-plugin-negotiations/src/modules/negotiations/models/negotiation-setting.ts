import { model } from "@medusajs/framework/utils"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN, with who changed them and when:
 * the writer toggles (`live:writer:draftOrders`, `demo:writer:draftOrders`)
 * and the marker of the demo story (`demo:story`). One row per key.
 */
const NegotiationSetting = model
  .define("negotiation_setting", {
    id: model.id({ prefix: "negset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true }])

export default NegotiationSetting
