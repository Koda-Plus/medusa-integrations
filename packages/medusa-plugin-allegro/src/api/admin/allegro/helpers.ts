import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type AllegroModuleService from "../../../modules/allegro/service"
import {
  IMPORT_SCHEDULE,
  INVOICES_SCHEDULE,
  ISSUES_SCHEDULE,
  OFFERS_SCHEDULE,
  ORDERS_SCHEDULE,
  PLUGIN_VERSION,
  PRICES_SCHEDULE,
  PUBLISH_SCHEDULE,
  SHIPPING_SCHEDULE,
  STOCK_SCHEDULE,
  allegroUrls,
  sellerPanel,
} from "../../../modules/allegro/lib/constants"
import { activeConnecting, environmentMismatch, getConnectionRow } from "../../../modules/allegro/lib/connection"
import type { AllegroRunKind, AllegroStatusResponse } from "../../../modules/allegro/lib/contract"
import { iso, toRunDto, type RunRow } from "../../../modules/allegro/lib/dto"
import { issueCounts } from "../../../modules/allegro/lib/issues"
import { statusGroup } from "../../../modules/allegro/lib/matching"
import { publishProblems, readScopes, scopesFor } from "../../../modules/allegro/lib/options"
import { orderGroup } from "../../../modules/allegro/lib/orders"
import { isStockIssue } from "../../../modules/allegro/lib/stock"
import { grantedScopes, missingScopes } from "../../../modules/allegro/lib/writers"
import { planSummary } from "../../../workflows/allegro/plans"
import { cursorId, resolveTarget } from "../../../workflows/allegro/run-import"
import { isOffersSyncRunning } from "../../../workflows/allegro/run-offers"
import { isOrdersSyncRunning } from "../../../workflows/allegro/run-orders"
import { allegroOf, getState, isRunning as isRunRunning } from "../../../workflows/allegro/runtime"
import { syncAllegroOffersWorkflow } from "../../../workflows/allegro/sync-allegro-offers"
import { syncAllegroOrdersWorkflow } from "../../../workflows/allegro/sync-allegro-orders"
import { pushAllegroPricesWorkflow, pushAllegroStockWorkflow, publishAllegroOffersWorkflow, syncAllegroIssuesWorkflow } from "../../../workflows/allegro/writer-workflows"
import { writerDtos } from "../../../workflows/allegro/writers"

/* Only files named `route.ts` register routes; this one is a helper. */

export function allegroService(scope: MedusaRequest["scope"] | MedusaContainer): AllegroModuleService {
  return allegroOf(scope)
}

interface OfferCountRow {
  status: string
  variant_id: string | null
  product_id: string | null
  match_key: string | null
  is_primary: boolean
  stock_state: string | null
}

interface OrderCountRow {
  status: string
  fulfillment_status: string | null
  unmatched_lines: number
}

/** The offer sync and the journal keep their own flags (0.1); the 0.2 runs share one. */
function isRunning(kind: AllegroRunKind): boolean {
  if (kind === "offers") return isOffersSyncRunning()
  if (kind === "orders") return isOrdersSyncRunning()
  return isRunRunning(kind)
}

const RUN_KINDS: AllegroRunKind[] = ["offers", "orders", "stock", "prices", "import", "shipping", "invoices", "issues", "publish"]

async function lastRun(svc: AllegroModuleService, kind: AllegroRunKind) {
  const runs = (await svc.listAllegroSyncRuns({ kind } as never, { take: 1, order: { started_at: "DESC" } })) as unknown as RunRow[]
  return runs[0] ? toRunDto(runs[0]) : null
}

async function countBy<T extends string>(rows: ReadonlyArray<{ [k: string]: unknown }>, key: string): Promise<Record<T, number>> {
  const out = {} as Record<T, number>
  for (const r of rows) {
    const v = String(r[key] ?? "") as T
    out[v] = (out[v] ?? 0) + 1
  }
  return out
}

