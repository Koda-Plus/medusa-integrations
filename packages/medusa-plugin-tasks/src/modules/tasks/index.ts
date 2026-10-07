import { Module } from "@medusajs/framework/utils"
import TasksModuleService from "./service"
import { TASKS_MODULE } from "./lib/constants"

/**
 * Tasks module: the task board of the Medusa admin, with comments, the
 * activity log, links to orders, products and customers, and the sandbox
 * board for demo accounts.
 */
export { TASKS_MODULE }
export type { TasksPluginOptions } from "./lib/options"
/* The contract other code builds on: the events and their data. */
export { COMMENT_CREATED, TASK_CREATED, TASK_DELETED, TASK_EVENTS, TASK_STATUS_CHANGED, TASK_UPDATED } from "./lib/events"
export type { CommentEventData, EventActor, TaskChange, TaskEventData, TaskEventName } from "./lib/events"
export type { AuthorRole, Board, LinkType, TaskPriority, TaskStatus } from "./lib/constants"
export type { ActivityDto, CommentDto, LinkDto, TaskDetailDto, TaskDto } from "./lib/contract"

export default Module(TASKS_MODULE, {
  service: TasksModuleService,
})
