import { model } from "@medusajs/framework/utils"
import TasksActivity from "./task-activity"
import TasksComment from "./task-comment"
import TasksLink from "./task-link"

/**
 * ONE TASK, a card on a board.
 *
 *   board        `main` (the team) or `sandbox` (the sandbox accounts)
 *   status       the column: backlog, todo, in_progress, review, done, rejected
 *   priority     low, medium, high, urgent
 *   assignee     the name shown: the admin user's name, or free text (rows of
 *                the KODA Panel module, scripts that name a role)
 *   assignee_id  the admin user, when the task is assigned to one
 *   due_date     a calendar day, stored at 12:00 UTC
 *   tags         an array of strings
 *   position     the order within the column, from 0
 *   completed_at when the task last landed in done or rejected
 *   metadata     `sample` texts of the sandbox, `adopted_from` of old rows
 *
 * The flows write the table with SQL (`lib/store.ts`); the model is here for
 * the module and for custom code that reads through the generated service
 * (`listTasksTasks`).
 */
const TasksTask = model
  .define("tasks_task", {
    id: model.id({ prefix: "task" }).primaryKey(),
    board: model.text().default("main"),
    title: model.text(),
    description: model.text().nullable(),
    status: model.text().default("todo"),
    priority: model.text().default("medium"),
    assignee: model.text().nullable(),
    assignee_id: model.text().nullable(),
    due_date: model.dateTime().nullable(),
    tags: model.json().nullable(),
    position: model.number().default(0),
    completed_at: model.dateTime().nullable(),
    created_by: model.text().nullable(),
    created_by_id: model.text().nullable(),
    metadata: model.json().nullable(),
    comments: model.hasMany(() => TasksComment, { mappedBy: "task" }),
    activity: model.hasMany(() => TasksActivity, { mappedBy: "task" }),
    links: model.hasMany(() => TasksLink, { mappedBy: "task" }),
  })
  .indexes([
    { on: ["board", "status", "position"], where: "deleted_at IS NULL" },
    { on: ["board", "assignee_id"], where: "deleted_at IS NULL" },
  ])

export default TasksTask
