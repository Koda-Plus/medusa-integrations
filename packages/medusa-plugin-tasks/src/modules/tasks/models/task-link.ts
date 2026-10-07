import { model } from "@medusajs/framework/utils"
import TasksTask from "./task"

/**
 * A TASK LINKED TO A MEDUSA RECORD: an order, a product or a customer, by
 * id. Labels (the order number, the product title) are read from Medusa when
 * shown, never copied here. One link per task and record.
 */
const TasksLink = model
  .define("tasks_link", {
    id: model.id({ prefix: "tlnk" }).primaryKey(),
    board: model.text().default("main"),
    task: model.belongsTo(() => TasksTask, { mappedBy: "links" }),
    entity_type: model.text(),
    entity_id: model.text(),
    created_by: model.text().nullable(),
    created_by_id: model.text().nullable(),
  })
  .indexes([
    { on: ["task_id", "entity_type", "entity_id"], unique: true, where: "deleted_at IS NULL" },
    { on: ["board", "entity_type", "entity_id"], where: "deleted_at IS NULL" },
  ])

export default TasksLink
