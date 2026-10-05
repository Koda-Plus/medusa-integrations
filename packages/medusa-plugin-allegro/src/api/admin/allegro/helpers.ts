import type { MedusaContainer } from "@medusajs/framework/types"
import type { MedusaRequest } from "@medusajs/framework/http"
import type AllegroModuleService from "../../../modules/allegro/service"
import { ALLEGRO_MODULE, OFFERS_SCHEDULE, ORDERS_SCHEDULE, allegroUrls } from "../../../modules/allegro/lib/constants"
import { activeConnecting, environmentMismatch, getConnectionRow } from "../../../modules/allegro/lib/connection"
import type { AllegroStatusResponse } from "../../../modules/allegro/lib/contract"
import { iso, toRunDto, type RunRow } from "../../../modules/allegro/lib/dto"
import { statusGroup } from "../../../modules/allegro/lib/matching"
import { scopesFor } from "../../../modules/allegro/lib/options"
import { orderGroup } from "../../../modules/allegro/lib/orders"
import { isStockIssue } from "../../../modules/allegro/lib/stock"
import { isOffersSyncRunning } from "../../../workflows/allegro/run-offers"
import { isOrdersSyncRunning } from "../../../workflows/allegro/run-orders"
import { syncAllegroOffersWorkflow } from "../../../workflows/allegro/sync-allegro-offers"
import { syncAllegroOrdersWorkflow } from "../../../workflows/allegro/sync-allegro-orders"

/* Only files named `route.ts` register routes; this one is a helper. */

export function allegroService(scope: MedusaRequest["scope"] | MedusaContainer): AllegroModuleService {
  return scope.resolve<AllegroModuleService>(ALLEGRO_MODULE)
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
  bought_at: Date | string | null
}

async function lastRun(svc: AllegroModuleService, kind: "offers" | "orders") {
  const runs = (await svc.listAllegroSyncRuns({ kind } as never, { take: 1, order: { started_at: "DESC" } })) as unknown as RunRow[]
  return runs[0] ? toRunDto(runs[0]) : null
}

/**
 * Status for the admin. READS OUR DATABASE ONLY: not a single call to Allegro
 * while rendering. Going to the network sits behind POST routes and clicks.
 */
export async function buildStatus(svc: AllegroModuleService): Promise<AllegroStatusResponse> {
  const o = svc.getOptions()
  const urls = allegroUrls(o.environment)
  const raw = o.demo ? null : await getConnectionRow(svc)
  const mismatch = o.demo ? null : environmentMismatch(svc, raw)
  const row = raw && !mismatch ? raw : null

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
    select: ["status", "fulfillment_status", "unmatched_lines", "bought_at"],
  })) as unknown as OrderCountRow[]
  counts.orders = orders.length
  for (const r of orders) {
    if (orderGroup(r.status, r.fulfillment_status) === "open") counts.ordersOpen += 1
    if ((r.unmatched_lines ?? 0) > 0) counts.ordersUnmatched += 1
  }

  return {
    mode: o.demo ? "demo" : "live",
    configured: o.demo ? true : svc.isConfigured(),
    missing: o.demo ? [] : svc.missingOptions(),
    environment: o.environment,
    webHost: new URL(urls.web).host,
    clientIdPrefix: o.clientId ? `${o.clientId.slice(0, 6)}...` : null,
    readOnly: true,
    scopes: scopesFor(o),
    schedules: { offers: OFFERS_SCHEDULE, orders: ORDERS_SCHEDULE },
    syncEnabled: o.syncEnabled,
    ordersEnabled: o.ordersEnabled,
    connection: {
      connected: Boolean(row?.refresh_token_enc) && !o.demo && svc.isConfigured(),
      connectedAt: iso(row?.connected_at),
      disconnectedAt: iso(row?.disconnected_at),
      refreshedAt: iso(row?.refreshed_at),
      accessExpiresAt: iso(row?.access_expires_at),
      scope: row?.scope ?? null,
      lastError: mismatch ?? row?.last_error ?? null,
      lastErrorAt: mismatch ? iso(raw?.refreshed_at) : iso(row?.last_error_at),
    },
    connecting: activeConnecting(svc, raw),
    counts,
    lastRuns: { offers: await lastRun(svc, "offers"), orders: await lastRun(svc, "orders") },
    running: { offers: isOffersSyncRunning(), orders: isOrdersSyncRunning() },
  }
}

/**
 * Demo mode, first visit: build the sample snapshot right away, so the page
 * opens with data instead of an empty table. Only when nothing ever ran,
 * otherwise an empty catalog would add a run on every page view.
 */
export async function ensureDemoSnapshot(scope: MedusaContainer, svc: AllegroModuleService): Promise<void> {
  if (!svc.isDemo()) return
  const runs = (await svc.listAllegroSyncRuns({}, { take: 50, select: ["kind"] })) as unknown as Array<{ kind: string }>
  if (!isOffersSyncRunning() && !runs.some((r) => r.kind === "offers")) {
    await syncAllegroOffersWorkflow(scope).run({ input: { trigger: "auto" } })
  }
  if (svc.getOptions().ordersEnabled && !isOrdersSyncRunning() && !runs.some((r) => r.kind === "orders")) {
    await syncAllegroOrdersWorkflow(scope).run({ input: { trigger: "auto" } })
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
