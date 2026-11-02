/**
 * THE SAFETY NET (0.3.0): orders the `order.placed` subscriber never queued.
 *
 * Every 10 minutes (`subiekt-catch-up`) the recent orders are compared with
 * the plugin tables; an order with neither a ZK task nor a ZK gets its task
 * through `queueOrderCreate`, the very function the subscriber runs, so the
 * payment rule (prepaid waits for the capture) is the same. A task waiting for
 * a payment whose capture event was lost is released. Which orders and why:
 * `lib/catch-up.ts`.
 *
 * The queue does the rest: the bridge being down only delays the tasks, its
 * own backoff applies. One run at a time: an in-process guard plus a database
 * advisory lock across processes; the unique index of `subiekt_task` keeps
 * one row per order even if a subscriber writes at the same moment.
 */

import { CATCH_UP_MAX_ORDERS_PER_RUN } from "../../modules/subiekt/lib/constants"
import { catchUpWindow, planCatchUp, type CatchUpOrder, type CatchUpPlan, type CatchUpTask } from "../../modules/subiekt/lib/catch-up"
import type { RunTrigger } from "../../modules/subiekt/lib/contract"
import type { TaskRow } from "../../modules/subiekt/lib/dto"
import { orderReadiness } from "./orders"
import { enqueueTask } from "./queue"
import { exclusive, queryOf, recordRun, subiektService, withDatabaseLock, type Scope } from "./runtime"
import { kickTasks } from "./tasks"

const LOCK_KEY = "koda.subiekt.catchup"
const PAGE = 200

/**
 * Queues the ZK task of one order the way `order.placed` does: due now when
 * the payment allows it, `waiting` for the capture otherwise. Returns null for
 * a canceled or unknown order. Safe to call twice: an existing task is only
 * moved from `waiting` to `pending`, never reset.
 */
export async function queueOrderCreate(scope: Scope, orderId: string, trigger: string): Promise<{ task: TaskRow; ready: boolean } | null> {
  const order = await orderReadiness(scope, orderId)
  if (!order || order.canceled) return null
  const task = await enqueueTask(scope, {
    kind: "order.create",
    orderId,
    displayId: order.displayId,
    status: order.ready ? "pending" : "waiting",
    trigger,
  })
  return { task, ready: order.ready }
}

export interface CatchUpStats {
  /** Orders read inside the window. */
  checked: number
  /** Tasks queued due now. */
  queued: number
  /** Tasks queued waiting for the payment capture. */
  waiting: number
  /** Waiting tasks released because the payment was captured meanwhile. */
  released: number
  errors: number
  skipped: CatchUpPlan["skipped"]
  /** No ZK task ever: the plugin is not live yet, nothing is caught up. */
  notLive: boolean
}

async function recentOrders(scope: Scope, from: Date, to: Date): Promise<CatchUpOrder[]> {
  const out: CatchUpOrder[] = []
  for (let skip = 0; skip < CATCH_UP_MAX_ORDERS_PER_RUN; skip += PAGE) {
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "status", "created_at"],
      filters: { created_at: { $gte: from, $lte: to } },
      pagination: { skip, take: PAGE, order: { created_at: "ASC" } },
    })
    out.push(...(data as CatchUpOrder[]))
    if (data.length < PAGE) break
  }
  return out
}

/** One safety net run. Returns null when a run already holds the lock. */
export async function runCatchUp(scope: Scope, trigger: RunTrigger): Promise<CatchUpStats | null> {
  const result = await exclusive("catchup", () => withDatabaseLock(scope, LOCK_KEY, () => catchUp(scope, trigger)))
  return result ?? null
}

async function catchUp(scope: Scope, trigger: RunTrigger): Promise<CatchUpStats> {
  const svc = subiektService(scope)
  const demo = svc.isDemo()
  const o = svc.getOptions()
  const stats: CatchUpStats = {
    checked: 0,
    queued: 0,
    waiting: 0,
    released: 0,
    errors: 0,
    skipped: { canceled: 0, draft: 0, has_task: 0, has_zk: 0, outside_window: 0 },
    notLive: false,
  }
  if (!demo && !svc.isConfigured()) return stats

  const first = (await svc.listSubiektTasks({ kind: "order.create", demo } as never, {
    take: 1,
    select: ["id", "created_at"],
    order: { created_at: "ASC" },
    withDeleted: true,
  } as never)) as unknown as Array<{ created_at?: Date | string | null }>
  const window = catchUpWindow(new Date(), o.catchUpMinAgeMinutes, o.catchUpMaxAgeDays, first[0]?.created_at ?? null)
  if (!window) {
    stats.notLive = first.length === 0
    return stats
  }

  const startedAt = new Date()
  const orders = await recentOrders(scope, window.from, window.to)
  stats.checked = orders.length
  if (orders.length === 0) return stats

  const ids = orders.map((x) => x.id)
  const tasks: CatchUpTask[] = []
  const zk: string[] = []
  for (let i = 0; i < ids.length; i += PAGE) {
    const part = ids.slice(i, i + PAGE)
    const [t, d] = await Promise.all([
      svc.listSubiektTasks({ kind: "order.create", order_id: part, demo } as never, { take: part.length, select: ["id", "order_id", "status"] } as never),
      svc.listSubiektDocuments({ kind: "ZK", order_id: part, demo } as never, { take: null, select: ["id", "order_id"] } as never),
    ])
    tasks.push(...(t as unknown as CatchUpTask[]))
    for (const row of d as unknown as Array<{ order_id: string | null }>) if (row.order_id) zk.push(row.order_id)
  }

  const plan = planCatchUp(orders, tasks, zk, window)
  stats.skipped = plan.skipped
  const logger = svc.getLogger()

  for (const orderId of plan.queue) {
    try {
      const r = await queueOrderCreate(scope, orderId, "catchup")
      if (!r) continue
      if (r.task.status === "pending") stats.queued += 1
      else if (r.task.status === "waiting") stats.waiting += 1
      logger.info(`[subiekt] Safety net: order #${r.task.display_id ?? orderId} had no ZK task, queued (${r.task.status}).`)
    } catch (err) {
      stats.errors += 1
      logger.warn(`[subiekt] Safety net: could not queue ${orderId}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
  }
  for (const orderId of plan.recheck) {
    try {
      const order = await orderReadiness(scope, orderId)
      if (!order || order.canceled || !order.ready) continue
      const task = await enqueueTask(scope, { kind: "order.create", orderId, displayId: order.displayId, status: "pending", trigger: "catchup" })
      if (task.status === "pending") stats.released += 1
    } catch (err) {
      stats.errors += 1
      logger.warn(`[subiekt] Safety net: could not check the payment of ${orderId}: ${svc.mask((err as Error)?.message ?? String(err))}`)
    }
  }

  const acted = stats.queued + stats.waiting + stats.released
  if (stats.queued + stats.released > 0) kickTasks(scope, "auto")
  // Quiet when everything already had its task: no run row for an empty pass.
  if (acted + stats.errors === 0) return stats
  await recordRun(svc, {
    kind: "catchup",
    trigger,
    status: stats.errors > 0 ? "partial" : "success",
    startedAt,
    stats: { ...stats, skipped: { ...stats.skipped } },
    message:
      `${stats.queued + stats.waiting} order(s) without a ZK task queued (${stats.waiting} waiting for payment), ` +
      `${stats.released} released after the payment` +
      (stats.errors > 0 ? `, ${stats.errors} error(s).` : "."),
  })
  return stats
}
