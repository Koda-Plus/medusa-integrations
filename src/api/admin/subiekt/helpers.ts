import type { MedusaContainer } from "@medusajs/framework/types"
import type SubiektModuleService from "../../../modules/subiekt/service"
import { EVENTS_SCHEDULE, STOCK_SCHEDULE, TASKS_SCHEDULE } from "../../../modules/subiekt/lib/constants"
import type { BridgeHealth, RunDto, RunKind, SubiektStatusResponse } from "../../../modules/subiekt/lib/contract"
import { iso, toRunDto, type RunRow } from "../../../modules/subiekt/lib/dto"
import { bridgeHost } from "../../../modules/subiekt/lib/options"
import { checkConnection } from "../../../workflows/subiekt/health"
import { queryOf, getConnection, runningKinds, subiektService, type Scope } from "../../../workflows/subiekt/runtime"
import { runStockSync } from "../../../workflows/subiekt/sync-subiekt-stock"
import { enqueueTask, runDueTasks } from "../../../workflows/subiekt/tasks"

/* Only files named `route.ts` register routes; this one is a helper. */

export { subiektService }

async function count(svc: SubiektModuleService, kind: "task" | "document", filters: Record<string, unknown>): Promise<number> {
  const [, n] =
    kind === "task"
      ? await svc.listAndCountSubiektTasks(filters as never, { take: 1, select: ["id"] } as never)
      : await svc.listAndCountSubiektDocuments(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

/**
 * Status for the admin page. READS THE DATABASE ONLY: rendering the page
 * never calls the bridge. Network calls sit behind POST routes and clicks.
 */
export async function buildStatus(svc: SubiektModuleService): Promise<SubiektStatusResponse> {
  const o = svc.getOptions()
  const conn = await getConnection(svc)
  const demo = o.demo
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)

  const [waiting, pending, running, failed, succeeded24h, documents, zk, wz] = await Promise.all([
    count(svc, "task", { status: "waiting" }),
    count(svc, "task", { status: "pending" }),
    count(svc, "task", { status: "running" }),
    count(svc, "task", { status: "failed" }),
    count(svc, "task", { status: "succeeded", succeeded_at: { $gte: dayAgo } }),
    count(svc, "document", { demo }),
    count(svc, "document", { demo, kind: "ZK" }),
    count(svc, "document", { demo, kind: "WZ" }),
  ])

  const lastRuns: Partial<Record<RunKind, RunDto>> = {}
  for (const kind of ["stock", "events", "tasks", "health"] as RunKind[]) {
    const rows = (await svc.listSubiektSyncRuns({ kind } as never, { take: 1, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
    if (rows[0]) lastRuns[kind] = toRunDto(rows[0])
  }

  return {
    mode: demo ? "demo" : "live",
    configured: demo ? true : svc.isConfigured(),
    missing: svc.missingOptions(),
    bridgeHost: bridgeHost(o),
    options: {
      prepaidProviders: o.prepaidProviders,
      stockSyncEnabled: o.stockSyncEnabled,
      stockLocationId: o.stockLocationId || null,
      stockField: o.stockField,
      issueWzOnFulfillment: o.issueWzOnFulfillment,
      fulfillOnWz: o.fulfillOnWz,
      eventsEnabled: o.eventsEnabled,
    },
    connection: {
      reachable: Boolean(conn.reachable),
      health: (conn.health as unknown as BridgeHealth | null) ?? null,
      checkedAt: iso(conn.checked_at),
      lastError: conn.last_error ?? null,
      lastErrorAt: iso(conn.last_error_at),
      consecutiveFailures: conn.consecutive_failures ?? 0,
      eventsCursor: conn.events_cursor ?? null,
      eventsReadAt: iso(conn.events_read_at),
    },
    counts: { waiting, pending, running, failed, succeeded24h, documents, zk, wz },
    lastRuns,
    running: runningKinds(),
    schedules: { tasks: TASKS_SCHEDULE, events: EVENTS_SCHEDULE, stock: STOCK_SCHEDULE },
  }
}

/**
 * Demo mode, first visit: send the store's latest orders through the
 * simulated bridge right away, so the page opens with ZK numbers instead of
 * empty tables. Only when the queue has never seen a task.
 */
export async function ensureDemoSnapshot(scope: Scope): Promise<void> {
  const svc = subiektService(scope)
  if (!svc.isDemo()) return
  const [, tasks] = await svc.listAndCountSubiektTasks({} as never, { take: 1, select: ["id"] } as never)
  if (tasks > 0) return

  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: ["id", "display_id", "status", "created_at"],
    pagination: { take: 8, order: { created_at: "DESC" } },
  })
  for (const o of data as Array<{ id: string; display_id?: number | null; status?: string }>) {
    if (o.status === "canceled") continue
    await enqueueTask(scope, { kind: "order.create", orderId: o.id, displayId: o.display_id ?? null, status: "pending", trigger: "auto" })
  }
  await checkConnection(scope, "auto")
  await runDueTasks(scope, "auto")
  setImmediate(() => {
    runStockSync(scope, "auto").catch(() => undefined)
  })
}

export function intParam(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function strParam(value: unknown): string {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === "string" ? v.trim() : ""
}

export type { MedusaContainer }
