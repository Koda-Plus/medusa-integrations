/**
 * DEMO MODE: THE SNAPSHOT AND THE MOVING WAREHOUSE, NEVER FROM A READ.
 *
 * The simulated catalog is built, the store's latest orders go through the
 * simulated account and the simulated warehouse moves sent orders on (from
 * "Nowe" to "Wysłane" with a parcel number), all by the `baselinker-demo`
 * job every minute or by `POST /admin/baselinker/demo/prepare` when the page
 * asks. Every admin read only reads.
 *
 * What the demo writes: the plugin's own demo rows. The store's orders get
 * no simulated number, status or parcel in their metadata and no event goes
 * out for them; simulated marketplace orders become Medusa orders only with
 * `demoCreatesOrders` (and carry `metadata.baselinker_demo`).
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { runCatalogSync } from "./catalog"
import { exportVerdictOf } from "./order-facts"
import { enqueueOrder, sendDueOrders } from "./orders"
import { baselinkerService, exclusive, isJobRunning, queryOf, type Scope } from "./runtime"
import { syncStatuses } from "./statuses"

/** How many of the store's latest orders the first demo snapshot sends through the simulation. */
const DEMO_FIRST_ORDERS = 8

/** Whether the simulated catalog was built in this database. Reads only. */
export async function demoPrepared(svc: BaseLinkerModuleService): Promise<boolean> {
  if (!svc.isDemo()) return true
  const [, runs] = (await svc.listAndCountBaseLinkerSyncRuns({ kind: "catalog", source: "demo" } as never, { take: 1, select: ["id"] } as never)) as unknown as [
    unknown[],
    number,
  ]
  return runs > 0
}

export interface DemoPrepared {
  /** The snapshot exists (now or from before). */
  prepared: boolean
  /** This call built it. */
  built: boolean
  /** Orders sent through the simulated account by this call. */
  sent: number
}

/**
 * Demo mode, idempotent: builds the simulated catalog when it was never
 * built, then sends the store's latest orders through the simulated account
 * when no order went yet (plugin rows only). Orders that came from
 * BaseLinker, or straight from a marketplace, never go.
 */
export async function prepareDemo(scope: Scope): Promise<DemoPrepared | null> {
  const svc = baselinkerService(scope)
  if (!svc.isDemo()) return { prepared: true, built: false, sent: 0 }
  return exclusive(scope, "demo", async () => {
    const out: DemoPrepared = { prepared: await demoPrepared(svc), built: false, sent: 0 }
    if (!out.prepared && !(await isJobRunning(scope, "catalog"))) {
      await runCatalogSync(scope, { trigger: "auto" })
      out.built = true
      out.prepared = await demoPrepared(svc)
    }

    const o = svc.getOptions()
    const [, orders] = (await svc.listAndCountBaseLinkerOrders({ demo: true } as never, { take: 1, select: ["id"] } as never)) as unknown as [unknown[], number]
    if (orders > 0 || !o.exportOrders) return out
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "display_id", "status", "created_at", "metadata"],
      pagination: { take: DEMO_FIRST_ORDERS, order: { created_at: "DESC" } },
    })
    const recent = data as Array<{ id: string; display_id?: number | null; status?: string | null; metadata?: Record<string, unknown> | null }>
    let queued = 0
    for (const r of recent) {
      if (r.status === "canceled") continue
      if (!(await exportVerdictOf(scope, r)).send) continue
      await enqueueOrder(scope, { orderId: r.id, displayId: r.display_id ?? null })
      queued += 1
    }
    if (queued > 0) out.sent = (await sendDueOrders(scope, "auto"))?.sent ?? 0
    return out
  })
}

/** The `baselinker-demo` job: the snapshot when missing, then the simulated warehouse moves orders on. */
export async function runDemoTick(scope: Scope): Promise<void> {
  const svc = baselinkerService(scope)
  if (!svc.isDemo()) return
  await prepareDemo(scope)
  await syncStatuses(scope, "auto")
}
