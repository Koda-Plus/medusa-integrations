import { model } from "@medusajs/framework/utils"
import TasksTask from "./task"

/**
 * ONE COMMENT on a task, oldest first.
 *
 *   author       the display name: the admin user's name, or the name a
 *                script or AI agent sent (`author` in its request)
 *   author_role  agency, client (the store team) or claude (a secret API key:
 *                a script or an AI agent, shown as "AI agent"), the values of
 *                the KODA Panel module
 *   author_id    the admin user id or the API key id
 *   author_type  user, api-key or system
 *   metadata     `sample` texts of the sandbox, `adopted_from` of old rows
 */
const TasksComment = model
  .define("tasks_comment", {
    id: model.id({ prefix: "tcom" }).primaryKey(),
    board: model.text().default("main"),
    task: model.belongsTo(() => TasksTask, { mappedBy: "comments" }),
    body: model.text(),
    author: model.text().nullable(),
    author_role: model.text().default("agency"),
    author_id: model.text().nullable(),
    author_type: model.text().nullable(),
    metadata: model.json().nullable(),
    edited_at: model.dateTime().nullable(),
  })
  .indexes([{ on: ["task_id", "created_at"], where: "deleted_at IS NULL" }])

export default TasksComment