function fakturowniaPresent(scope: MedusaContainer | MedusaRequest["scope"]): boolean {
  try {
    const f = scope.resolve("fakturownia") as { downloadPdf?: unknown }
    return Boolean(f)
  } catch {
    return false
  }
}

/**
 * Status for the admin. READS OUR DATABASE ONLY (and Medusa's own tables):
 * not a single call to Allegro while rendering. Going to the network sits
 * behind POST routes and clicks.
 */
export async function buildStatus(scope: MedusaContainer | MedusaRequest["scope"]): Promise<AllegroStatusResponse> {
  const svc = allegroService(scope)
  const o = svc.getOptions()
  const urls = allegroUrls(o.environment)
  const raw = o.demo ? null : await getConnectionRow(svc)
  const mismatch = o.demo ? null : environmentMismatch(svc, raw)
  const row = raw && !mismatch ? raw : null
  const connected = Boolean(row?.refresh_token_enc) && !o.demo && svc.isConfigured()

  const offers = (await svc.listAllegroOffers({ demo: o.demo } as never, {
    take: null,
    select: ["status", "variant_id", "product_id", "match_key", "is_primary", "stock_state"],
  })) as unknown as OfferCountRow[]

  const counts = {
    offers: offers.length,
    live: 0,
    drafts: 0,
    ended: 0,
    linked: 0,
    linkedLive: 0,
    unmatchedLive: 0,
    noKey: 0,
    products: 0,
    stockIssues: 0,
    underListed: 0,
    endedInStock: 0,
    orders: 0,
    ordersOpen: 0,
    ordersUnmatched: 0,
  }
  const products = new Set<string>()
  for (const r of offers) {
    const g = statusGroup(r.status)
    if (g === "live") counts.live += 1
    else if (g === "draft") counts.drafts += 1
    else if (g === "ended") counts.ended += 1
    if (!r.match_key) counts.noKey += 1
    if (r.variant_id) {
      counts.linked += 1
      if (r.product_id) products.add(r.product_id)
      if (r.is_primary && g === "live") counts.linkedLive += 1
    } else if (r.match_key && g === "live") {
      counts.unmatchedLive += 1
    }
    if (isStockIssue(r.stock_state)) counts.stockIssues += 1
    if (r.stock_state === "under_listed") counts.underListed += 1
    if (r.stock_state === "ended_in_stock") counts.endedInStock += 1
  }
  counts.products = products.size

  const orders = (await svc.listAllegroOrders({ demo: o.demo } as never, {
    take: null,
    select: ["status", "fulfillment_status", "unmatched_lines"],
  })) as unknown as OrderCountRow[]
  counts.orders = orders.length
  for (const r of orders) {
    if (orderGroup(r.status, r.fulfillment_status) === "open") counts.ordersOpen += 1
    if ((r.unmatched_lines ?? 0) > 0) counts.ordersUnmatched += 1
  }

  const importRows = (await svc.listAllegroOrderImports({ demo: o.demo } as never, {
    take: null,
    select: ["status", "attention", "total_mismatch"],
  })) as unknown as Array<{ status: string; attention: string | null; total_mismatch: boolean }>
  const importStatus = await countBy<string>(importRows, "status")
  const cursor = await getState<{ id: string; at: string | null }>(svc, cursorId(o.demo))

  const outboxRows = (await svc.listAllegroOutboxes({ demo: o.demo } as never, { take: null, select: ["writer", "status"] })) as unknown as Array<{ writer: string; status: string }>
  const outbox = {
    shipping: { pending: 0, failed: 0, done: 0 },
    invoices: { pending: 0, failed: 0, done: 0 },
  }
  for (const r of outboxRows) {
    const bucket = r.writer === "invoices" ? outbox.invoices : outbox.shipping
    if (r.status === "done") bucket.done += 1
    else if (r.status === "failed") bucket.failed += 1
    else if (r.status !== "skipped") bucket.pending += 1
  }

  const issueRows = (await svc.listAllegroIssues({ demo: o.demo } as never, {
    take: null,
    select: ["kind", "is_open", "needs_reply", "due_at"],
  })) as unknown as Array<{ kind: "return" | "dispute" | "claim"; is_open: boolean; needs_reply: boolean; due_at: Date | string | null }>
  const ic = issueCounts(
    issueRows.map((r) => ({ kind: r.kind, open: Boolean(r.is_open), needsReply: Boolean(r.needs_reply), dueAt: iso(r.due_at) })),
    new Date(),
  )
  const messages = await getState<{ unread: number; scanned: number; at: string; demo?: boolean }>(svc, "messages")
  const lastIssues = await lastRun(svc, "issues")

  const writers = await writerDtos(svc)
  const granted = connected ? grantedScopes(row?.scope ?? "") : null
  const needed = [...new Set([...readScopes(o), ...writers.filter((w) => w.allowed).flatMap((w) => (w.blockers.includes("missing_scope") ? w.missingScopes : []))])]
  const target = await resolveTarget(scope as MedusaContainer, svc, "pln", false).catch(() => null)

  const lastRuns: AllegroStatusResponse["lastRuns"] = {}
  for (const kind of RUN_KINDS) lastRuns[kind] = await lastRun(svc, kind)

  return {
    mode: o.demo ? "demo" : "live",
    version: PLUGIN_VERSION,
    configured: o.demo ? true : svc.isConfigured(),
    missing: o.demo ? [] : svc.missingOptions(),
    environment: o.environment,
    webHost: new URL(urls.web).host,
    appsUrl: urls.apps,
    clientIdPrefix: o.clientId ? `${o.clientId.slice(0, 6)}...` : null,
    userAgent: o.userAgent,
    appName: o.appName,
    readOnly: !writers.some((w) => w.effective && w.writesAllegro),
    scopes: scopesFor(o),
    grantedScopes: granted,
    missingScopes: granted ? missingScopes(needed, granted) : [],
    schedules: {
      offers: OFFERS_SCHEDULE,
      orders: ORDERS_SCHEDULE,
      stock: STOCK_SCHEDULE,
      prices: PRICES_SCHEDULE,
      import: IMPORT_SCHEDULE,
      shipping: SHIPPING_SCHEDULE,
      invoices: INVOICES_SCHEDULE,
      issues: ISSUES_SCHEDULE,
      publish: PUBLISH_SCHEDULE,
    },
    syncEnabled: o.syncEnabled,
    ordersEnabled: o.ordersEnabled,
    connection: {
      connected,
      connectedAt: iso(row?.connected_at),
      disconnectedAt: iso(row?.disconnected_at),
      refreshedAt: iso(row?.refreshed_at),
      accessExpiresAt: iso(row?.access_expires_at),
      scope: row?.scope ?? null,
      lastError: mismatch ?? row?.last_error ?? null,
      lastErrorAt: mismatch ? iso(raw?.refreshed_at) : iso(row?.last_error_at),
    },
    connecting: activeConnecting(svc, raw),
    writers,
    settings: {
      stockPush: o.stockPush,
      stockPushCap: o.stockPushCap,
      endOffersAtZero: o.endOffersAtZero,
      breakerThreshold: o.breakerThreshold,
      importPerRun: o.orderImport.perRun,
      invoiceKinds: o.invoiceKinds,
      issues: o.issues,
      prices: {
        priceListId: o.prices.priceListId,
        minKey: o.prices.minKey,
        maxKey: o.prices.maxKey,
        requireFloor: o.prices.requireFloor,
        maxChangePercent: o.prices.maxChangePercent,
        cap: o.prices.cap,
      },
      publish: { ready: o.demo || publishProblems(o).length === 0, missing: o.demo ? [] : publishProblems(o), cap: o.publish.cap },
      importTarget: {
        salesChannelId: target?.salesChannelId ?? null,
        salesChannelName: target?.salesChannelName ?? null,
        regionId: target?.regionId ?? null,
        regionName: target?.regionName ?? null,
        shippingOptionId: o.orderImport.shippingOptionId,
        warnings: target?.warnings ?? [],
      },
      fakturownia: fakturowniaPresent(scope),
    },
    references: o.references,
    counts,
    plans: {
      stock: await planSummary(svc, "stock"),
      prices: await planSummary(svc, "prices"),
      publish: await planSummary(svc, "publish"),
    },
    imports: {
      pending: (importStatus.pending ?? 0) + (importStatus.unknown ?? 0) + (importStatus.importing ?? 0),
      held: importStatus.held ?? 0,
      imported: importStatus.imported ?? 0,
      skipped: importStatus.skipped ?? 0,
      cancelled: importStatus.cancelled ?? 0,
      attention: importRows.filter((r) => r.attention).length,
      mismatch: importRows.filter((r) => r.total_mismatch).length,
      cursor: cursor ? { id: cursor.id, at: cursor.at } : null,
      /* The last healthy import drain, recorded on the writer by every run (quiet runs leave no history row). */
      lastOkAt: writers.find((w) => w.key === "orders")?.lastSuccessAt ?? null,
    },
    outbox,
    issues: {
      ...ic,
      unreadThreads: messages && Boolean(messages.demo) === o.demo ? messages.unread : null,
      threadsScanned: messages && Boolean(messages.demo) === o.demo ? messages.scanned : 0,
      checkedAt: lastIssues?.finishedAt ?? null,
    },
    panel: sellerPanel(o.environment),
    lastRuns,
    running: Object.fromEntries(RUN_KINDS.map((k) => [k, isRunning(k)])) as Record<AllegroRunKind, boolean>,
  }
}

