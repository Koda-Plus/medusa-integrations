/**
 * THE TASK QUEUE (outbox) between Medusa events and the bridge.
 *
 * Subscribers only write a row and nudge the queue; the actual call happens
 * here, with retries and backoff, so a bridge machine that is off, a tunnel
 * that hiccups or Subiekt that is being updated never loses an order. The
 * scheduled job drains the queue every minute; subscribers start a pass
 * right away, so in the normal case a ZK exists seconds after the order.
 *
 * ORDER OF OPERATIONS PER ORDER. A cancel must never overtake the create:
 * if the create has not been attempted yet, the cancel simply cancels the
 * create task (nothing exists in Subiekt); otherwise the cancel is queued
 * behind it and the bridge decides.
 */

import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { planRetry } from "../../modules/subiekt/lib/backoff"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { BACKOFF_SECONDS, MAX_ATTEMPTS, PLUGIN_EVENTS, RUNNING_STALE_MS, TASKS_PER_PASS } from "../../modules/subiekt/lib/constants"
import type { RunTrigger, TaskKind, TaskStatus } from "../../modules/subiekt/lib/contract"
import type { TaskRow } from "../../modules/subiekt/lib/dto"
import { cancelOrderInSubiektWorkflow } from "./cancel-order-in-subiekt"
import { createSubiektWzWorkflow } from "./create-subiekt-wz"
import { sendOrderToSubiektWorkflow } from "./send-order-to-subiekt"
import { exclusive, markUnreachable, recordRun, subiektService, type Scope } from "./runtime"

/** Codes that mean "the bridge or Subiekt is not there", not "this task is wrong". */
const CONNECTIVITY = new Set(["timeout", "bridge_unreachable", "bridge_unavailable", "subiekt_unavailable", "busy", "invalid_response"])

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
}

async function findTask(scope: Scope, kind: TaskKind, orderId: string, reference: string | null): Promise<TaskRow | null> {
  const rows = (await subiektService(scope).listSubiektTasks(
    { kind, order_id: orderId, reference } as never,
    { take: 1 } as never,
  )) as unknown as TaskRow[]
  return rows[0] ?? null
}

