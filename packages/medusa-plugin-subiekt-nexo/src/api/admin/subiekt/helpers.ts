import type { MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type SubiektModuleService from "../../../modules/subiekt/service"
import { CONTRACT_VERSION, EVENTS_SCHEDULE, PLUGIN_VERSION, PRODUCTS_SCHEDULE, STOCK_SCHEDULE, TASKS_SCHEDULE } from "../../../modules/subiekt/lib/constants"
import type { BridgeHealth, DiagnosticsDto, RunDto, RunKind, SignatureState, SubiektStatusResponse } from "../../../modules/subiekt/lib/contract"
import { capabilitiesOf, isLegacy, missingCapabilities } from "../../../modules/subiekt/lib/capabilities"
import { iso, toRunDto, type ConnectionRow, type RunRow } from "../../../modules/subiekt/lib/dto"
import { bridgeHost, optionWarnings } from "../../../modules/subiekt/lib/options"
import { describeWriters } from "../../../modules/subiekt/lib/writers"
import { checkConnection } from "../../../workflows/subiekt/health"
import { queryOf, getConnection, runningKinds, subiektService, type Scope } from "../../../workflows/subiekt/runtime"
import { runProductSync } from "../../../workflows/subiekt/sync-subiekt-products"
import { runStockSync } from "../../../workflows/subiekt/sync-subiekt-stock"
import { enqueueTask, runDueTasks } from "../../../workflows/subiekt/tasks"
import { setWriter, writerRows } from "../../../workflows/subiekt/writers"

/* Only files named `route.ts` register routes; this one is a helper. */

export { subiektService }

async function count(svc: SubiektModuleService, kind: "task" | "document", filters: Record<string, unknown>): Promise<number> {
  const [, n] =
    kind === "task"
      ? await svc.listAndCountSubiektTasks(filters as never, { take: 1, select: ["id"] } as never)
      : await svc.listAndCountSubiektDocuments(filters as never, { take: 1, select: ["id"] } as never)
  return n
}

function diagnosticsOf(conn: ConnectionRow): DiagnosticsDto {
  const health = (conn.health as unknown as BridgeHealth | null) ?? null
  const d = (conn.diagnostics ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" ? v : null)
  return {
    checkedAt: iso(conn.checked_at),
    latencyMs: typeof conn.latency_ms === "number" ? conn.latency_ms : null,
    clockSkewMs: typeof conn.clock_skew_ms === "number" ? conn.clock_skew_ms : null,
    signature: (str(d.signature) as SignatureState | null) ?? "unknown",
    capabilities: capabilitiesOf(health),
    legacy: Boolean(health) && isLegacy(health),
    missing: missingCapabilities(health),
    webhook: { lastAt: str(d.webhookAt), rejectedAt: str(d.webhookRejectedAt), rejectReason: str(d.webhookRejectReason) },
  }
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

  const [waiting, pending, running, unknown, failed, succeeded24h, documents, zk, wz, fs, pa] = await Promise.all([
    count(svc, "task", { demo, status: "waiting" }),
    count(svc, "task", { demo, status: "pending" }),
    count(svc, "task", { demo, status: "running" }),
    count(svc, "task", { demo, status: "unknown" }),
    count(svc, "task", { demo, status: "failed" }),
    count(svc, "task", { demo, status: "succeeded", succeeded_at: { $gte: dayAgo } }),
    count(svc, "document", { demo }),
    count(svc, "document", { demo, kind: "ZK" }),
    count(svc, "document", { demo, kind: "WZ" }),
    count(svc, "document", { demo, kind: "FS" }),
    count(svc, "document", { demo, kind: "PA" }),
  ])

  const lastRuns: Partial<Record<RunKind, RunDto>> = {}
  for (const kind of ["stock", "events", "tasks", "health", "products"] as RunKind[]) {
    const rows = (await svc.listSubiektSyncRuns({ kind, demo } as never, { take: 1, order: { started_at: "DESC" } } as never)) as unknown as RunRow[]
    if (rows[0]) lastRuns[kind] = toRunDto(rows[0])
  }
  const diagnostics = diagnosticsOf(conn)

  return {
    mode: demo ? "demo" : "live",
    configured: demo ? true : svc.isConfigured(),
    missing: svc.missingOptions(),
    optionWarnings: optionWarnings(o),
    bridgeHost: bridgeHost(o),
    pluginVersion: PLUGIN_VERSION,
    contractVersion: CONTRACT_VERSION,
    options: {
      prepaidProviders: o.prepaidProviders,
      stockSyncEnabled: o.stockSyncEnabled,
      stockLocationId: o.stockLocationId || null,
      stockField: o.stockField,
      stockDryRun: o.demo || o.stockDryRun,
      issueWzOnFulfillment: o.issueWzOnFulfillment,
      fulfillOnWz: o.fulfillOnWz,
      eventsEnabled: o.eventsEnabled,
      productSyncEnabled: o.productSyncEnabled,
      priceTarget: o.priceTarget,
      priceListId: o.priceListId || null,
      priceLevel: o.priceLevel || null,
      priceType: o.priceType,
      priceCurrency: o.priceCurrency,
      maxPriceChangesPerRun: o.maxPriceChangesPerRun,
      maxProductsPerRun: o.maxProductsPerRun,
      nipSources: o.nipSources,
      salesDocument: o.salesDocument,
      salesDocumentAfter: o.salesDocumentAfter,
      cfAccess: Boolean(o.cfAccessClientId && o.cfAccessClientSecret),
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
    diagnostics,
    writers: describeWriters(o, await writerRows(svc), diagnostics.capabilities),
    counts: { waiting, pending, running, unknown, failed, succeeded24h, documents, zk, wz, fs, pa },
    lastRuns,
    running: runningKinds(),
    schedules: { tasks: TASKS_SCHEDULE, events: EVENTS_SCHEDULE, stock: STOCK_SCHEDULE, products: PRODUCTS_SCHEDULE },
    references: o.references,
  }
}

/** "Anna Nowak (anna@shop.pl)" for the person behind an admin request, as the writers' audit shows it. */
export async function actorName(scope: Scope, actorId: string | null | undefined): Promise<string | null> {
  if (!actorId) return null
  try {
    const users = (scope as { resolve<T>(k: string): T }).resolve<{ retrieveUser(id: string, config?: Record<string, unknown>): Promise<{ email?: string | null; first_name?: string | null; last_name?: string | null }> }>(Modules.USER)
    const user = await users.retrieveUser(actorId, { select: ["id", "email", "first_name", "last_name"] })
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ")
    return name && user.email ? `${name} (${user.email})` : user.email ?? name ?? actorId
  } catch {
    return actorId
  }
}

/**
 * Demo mode, first visit: send the store's latest orders through the
 * simulated bridge right away, so the page opens with ZK numbers instead of
 * empty tables, arm the documents and contractors writers (the demo bridge
 * issues FS and PA with KSeF numbers), and plan prices from the catalog.
 * Only when the queue has never seen a task.
 */
export async function ensureDemoSnapshot(scope: Scope): Promise<void> {
  const svc = subiektService(scope)
  if (!svc.isDemo()) return

  // Once per demo database, also one that ran 0.1.0 before: the 1.1 health
  // (capabilities), the two writers the demo shows working, a first product plan.
  if ((await writerRows(svc)).length === 0) {
    await checkConnection(scope, "auto")
    await setWriter(scope, "documents", true, "demo (automatic)")
    await setWriter(scope, "contractors", true, "demo (automatic)")
  }
  const [, productRuns] = await svc.listAndCountSubiektSyncRuns({ kind: "products", demo: true } as never, { take: 1, select: ["id"] } as never)
  const [, tasks] = await svc.listAndCountSubiektTasks({ demo: true } as never, { take: 1, select: ["id"] } as never)

  if (tasks === 0) {
    const { data } = await queryOf(scope).graph({
      entity: "order",
      fields: ["id", "display_id", "status", "created_at"],
      pagination: { take: 8, order: { created_at: "DESC" } },
    })
    for (const o of data as Array<{ id: string; display_id?: number | null; status?: string }>) {
      if (o.status === "canceled") continue
      await enqueueTask(scope, { kind: "order.create", orderId: o.id, displayId: o.display_id ?? null, status: "pending", trigger: "auto" })
    }
    await runDueTasks(scope, "auto")
  }
  if (tasks === 0 || productRuns === 0) {
    setImmediate(() => {
      const stock = tasks === 0 ? runStockSync(scope, "auto") : Promise.resolve(null)
      stock
        .then(() => (productRuns === 0 ? runProductSync(scope, "auto") : null))
        .catch(() => undefined)
    })
  }
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
