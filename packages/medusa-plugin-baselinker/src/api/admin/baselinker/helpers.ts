import type BaseLinkerModuleService from "../../../modules/baselinker/service"
import { CATALOG_SCHEDULE, ORDERS_SCHEDULE, STATUSES_SCHEDULE } from "../../../modules/baselinker/lib/constants"
import type { RunDto, RunKind, StatusResponse } from "../../../modules/baselinker/lib/contract"
import { canExportOrders, canPlanStock, canReadCatalog, canReadStatuses } from "../../../modules/baselinker/lib/options"
import { runCatalogSync } from "../../../workflows/baselinker/catalog"
import { enqueueOrder, sendDueOrders } from "../../../workflows/baselinker/orders"
import { baselinkerService, isRunning, lastCheck, lastRun, queryOf, runningKinds, type Scope } from "../../../workflows/baselinker/runtime"

/* Only files named `route.ts` register routes; this one is a helper. */

export { baselinkerService }

type Counted = "products" | "orders"

async function count(svc: BaseLinkerModuleService, what: Counted, filters: Record<string, unknown>): Promise<number> {
  const [, n] =
    what === "products"
      ? await svc.listAndCountBaseLinkerProducts(filters as never, { take: 1, select: ["id"] } as never)
      : await svc.listAndCountBaseLinkerOrders(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to
 * BaseLinker while rendering. Going to the network sits behind POST routes
 * and clicks.
 */
export async function buildStatus(svc: BaseLinkerModuleService): Promise<StatusResponse> {
  const o = svc.getOptions()
  const demo = o.demo
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)

  const [cards, linked, unmatched, conflicts, noSku, pending, sent, failed, skipped, sent24h] = await Promise.all([
    count(svc, "products", { demo }),
    count(svc, "products", { demo, variant_id: { $ne: null } }),
    count(svc, "products", { demo, variant_id: null, conflict: null }),
    count(svc, "products", { demo, conflict: { $ne: null } }),
    count(svc, "products", { demo, sku: null }),
    count(svc, "orders", { demo, status: "pending" }),
    count(svc, "orders", { demo, status: "sent" }),
    count(svc, "orders", { demo, status: "failed" }),
    count(svc, "orders", { demo, status: "skipped" }),
    count(svc, "orders", { demo, status: "sent", sent_at: { $gte: dayAgo } }),
  ])

  const changes = (await svc.listBaseLinkerStockChanges({ demo } as never, { take: null, select: ["delta"] } as never)) as unknown as Array<{
    delta: number
  }>
  let unitsAdded = 0
  let unitsRemoved = 0
  for (const c of changes) {
    if (c.delta > 0) unitsAdded += c.delta
    else unitsRemoved -= c.delta
  }

  const lastRuns: Partial<Record<RunKind, RunDto>> = {}
  for (const kind of ["catalog", "stock", "orders", "statuses"] as RunKind[]) {
    const run = await lastRun(svc, kind)
    if (run) lastRuns[kind] = run
  }

  return {
    mode: demo ? "demo" : "live",
    configured: demo ? true : svc.isConfigured(),
    missing: svc.missingOptions(),
    tokenSet: Boolean(o.apiToken),
    options: {
      inventoryId: o.inventoryId,
      warehouseId: o.warehouseId || null,
      orderStatusId: o.orderStatusId,
      customSourceId: o.customSourceId,
      stockLocationId: o.stockLocationId || null,
      stockSync: o.stockSync,
      maxStockChangesPerRun: o.maxStockChangesPerRun,
      exportOrders: o.exportOrders,
      fulfillOnStatusIds: o.fulfillOnStatusIds,
      closedStatusIds: o.closedStatusIds,
      codProviders: o.codProviders,
      skipOrderMetadataKey: o.skipOrderMetadataKey,
      catalogSyncEnabled: o.catalogSyncEnabled,
      requestsPerMinute: o.requestsPerMinute,
    },
    features: {
      catalog: canReadCatalog(o),
      stock: canPlanStock(o) || (demo && o.stockSync !== "off"),
      orders: canExportOrders(o),
      statuses: canReadStatuses(o),
    },
    counts: {
      cards,
      linked,
      unmatched,
      conflicts,
      noSku,
      onlyInMedusa: num(lastRuns.catalog?.counts?.onlyInMedusa),
      stockChanges: changes.length,
      unitsAdded,
      unitsRemoved,
      ordersPending: pending,
      ordersSent: sent,
      ordersFailed: failed,
      ordersSkipped: skipped,
      ordersSent24h: sent24h,
    },
    lastRuns,
    lastCheck: lastCheck(demo ? "demo" : "live"),
    running: runningKinds(),
    schedules: { catalog: CATALOG_SCHEDULE, orders: ORDERS_SCHEDULE, statuses: STATUSES_SCHEDULE },
  }
}

/**
 * Demo mode, first visit: build the simulated catalog right away and send the
 * store's latest orders through the simulated account, so the page opens with
 * data instead of empty tables. Only when nothing ran yet.
 */
export async function ensureDemoSnapshot(scope: Scope): Promise<void> {
  const svc = baselinkerService(scope)
  if (!svc.isDemo() || isRunning("catalog")) return
  const [, runs] = await svc.listAndCountBaseLinkerSyncRuns({ kind: "catalog", source: "demo" } as never, { take: 1, select: ["id"] } as never)
  if (runs === 0) await runCatalogSync(scope, { trigger: "auto" })

  const [, orders] = await svc.listAndCountBaseLinkerOrders({ demo: true } as never, { take: 1, select: ["id"] } as never)
  if (orders > 0 || !svc.getOptions().exportOrders) return
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: ["id", "display_id", "status", "created_at"],
    pagination: { take: 8, order: { created_at: "DESC" } },
  })
  const recent = (data as Array<{ id: string; display_id?: number | null; status?: string | null }>).filter((r) => r.status !== "canceled")
  if (recent.length === 0) return
  for (const r of recent) await enqueueOrder(scope, { orderId: r.id, displayId: r.display_id ?? null })
  await sendDueOrders(scope, "auto")
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

/** `%q%` for `$ilike`, with the wildcard characters of the search escaped. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
