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
 *
 * SALES DOCUMENTS (0.2.0). An `order.document` task that got no clear answer
 * becomes `unknown`, never a plain retry: its next attempt asks the bridge
 * which documents the order has before it creates anything.
 */

import type { IEventBusModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { planRetry } from "../../modules/subiekt/lib/backoff"
import { describeError } from "../../modules/subiekt/lib/bridge-client"
import { BACKOFF_SECONDS, MAX_ATTEMPTS, PLUGIN_EVENTS, RUNNING_STALE_MS, TASKS_PER_PASS } from "../../modules/subiekt/lib/constants"
import type { RunTrigger, TaskStatus } from "../../modules/subiekt/lib/contract"
import { classifyDocumentFailure } from "../../modules/subiekt/lib/documents"
import type { TaskRow } from "../../modules/subiekt/lib/dto"
import { cancelOrderInSubiektWorkflow } from "./cancel-order-in-subiekt"
import { createSubiektWzWorkflow } from "./create-subiekt-wz"
import { issueSubiektDocumentWorkflow } from "./issue-subiekt-document"
import { claimTask, enqueueCancel, enqueueTask, updateTask, type EnqueueInput } from "./queue"
import { sendOrderToSubiektWorkflow } from "./send-order-to-subiekt"
import { exclusive, markUnreachable, recordRun, subiektService, type Scope } from "./runtime"

export { enqueueCancel, enqueueTask }
export type { EnqueueInput }

/** Codes that mean "the bridge or Subiekt is not there", not "this task is wrong". */
const CONNECTIVITY = new Set(["timeout", "bridge_unreachable", "bridge_unavailable", "subiekt_unavailable", "busy", "invalid_response"])

/** Passes over the queue in one run: a ZK that queues its FS gets it in the same run. */
const ROUNDS_PER_PASS = 3

export interface TaskOutcome {
  status: TaskStatus | "retry" | "skipped"
  code: string | null
}

/** One attempt of one task. Never throws: every failure lands in the row. */
export async function runTask(scope: Scope, task: TaskRow): Promise<TaskOutcome> {
  const svc = subiektService(scope)
  const attempts = (task.attempts ?? 0) + 1
  // Another process took it between the listing and now: nothing to do here.
  if (!(await claimTask(scope, task, attempts))) return { status: "skipped", code: null }

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
      result = { number: r.document?.number ?? null, created: r.created, warnings: r.warnings, omitted: r.omitted, buyer: r.buyer ?? null }
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
    } else if (task.kind === "order.document") {
      const kind = task.detail?.kind === "pa" ? "pa" : "fs"
      const reconcile = task.status === "unknown" || (task.attempts ?? 0) > 0
      const { result: r } = await issueSubiektDocumentWorkflow(scope as never).run({ input: { order_id: task.order_id, kind, reconcile } })
      if (r.skipped) {
        status = "canceled"
        note = "The order was canceled before its sales document was issued."
      }
      result = {
        number: r.document?.number ?? null,
        kind: r.document?.kind ?? kind.toUpperCase(),
        created: r.created,
        adopted: r.adopted,
        ksef_number: r.document?.ksefNumber ?? null,
        warnings: r.warnings,
      }
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
    let retryable = d.retryable
    let unknown = false
    if (task.kind === "order.document") {
      const verdict = classifyDocumentFailure(d.code, d.retryable)
      unknown = verdict === "unknown"
      retryable = verdict !== "failed"
    }
    const plan = planRetry({ attempts, retryable, maxAttempts: MAX_ATTEMPTS, steps: BACKOFF_SECONDS, now: new Date() })
    const status: TaskStatus = plan.status === "pending" && unknown ? "unknown" : plan.status
    const message = svc.mask(d.message).slice(0, 2000)
    await updateTask(scope, task.id, { status, next_attempt_at: plan.nextAttemptAt, last_error: message, last_error_code: d.code })
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
    svc.getLogger().info(`[subiekt] ${label}: attempt ${attempts} failed [${d.code}]${unknown ? ", result unknown" : ""}, next at ${plan.nextAttemptAt?.toISOString()}`)
    return { status: unknown ? "unknown" : "retry", code: d.code }
  }
}

export interface PassStats {
  processed: number
  succeeded: number
  retry: number
  unknown: number
  failed: number
  canceled: number
  requeued: number
}

/** Runs the due tasks, oldest first. One pass per process at a time; returns null when a pass already runs. */
export async function runDueTasks(scope: Scope, trigger: RunTrigger): Promise<PassStats | null> {
  return exclusive("tasks", async () => {
    const svc = subiektService(scope)
    const stats: PassStats = { processed: 0, succeeded: 0, retry: 0, unknown: 0, failed: 0, canceled: 0, requeued: 0 }
    if (!svc.isDemo() && !svc.isConfigured()) return stats

    const now = new Date()
    const stale = (await svc.listSubiektTasks(
      { status: "running", demo: svc.isDemo(), started_at: { $lt: new Date(now.getTime() - RUNNING_STALE_MS) } } as never,
      { take: 50 } as never,
    )) as unknown as TaskRow[]
    // A crashed attempt of a sales document may have reached the bridge: it comes back as unknown.
    for (const t of stale) await updateTask(scope, t.id, { status: t.kind === "order.document" ? "unknown" : "pending", next_attempt_at: now })
    stats.requeued = stale.length

    const startedAt = new Date()
    const seen = new Set<string>()
    let stop = false
    for (let round = 0; round < ROUNDS_PER_PASS && !stop; round++) {
      const due = ((await svc.listSubiektTasks({ status: ["pending", "unknown"], demo: svc.isDemo(), next_attempt_at: { $lte: new Date() } } as never, {
        take: TASKS_PER_PASS,
        order: { next_attempt_at: "ASC", created_at: "ASC" },
      } as never)) as unknown as TaskRow[]).filter((t) => !seen.has(t.id))
      if (due.length === 0) break
      for (const task of due) {
        seen.add(task.id)
        const outcome = await runTask(scope, task)
        if (outcome.status === "skipped") continue
        stats.processed += 1
        if (outcome.status === "succeeded") stats.succeeded += 1
        else if (outcome.status === "canceled") stats.canceled += 1
        else if (outcome.status === "failed") stats.failed += 1
        else if (outcome.status === "unknown") stats.unknown += 1
        else stats.retry += 1
        // The bridge is down: the rest would only wait for the same timeout. They stay due.
        if ((outcome.status === "retry" || outcome.status === "unknown") && outcome.code && CONNECTIVITY.has(outcome.code)) {
          stop = true
          break
        }
      }
    }
    if (stats.processed === 0) return stats

    const issues = stats.retry + stats.unknown
    await recordRun(svc, {
      kind: "tasks",
      trigger,
      status: stats.failed > 0 || issues > 0 ? "partial" : "success",
      startedAt,
      stats: { ...stats },
      message:
        issues > 0 || stats.failed > 0
          ? `${stats.succeeded} sent, ${issues} to retry, ${stats.failed} need attention.`
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
