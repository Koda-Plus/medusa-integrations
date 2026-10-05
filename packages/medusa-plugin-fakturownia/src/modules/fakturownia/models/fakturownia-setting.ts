import { model } from "@medusajs/framework/utils"

/**
 * SETTINGS A PERSON CHANGES IN THE ADMIN, with who changed them and when.
 * Today: the runtime toggles of the writers (`demo:writer:corrections`,
 * `live:writer:emails`...; see `lib/writers.ts`) and the one-time demo seed
 * of 0.2.0. One row per key.
 */
const FakturowniaSetting = model
  .define("fakturownia_setting", {
    id: model.id({ prefix: "fkset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true }])

export default FakturowniaSetting
