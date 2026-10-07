/**
 * MEDUSA WORKFLOWS AROUND THE CHANGES, for custom code: a subscriber that
 * opens a task when an order is flagged, a job that comments on stale tasks,
 * a script run with `medusa exec`.
 *
 *   const { result } = await createTaskWorkflow(container).run({
 *     input: { task: { title: "Call the customer back", links: [{ type: "order", id: order.id }] }, actor_name: "Order watcher" },
 *   })
 *
 * The bodies are the same as the admin API's. The board is `main` unless
 * the input names `sandbox`; with `user_id` the change is made as that admin
 * user, on that user's board (a sandbox account's id lands on the sandbox
 * board, whatever `board` says). Without a user the change is made by the
 * plugin (`system`) under `actor_name`, with the role `actor_role` (default
 * `claude`, an automation).
 *
 * DELIBERATELY WITHOUT COMPENSATIONS: a change is announced by its event as
 * soon as it is stored, and a later change answers it rather than a silent
 * undo.
 */

import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { SANDBOX_BOARD, MAIN_BOARD, isRole } from "../../modules/tasks/lib/constants"
import { systemActor, userContext, type RequestContext } from "../../modules/tasks/lib/actor"
import type { CommentDto, LinkDto, TaskDto } from "../../modules/tasks/lib/contract"
import { cleanDisplayName } from "../../modules/tasks/lib/text"
import { userProfile } from "./context"
import { addComment, addLink, createTask, deleteTask, moveTask, updateTask } from "./tasks"
import { ActionError, envOf, type Scope } from "./runtime"

/** Who makes the change and on which board, for custom code. */
export interface WorkflowActorInput {
  /** `main` (default) or `sandbox`. Ignored with `user_id`. */
  board?: "main" | "sandbox"
  /** Make the change as this admin user, on their board. */
  user_id?: string
  /** The name the change is logged under when there is no user, like "Order watcher". */
  actor_name?: string
  /**
   * The role comments read as when there is no user: `claude` (default, an
   * automation, shown as "AI agent"), `agency` or `client` (the store team).
   */
  actor_role?: "agency" | "client" | "claude"
}

async function contextFor(scope: Scope, input: WorkflowActorInput): Promise<RequestContext> {
  if (input.user_id) {
    const profile = await userProfile(scope, input.user_id)
    if (!profile) throw new ActionError(404, "not_found", "Admin user not found.")
    return userContext(profile, envOf(scope).options)
  }
  const board = input.board === SANDBOX_BOARD ? SANDBOX_BOARD : MAIN_BOARD
  const role = input.actor_role && isRole(input.actor_role) ? input.actor_role : "claude"
  return { board, sandbox: board === SANDBOX_BOARD, actor: systemActor(cleanDisplayName(input.actor_name), role) }
}

/* ------------------------------------------------------------------ */

export interface CreateTaskInput extends WorkflowActorInput {
  /** The same body as `POST /admin/tasks/tasks`. */
  task: Record<string, unknown>
}

export const createTaskStep = createStep("tasks-create-task-step", async (input: CreateTaskInput, { container }) => {
  const task: TaskDto = await createTask(container, await contextFor(container, input), input.task)
  return new StepResponse(task)
})

export const createTaskWorkflow = createWorkflow("tasks-create-task", (input: CreateTaskInput) => {
  return new WorkflowResponse(createTaskStep(input))
})

/* ------------------------------------------------------------------ */

export interface UpdateTaskInput extends WorkflowActorInput {
  id: string
  /** The same body as `POST /admin/tasks/tasks/:id`. */
  update: Record<string, unknown>
}

export const updateTaskStep = createStep("tasks-update-task-step", async (input: UpdateTaskInput, { container }) => {
  const task: TaskDto = await updateTask(container, await contextFor(container, input), input.id, input.update)
  return new StepResponse(task)
})

export const updateTaskWorkflow = createWorkflow("tasks-update-task", (input: UpdateTaskInput) => {
  return new WorkflowResponse(updateTaskStep(input))
})

/* ------------------------------------------------------------------ */

export interface MoveTaskInput extends WorkflowActorInput {
  id: string
  status: string
  /** Place the task right after this one in its new column. */
  after_id?: string | null
  /** Or right before this one. Neither: at the end of the column. */
  before_id?: string | null
}

export const moveTaskStep = createStep("tasks-move-task-step", async (input: MoveTaskInput, { container }) => {
  const task: TaskDto = await moveTask(container, await contextFor(container, input), input.id, {
    status: input.status,
    after_id: input.after_id ?? null,
    before_id: input.before_id ?? null,
  })
  return new StepResponse(task)
})

export const moveTaskWorkflow = createWorkflow("tasks-move-task", (input: MoveTaskInput) => {
  return new WorkflowResponse(moveTaskStep(input))
})

/* ------------------------------------------------------------------ */

export interface DeleteTaskInput extends WorkflowActorInput {
  id: string
}

export const deleteTaskStep = createStep("tasks-delete-task-step", async (input: DeleteTaskInput, { container }) => {
  return new StepResponse(await deleteTask(container, await contextFor(container, input), input.id))
})

export const deleteTaskWorkflow = createWorkflow("tasks-delete-task", (input: DeleteTaskInput) => {
  return new WorkflowResponse(deleteTaskStep(input))
})

/* ------------------------------------------------------------------ */

export interface AddTaskCommentInput extends WorkflowActorInput {
  task_id: string
  body: string
}

export const addTaskCommentStep = createStep("tasks-add-comment-step", async (input: AddTaskCommentInput, { container }) => {
  const comment: CommentDto = await addComment(container, await contextFor(container, input), input.task_id, { body: input.body })
  return new StepResponse(comment)
})

export const addTaskCommentWorkflow = createWorkflow("tasks-add-comment", (input: AddTaskCommentInput) => {
  return new WorkflowResponse(addTaskCommentStep(input))
})

/* ------------------------------------------------------------------ */

export interface LinkTaskInput extends WorkflowActorInput {
  task_id: string
  type: "order" | "product" | "customer"
  /** The Medusa record's id: `order_...`, `prod_...` or `cus_...`. */
  entity_id: string
}

export const linkTaskStep = createStep("tasks-link-task-step", async (input: LinkTaskInput, { container }) => {
  const result: { link: LinkDto; created: boolean } = await addLink(container, await contextFor(container, input), input.task_id, { type: input.type, id: input.entity_id })
  return new StepResponse(result)
})

export const linkTaskWorkflow = createWorkflow("tasks-link-task", (input: LinkTaskInput) => {
  return new WorkflowResponse(linkTaskStep(input))
})
