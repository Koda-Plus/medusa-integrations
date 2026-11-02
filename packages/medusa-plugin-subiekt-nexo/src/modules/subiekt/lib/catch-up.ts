/**
 * THE SAFETY NET (0.3.0). Pure decisions, tested.
 *
 * The `order.placed` subscriber writes the ZK task of every new order. When
 * that event never reaches it (a restart between the order and the event, a
 * database error while the row was written), the order would wait forever
 * with no task and no ZK. A job looks at recent orders every 10 minutes and
 * queues the task of every order the plugin has no trace of.
 *
 * Which orders:
 * - created inside the window: older than `catchUpMinAgeMinutes` (the
 *   subscriber had its chance) and younger than `catchUpMaxAgeDays`,
 * - and never before the first ZK task this database ever had: that task marks
 *   when the plugin went live, so a store that configures the plugin a week
 *   after installing it does not flood Subiekt with a week of old orders,
 * - not canceled and not a draft,
 * - with no `order.create` task in any state (a failed or canceled task is a
 *   decision already made, never overruled here) and no ZK document.
 *
 * A task found `waiting` for a payment is checked again: when the capture
 * event was lost too, the order is ready and its task is released.
 */

export interface CatchUpWindow {
  from: Date
  to: Date
}

/** The creation dates the safety net looks at, or null when there is nothing to look at yet. */
export function catchUpWindow(
  now: Date,
  minAgeMinutes: number,
  maxAgeDays: number,
  firstTaskAt: Date | string | null,
): CatchUpWindow | null {
  if (!firstTaskAt) return null
  const first = new Date(firstTaskAt)
  if (Number.isNaN(first.getTime())) return null
  const to = new Date(now.getTime() - minAgeMinutes * 60_000)
  const oldest = new Date(now.getTime() - maxAgeDays * 86_400_000)
  const from = first.getTime() > oldest.getTime() ? first : oldest
  return from.getTime() < to.getTime() ? { from, to } : null
}

export interface CatchUpOrder {
  id: string
  status?: string | null
  created_at?: Date | string | null
}

export interface CatchUpTask {
  order_id: string
  status: string
}

export type CatchUpSkip = "canceled" | "draft" | "has_task" | "has_zk" | "outside_window"

export interface CatchUpPlan {
  /** Orders with no trace in the plugin, oldest first: queue their ZK task. */
  queue: string[]
  /** Orders whose ZK task waits for a payment: check whether it was captured. */
  recheck: string[]
  skipped: Record<CatchUpSkip, number>
}

/** What to do with the orders of one run. `tasks` are `order.create` tasks, `zkOrderIds` orders with a ZK row. */
export function planCatchUp(
  orders: readonly CatchUpOrder[],
  tasks: readonly CatchUpTask[],
  zkOrderIds: Iterable<string>,
  window: CatchUpWindow,
): CatchUpPlan {
  const taskByOrder = new Map(tasks.map((t) => [t.order_id, t]))
  const zk = new Set(zkOrderIds)
  const plan: CatchUpPlan = {
    queue: [],
    recheck: [],
    skipped: { canceled: 0, draft: 0, has_task: 0, has_zk: 0, outside_window: 0 },
  }
  const sorted = [...orders].sort((a, b) => time(a.created_at) - time(b.created_at))
  const seen = new Set<string>()
  for (const o of sorted) {
    if (!o.id || seen.has(o.id)) continue
    seen.add(o.id)
    const at = time(o.created_at)
    if (!(at >= window.from.getTime() && at <= window.to.getTime())) plan.skipped.outside_window += 1
    else if (o.status === "canceled") plan.skipped.canceled += 1
    else if (o.status === "draft") plan.skipped.draft += 1
    else if (zk.has(o.id)) plan.skipped.has_zk += 1
    else if (taskByOrder.has(o.id)) {
      if (taskByOrder.get(o.id)!.status === "waiting") plan.recheck.push(o.id)
      else plan.skipped.has_task += 1
    } else plan.queue.push(o.id)
  }
  return plan
}

function time(v: Date | string | null | undefined): number {
  if (!v) return Number.NaN
  return new Date(v).getTime()
}
