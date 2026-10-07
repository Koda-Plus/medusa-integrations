import { model } from "@medusajs/framework/utils"

/**
 * STATE OF THE MODULE, one row per key: the seed of the sandbox board
 * (`sandbox:seed`) and the adoption of the KODA Panel module's rows
 * (`legacy:adoption`, written by the migration).
 */
const TasksSetting = model
  .define("tasks_setting", {
    id: model.id({ prefix: "tset" }).primaryKey(),
    key: model.text(),
    value: model.json().nullable(),
    updated_by: model.text().nullable(),
  })
  .indexes([{ on: ["key"], unique: true }])

export default TasksSetting
