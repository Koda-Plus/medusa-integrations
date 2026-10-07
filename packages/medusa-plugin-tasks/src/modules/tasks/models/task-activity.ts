import { model } from "@medusajs/framework/utils"
import TasksTask from "./task"

/**
 * THE ACTIVITY LOG of a task, append only: created, moved, assigned,
 * commented, linked, unlinked, updated. `metadata` holds the facts (from and
 * to); `message` a short English line for scripts. Rows of the KODA Panel
 * module keep their own text.
 */
const TasksActivity = model
  .define("tasks_activity", {
    id: model.id({ prefix: "tact" }).primaryKey(),
    board: model.text().default("main"),
    task: model.belongsTo(() => TasksTask, { mappedBy: "activity" }),
    type: model.text(),
    message: model.text().nullable(),
    actor: model.text().nullable(),
    actor_id: model.text().nullable(),
    actor_type: model.text().nullable(),
    metadata: model.json().nullable(),
  })
  .indexes([
    { on: ["task_id", "created_at"], where: "deleted_at IS NULL" },
    { on: ["board", "created_at"], where: "deleted_at IS NULL" },
  ])

export default TasksActivity
