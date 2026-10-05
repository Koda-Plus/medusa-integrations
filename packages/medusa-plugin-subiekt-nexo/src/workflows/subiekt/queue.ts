/**
 * THE TASK QUEUE ROWS: create, move forward, claim. No workflow imports here,
 * so any flow can queue a task without an import cycle; `tasks.ts` runs them.
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { TaskKind } from "../../modules/subiekt/lib/contract"
import type { TaskRow } from "../../modules/subiekt/lib/dto"
import { subiektService, type Scope } from "./runtime"

export interface EnqueueInput {
  kind: TaskKind
  orderId: string
  displayId?: number | null
  reference?: string | null
  status: "waiting" | "pending"
  trigger: string
  /** A person asked: reset a failed, canceled or finished task and run it again. */
  force?: boolean
  delayMs?: number
  /** Input frozen with the task, for example the sales document kind. Never changed by a later enqueue. */
  detail?: Record<string, unknown> | null
}

export async function findTask(scope: Scope, kind: TaskKind, orderId: string, reference: string | null): Promise<TaskRow | null> {
  const svc = subiektService(scope)
  const rows = (await svc.listSubiektTasks(
    { kind, order_id: orderId, reference, demo: svc.isDemo() } as never,
    { take: 1 } as never,
  )) as unknown as TaskRow[]
  return rows[0] ?? null
}

export async function updateTask(scope: Scope, id: string, patch: Record<string, unknown>): Promise<TaskRow> {
  return (await subiektService(scope).updateSubiektTasks({ id, ...patch } as never)) as unknown as TaskRow
}

/** Creates the task or moves the existing one forward. Safe to call twice for the same event. */
export async function enqueueTask(scope: Scope, input: EnqueueInput): Promise<TaskRow> {
  const svc = subiektService(scope)
  const reference = input.reference ?? null
  const due = new Date(Date.now() + (input.delayMs ?? 0))

  let task = await findTask(scope, input.kind, input.orderId, reference)
  if (!task) {
    try {
      return (await svc.createSubiektTasks({
        kind: input.kind,
        order_id: input.orderId,
        display_id: input.displayId ?? null,
        reference,
        status: input.status,
        trigger: input.trigger,
        attempts: 0,
        next_attempt_at: input.status === "pending" ? due : null,
        detail: input.detail ?? null,
        demo: svc.isDemo(),
      } as never)) as unknown as TaskRow
    } catch {
      // Two subscribers raced for the same order; the unique index kept one row.
      task = await findTask(scope, input.kind, input.orderId, reference)
      if (!task) throw new Error(`Could not queue ${input.kind} for ${input.orderId}.`)
    }
  }

  // An `unknown` task is never reset blindly: its next attempt asks the bridge first anyway.
  if (input.force && task.status !== "running") {
    return updateTask(scope, task.id, {
      status: task.status === "unknown" ? "unknown" : "pending",
      attempts: task.status === "unknown" ? task.attempts : 0,
      next_attempt_at: due,
      last_error: task.status === "unknown" ? task.last_error : null,
      last_error_code: task.status === "unknown" ? task.last_error_code : null,
      trigger: input.trigger,
    })
  }
  if (task.status === "waiting" && input.status === "pending") {
    return updateTask(scope, task.id, { status: "pending", next_attempt_at: due, trigger: input.trigger })
  }
  return task
}

/** Queues the cancel of an order, or cancels its create when nothing reached Subiekt yet. */
export async function enqueueCancel(scope: Scope, orderId: string, displayId: number | null): Promise<TaskRow | null> {
  const create = await findTask(scope, "order.create", orderId, null)
  // A sales document that never left Medusa is simply dropped with the order.
  const document = await findTask(scope, "order.document", orderId, null)
  if (document && (document.status === "waiting" || document.status === "pending") && (document.attempts ?? 0) === 0) {
    await updateTask(scope, document.id, { status: "canceled", next_attempt_at: null, last_error_code: "order_canceled" })
  }
  if (create && (create.status === "waiting" || create.status === "pending") && (create.attempts ?? 0) === 0) {
    await updateTask(scope, create.id, {
      status: "canceled",
      next_attempt_at: null,
      last_error: "The order was canceled before it reached Subiekt.",
      last_error_code: "order_canceled",
    })
    return null
  }
  let delayMs = 0
  if (create && (create.status === "waiting" || create.status === "pending" || create.status === "failed")) {
    // Attempted before: a ZK may exist (a timeout is ambiguous). Stop creating, let the bridge cancel.
    await updateTask(scope, create.id, { status: "canceled", next_attempt_at: null, last_error_code: "order_canceled" })
  } else if (create && create.status === "running") {
    delayMs = 2 * 60 * 1000
  }
  return enqueueTask(scope, { kind: "order.cancel", orderId, displayId, status: "pending", trigger: "canceled", delayMs })
}

interface RawUpdate {
  where(cond: Record<string, unknown>): RawUpdate
  whereIn(column: string, values: string[]): RawUpdate
  whereNull(column: string): RawUpdate
  update(patch: Record<string, unknown>): { returning(column: string): Promise<unknown[]> }
}

/**
 * Claims a due task for this attempt: `pending` or `unknown` becomes `running`
 * in ONE conditional UPDATE, so two processes (the server answering a click
 * and the worker running the schedule) never send the same task twice. Falls
 * back to a plain update where the raw connection is not available; the
 * in-process guard and the bridge's own idempotency still hold then.
 */
export async function claimTask(scope: Scope, task: TaskRow, attempts: number): Promise<boolean> {
  const now = new Date()
  let knex: ((table: string) => RawUpdate) | null = null
  try {
    knex = (scope as { resolve<T>(k: string): T }).resolve<(table: string) => RawUpdate>(ContainerRegistrationKeys.PG_CONNECTION)
  } catch {
    knex = null
  }
  if (typeof knex === "function") {
    try {
      const rows = await knex("subiekt_task")
        .where({ id: task.id })
        .whereIn("status", ["pending", "unknown"])
        .whereNull("deleted_at")
        .update({ status: "running", started_at: now, attempts, updated_at: now })
        .returning("id")
      return rows.length === 1
    } catch {
      /* fall through to the service update */
    }
  }
  await updateTask(scope, task.id, { status: "running", started_at: now, attempts })
  return true
}