/**
 * Demo mode, first visit: build the sample data right away, so the page
 * opens with data instead of empty tables. Only what never ran yet.
 */
export async function ensureDemoSnapshot(scope: MedusaContainer, svc: AllegroModuleService): Promise<void> {
  if (!svc.isDemo()) return
  const runs = (await svc.listAllegroSyncRuns({}, { take: 200, select: ["kind"] })) as unknown as Array<{ kind: string }>
  const ran = new Set(runs.map((r) => r.kind))
  if (!isRunning("offers") && !ran.has("offers")) await syncAllegroOffersWorkflow(scope).run({ input: { trigger: "auto" } })
  if (svc.getOptions().ordersEnabled && !isRunning("orders") && !ran.has("orders")) await syncAllegroOrdersWorkflow(scope).run({ input: { trigger: "auto" } })
  if (!isRunning("stock") && !ran.has("stock")) await pushAllegroStockWorkflow(scope).run({ input: { trigger: "auto", mode: "plan" } })
  if (!isRunning("prices") && !ran.has("prices")) await pushAllegroPricesWorkflow(scope).run({ input: { trigger: "auto", mode: "plan" } })
  if (!isRunning("issues") && !ran.has("issues")) await syncAllegroIssuesWorkflow(scope).run({ input: { trigger: "auto" } })
  if (!isRunning("publish") && !ran.has("publish")) await publishAllegroOffersWorkflow(scope).run({ input: { trigger: "auto", mode: "plan" } })
}

/** Who is clicking: the admin user's name or e-mail, for the writer toggles. */
export async function actorOf(req: MedusaRequest): Promise<{ id: string | null; name: string }> {
  const id = (req as MedusaRequest & { auth_context?: { actor_id?: string } }).auth_context?.actor_id ?? null
  if (!id) return { id: null, name: "admin" }
  try {
    const users = req.scope.resolve(Modules.USER) as unknown as {
      retrieveUser(id: string, config?: Record<string, unknown>): Promise<{ email?: string | null; first_name?: string | null; last_name?: string | null }>
    }
    const user = await users.retrieveUser(id, { select: ["email", "first_name", "last_name"] })
    const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
    return { id, name: name ? `${name} (${user.email ?? id})` : user.email ?? id }
  } catch {
    return { id, name: id }
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

export function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export function errorOf(svc: AllegroModuleService, err: unknown): string {
  return svc.mask(err instanceof Error ? err.message : String(err))
}