async function updateTask(scope: Scope, id: string, patch: Record<string, unknown>): Promise<TaskRow> {
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
      } as never)) as unknown as TaskRow
    } catch {
      // Two subscribers raced for the same order; the unique index kept one row.
      task = await findTask(scope, input.kind, input.orderId, reference)
      if (!task) throw new Error(`Could not queue ${input.kind} for ${input.orderId}.`)
    }
  }

  if (input.force && task.status !== "running") {
    return updateTask(scope, task.id, {
      status: "pending",
      attempts: 0,
      next_attempt_at: due,
      last_error: null,
      last_error_code: null,
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

export interface TaskOutcome {
  status: TaskStatus | "retry"
  code: string | null
}

/** One attempt of one task. Never throws: every failure lands in the row. */
export async function runTask(scope: Scope, task: TaskRow): Promise<TaskOutcome> {
  const svc = subiektService(scope)
  const attempts = (task.attempts ?? 0) + 1
  await updateTask(scope, task.id, { status: "running", started_at: new Date(), attempts })

  try {
    let result: Record<string, unknown>
    let status: TaskStatus = "succeeded"
    let note: string | null = null

    if (task.kind === "order.create") {
      const { result: r } = await sendOrderToSubiektWorkflow(scope as never).run({ input: { order_id: task.order_id } })
      if (r.skipped) {
        status = "canceled"
        note = "The order was canceled before it reached Subiekt."
      }
      result = { number: r.document?.number ?? null, created: r.created, warnings: r.warnings, omitted: r.omitted }
    } else if (task.kind === "order.cancel") {
      const { result: r } = await cancelOrderInSubiektWorkflow(scope as never).run({ input: { order_id: task.order_id } })
      result = {
        outcome: r.status,
        manual_action_required: r.manual_action_required,
        message: r.message ?? null,
        number: r.documents?.[0]?.number ?? null,
      }
    } else if (task.kind === "order.fulfill" && task.reference) {
      const { result: r } = await createSubiektWzWorkflow(scope as never).run({ input: { order_id: task.order_id, fulfillment_id: task.reference } })
      result = { number: r.document.number, created: r.created }
    } else {
      throw Object.assign(new Error(`Unknown task ${task.kind}.`), { code: "unknown_task", retryable: false })
    }

    await updateTask(scope, task.id, {
      status,
      succeeded_at: status === "succeeded" ? new Date() : null,
      next_attempt_at: null,
      last_error: note,
      last_error_code: note ? "order_canceled" : null,
      result,
    })
    return { status, code: null }
  } catch (err) {
    const d = describeError(err)
    const plan = planRetry({ attempts, retryable: d.retryable, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now: new Date() })
    const message = svc.mask(d.message).slice(0, 2000)
    await updateTask(scope, task.id, { status: plan.status, next_attempt_at: plan.nextAttemptAt, last_error: message, last_error_code: d.code })
    if (CONNECTIVITY.has(d.code)) await markUnreachable(svc, message).catch(() => undefined)

    const label = `${task.kind} #${task.display_id ?? task.order_id}`
    if (plan.status === "failed") {
      svc.getLogger().warn(`[subiekt] ${label} failed for good after ${attempts} attempt(s): [${d.code}] ${message}`)
      try {
        const bus = (scope as { resolve<T>(k: string): T }).resolve<IEventBusModuleService>(Modules.EVENT_BUS)
        await bus.emit({
          name: PLUGIN_EVENTS.taskFailed,
          data: { task_id: task.id, kind: task.kind, order_id: task.order_id, display_id: task.display_id, code: d.code, message },
        })
      } catch {
        /* the event is a courtesy for alerting, never a reason to fail */
      }
      return { status: "failed", code: d.code }
    }
    svc.getLogger().info(`[subiekt] ${label}: attempt ${attempts} failed [${d.code}], next at ${plan.nextAttemptAt?.toISOString()}`)
    return { status: "retry", code: d.code }
  }
}

export interface PassStats {
  processed: number
  succeeded: number
  retry: number
  failed: number
  canceled: number
  requeued: number
}

/** Runs the due tasks, oldest first. One pass per process at a time; returns null when a pass already runs. */
export async function runDueTasks(scope: Scope, trigger: RunTrigger): Promise<PassStats | null> {
  return exclusive("tasks", async () => {
    const svc = subiektService(scope)
    const stats: PassStats = { processed: 0, succeeded: 0, retry: 0, failed: 0, canceled: 0, requeued: 0 }
    if (!svc.isDemo() && !svc.isConfigured()) return stats

    const now = new Date()
    const stale = (await svc.listSubiektTasks(
      { status: "running", started_at: { $lt: new Date(now.getTime() - RUNNING_STALE_MS) } } as never,
      { take: 50 } as never,
    )) as unknown as TaskRow[]
    for (const t of stale) await updateTask(scope, t.id, { status: "pending", next_attempt_at: now })
    stats.requeued = stale.length

    const due = (await svc.listSubiektTasks({ status: "pending", next_attempt_at: { $lte: now } } as never, {
      take: TASKS_PER_PASS,
      order: { next_attempt_at: "ASC", created_at: "ASC" },
    } as never)) as unknown as TaskRow[]
    if (due.length === 0) return stats

    const startedAt = new Date()
    for (const task of due) {
      const outcome = await runTask(scope, task)
      stats.processed += 1
      if (outcome.status === "succeeded") stats.succeeded += 1
      else if (outcome.status === "canceled") stats.canceled += 1
      else if (outcome.status === "failed") stats.failed += 1
      else stats.retry += 1
      // The bridge is down: the rest would only wait for the same timeout. They stay due.
      if (outcome.status === "retry" && outcome.code && CONNECTIVITY.has(outcome.code)) break
    }

    await recordRun(svc, {
      kind: "tasks",
      trigger,
      status: stats.failed > 0 || stats.retry > 0 ? "partial" : "success",
      startedAt,
      stats: { ...stats },
      message:
        stats.retry > 0 || stats.failed > 0
          ? `${stats.succeeded} sent, ${stats.retry} to retry, ${stats.failed} need attention.`
          : `${stats.succeeded} sent.`,
    })
    return stats
  })
}

/** Starts a pass in the background (subscribers, admin actions). */
export function kickTasks(scope: Scope, trigger: RunTrigger): void {
  setImmediate(() => {
    runDueTasks(scope, trigger).catch((err: unknown) => {
      subiektService(scope).getLogger().error(`[subiekt] Task pass failed: ${(err as Error)?.message ?? String(err)}`)
    })
  })
}
