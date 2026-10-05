import type { MedusaRequest } from "@medusajs/framework/http"
import type { IUserModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import type BaseLinkerModuleService from "../../../modules/baselinker/service"
import {
  CATALOG_SCHEDULE,
  IMPORT_SCHEDULE,
  ORDERS_SCHEDULE,
  RETURNS_SCHEDULE,
  STATUSES_SCHEDULE,
} from "../../../modules/baselinker/lib/constants"
import { PLAN_KINDS, RUN_KINDS, type PlanKind, type PlanSummary, type RunDto, type RunKind, type StatusResponse, type WriterDto } from "../../../modules/baselinker/lib/contract"
import { iso } from "../../../modules/baselinker/lib/dto"
import { journalHealth } from "../../../modules/baselinker/lib/journal"
import { exportVerdict } from "../../../modules/baselinker/lib/order-import"
import {
  canExportOrders,
  canImportOrders,
  canPlanStock,
  canPushPrices,
  canPushStock,
  canReadCatalog,
  canReadReturns,
  canReadStatuses,
  canWriteInvoiceNumbers,
} from "../../../modules/baselinker/lib/options"
import type { WriterState } from "../../../modules/baselinker/lib/writers"
import { runCatalogSync } from "../../../workflows/baselinker/catalog"
import { loadJournalState } from "../../../workflows/baselinker/journal"
import { importRules } from "../../../workflows/baselinker/order-import"
import { enqueueOrder, sendDueOrders } from "../../../workflows/baselinker/orders"
import { quarantinedCount, storedSummary } from "../../../workflows/baselinker/plans"
import { baselinkerService, isRunning, lastCheck, lastRun, queryOf, runningKinds, type Scope } from "../../../workflows/baselinker/runtime"
import { loadWriters, type Actor } from "../../../workflows/baselinker/settings"

/* Only files named `route.ts` register routes; this one is a helper. */

export { baselinkerService }

type Counted = "products" | "orders" | "imports" | "invoices"

async function count(svc: BaseLinkerModuleService, what: Counted, filters: Record<string, unknown>): Promise<number> {
  const config = { take: 1, select: ["id"] } as never
  const [, n] =
    what === "products"
      ? await svc.listAndCountBaseLinkerProducts(filters as never, config)
      : what === "orders"
        ? await svc.listAndCountBaseLinkerOrders(filters as never, config)
        : what === "imports"
          ? await svc.listAndCountBaseLinkerImports(filters as never, config)
          : await svc.listAndCountBaseLinkerInvoices(filters as never, config)
  return n
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function toWriterDto(w: WriterState): WriterDto {
  return { ...w }
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

  /* Main cards with variants (containers) are never linked: they do not count as cards to link. SQL `!=` skips nulls, hence the `$or`. */
  const sellable = { $or: [{ match_source: null }, { match_source: { $ne: "parent" } }] }
  const [cards, linked, unmatched, conflicts, noSku, pending, sent, failed, skipped, sent24h] = await Promise.all([
    count(svc, "products", { demo, ...sellable }),
    count(svc, "products", { demo, variant_id: { $ne: null } }),
    count(svc, "products", { demo, variant_id: null, conflict: null, ...sellable }),
    count(svc, "products", { demo, conflict: { $ne: null } }),
    count(svc, "products", { demo, sku: null, ...sellable }),
    count(svc, "orders", { demo, status: "pending" }),
    count(svc, "orders", { demo, status: "sent" }),
    count(svc, "orders", { demo, status: "failed" }),
    count(svc, "orders", { demo, status: "skipped" }),
    count(svc, "orders", { demo, status: "sent", sent_at: { $gte: dayAgo } }),
  ])
  const [impPending, impImported, impSkipped, impFailed, impFlagged, imp24h, invPending, invWritten, invConflict, invFailed, invSkipped] = await Promise.all([
    count(svc, "imports", { demo, status: "pending" }),
    count(svc, "imports", { demo, status: "imported" }),
    count(svc, "imports", { demo, status: "skipped" }),
    count(svc, "imports", { demo, status: "failed" }),
    count(svc, "imports", { demo, flag: { $ne: null } }),
    count(svc, "imports", { demo, status: "imported", imported_at: { $gte: dayAgo } }),
    count(svc, "invoices", { demo, status: "pending" }),
    count(svc, "invoices", { demo, status: "written" }),
    count(svc, "invoices", { demo, status: "conflict" }),
    count(svc, "invoices", { demo, status: "failed" }),
    count(svc, "invoices", { demo, status: "skipped" }),
  ])
  const [, returns] = (await svc.listAndCountBaseLinkerReturns({ demo } as never, { take: 1, select: ["id"] } as never)) as unknown as [unknown[], number]

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
  for (const kind of RUN_KINDS) {
    const run = await lastRun(svc, kind)
    if (run) lastRuns[kind] = run
  }
  const plans = {} as Record<PlanKind, PlanSummary>
  for (const kind of PLAN_KINDS) plans[kind] = await storedSummary(svc, kind)

  const { directions, writers } = await loadWriters(svc)
  const journal = await loadJournalState(svc).catch(() => null)

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
    schedules: { catalog: CATALOG_SCHEDULE, orders: ORDERS_SCHEDULE, statuses: STATUSES_SCHEDULE, imports: IMPORT_SCHEDULE, returns: RETURNS_SCHEDULE },
    directions: { catalog: directions.catalog, stock: directions.stock, switchable: demo },
    writers: writers.map(toWriterDto),
    references: o.references,
    journal: {
      mode: o.journal,
      state: journalHealth(journal, o.journal, demo),
      lastLogId: journal?.lastLogId ?? null,
      lastEventAt: journal?.lastEventAt ? new Date(journal.lastEventAt * 1000).toISOString() : null,
      lastReadAt: journal?.lastReadAt ? iso(new Date(journal.lastReadAt)) : null,
    },
    more: {
      catalogSource: o.catalogSource,
      stockSource: o.stockSource,
      priceGroupId: demo ? o.priceGroupId ?? 1001 : o.priceGroupId,
      priceCurrency: o.priceCurrency,
      maxCatalogChangesPerRun: o.maxCatalogChangesPerRun,
      maxPriceChangesPerRun: o.maxPriceChangesPerRun,
      quarantineAfter: o.quarantineAfter,
      catalogImportStatus: o.catalogImportStatus,
      createMissingCategories: o.createMissingCategories,
      manufacturerAs: o.manufacturerAs,
      draftRemovedProducts: o.draftRemovedProducts,
      weightUnit: o.weightUnit,
      orderImportSources: importRules(o).map((r) => (r.id === null ? r.type : `${r.type}:${r.id}`)),
      orderImportSalesChannelId: o.orderImportSalesChannelId || null,
      orderImportRegionId: o.orderImportRegionId || null,
      orderImportShippingOptionId: o.orderImportShippingOptionId || null,
      orderImportCancelStatusIds: o.orderImportCancelStatusIds,
      orderImportMaxAgeHours: o.orderImportMaxAgeHours,
      exportMarketplaceOrders: o.exportMarketplaceOrders,
      returnsSync: o.returnsSync,
      returnsWindowDays: o.returnsWindowDays,
      invoiceNumberField: o.invoiceNumberField,
      invoiceNumberKinds: o.invoiceNumberKinds,
      writersOff: o.writersOff,
    },
    features2: {
      catalogImport: canReadCatalog(o),
      cards: canReadCatalog(o),
      stockPush: canPushStock(o),
      prices: canPushPrices(o),
      orderImport: canImportOrders(o) && importRules(o).length > 0,
      returns: canReadReturns(o),
      invoiceNumbers: canWriteInvoiceNumbers(o),
    },
    counts2: {
      plans,
      imports: { pending: impPending, imported: impImported, skipped: impSkipped, failed: impFailed, flagged: impFlagged, imported24h: imp24h },
      returns,
      invoices: { pending: invPending, written: invWritten, conflict: invConflict, failed: invFailed, skipped: invSkipped },
      quarantined: await quarantinedCount(svc),
    },
  }
}

/**
 * Demo mode, first visit: build the simulated catalog right away and send the
 * store's latest orders through the simulated account, so the page opens with
 * data instead of empty tables. Only when nothing ran yet. Orders that came
 * from BaseLinker (or straight from a marketplace) are never sent back.
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
    fields: ["id", "display_id", "status", "created_at", "metadata"],
    pagination: { take: 8, order: { created_at: "DESC" } },
  })
  const recent = (data as Array<{ id: string; display_id?: number | null; status?: string | null; metadata?: Record<string, unknown> | null }>).filter(
    (r) => r.status !== "canceled" && exportVerdict(r.metadata, svc.getOptions().exportMarketplaceOrders).send,
  )
  if (recent.length === 0) return
  for (const r of recent) await enqueueOrder(scope, { orderId: r.id, displayId: r.display_id ?? null })
  await sendDueOrders(scope, "auto")
}

/** Who is doing this, for the record: the admin user's e-mail (or name), from the session. */
export async function actorOf(req: MedusaRequest): Promise<Actor> {
  const id = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null
  if (!id) return { id: null, label: null }
  try {
    const users = req.scope.resolve<IUserModuleService>(Modules.USER)
    const user = await users.retrieveUser(id, { select: ["id", "email", "first_name", "last_name"] })
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ")
    return { id, label: user.email || name || id }
  } catch {
    return { id, label: id }
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

/** `%q%` for `$ilike`, with the wildcard characters of the search escaped. */
export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}
