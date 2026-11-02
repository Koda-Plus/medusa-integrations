import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Counts, StatusResponse } from "../../../modules/vonhalsky/lib/contract"
import { mask, missingOptions } from "../../../modules/vonhalsky/lib/options"
import { caseFilter, offerFilter, orderFilter, readSettings, readSyncState, vonHalskySvc } from "../../../modules/vonhalsky/lib/store"
import { complianceOf, plnIncludesTax } from "../../../workflows/vonhalsky/catalog"
import { resolveTarget } from "../../../workflows/vonhalsky/orders"
import { clientOf, optionsOf, queryOf } from "../../../workflows/vonhalsky/runtime"
import { regionsOfStore, salesChannelsOfStore, shippingOptionsOfStore } from "../../vonhalsky/admin-helpers"

/**
 * GET /admin/vonhalsky: the page in one read: the mode, the options in use
 * (the client id and secret masked), the last rate limit seen, the category
 * tree, the settings, where imported orders land, the lists
 * the settings pick from and the counters. Read only: the demo sales
 * channel is created on the first simulated order, not here.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const o = optionsOf(req.scope)
  const svc = vonHalskySvc(req.scope)
  const offers = async (filters: Record<string, unknown>) => {
    try {
      const [, n] = await svc.listAndCountVonHalskyOffers(filters, { take: 1 })
      return Number(n) || 0
    } catch {
      return 0
    }
  }
  const orders = async (filters: Record<string, unknown>) => {
    try {
      const [, n] = await svc.listAndCountVonHalskyOrders(filters, { take: 1 })
      return Number(n) || 0
    } catch {
      return 0
    }
  }
  const count = async (fn: () => Promise<[unknown, number]>) => {
    try {
      const [, n] = await fn()
      return Number(n) || 0
    } catch {
      return 0
    }
  }
  const [all, listed, draft, blocked, closed, pending, imported, awaiting, trackingWaiting, held, offerErrors, commandsPending, casesOpen, categoryCount] = await Promise.all([
    offers({}),
    offers({ status: "listed" }),
    offers({ status: "draft" }),
    offers({ status: "blocked" }),
    offers({ status: "closed" }),
    offers(offerFilter("pending")),
    orders({ status: "imported" }),
    orders(orderFilter("awaiting_shipment")),
    orders(orderFilter("tracking_waiting")),
    orders({ status: "held" }),
    offers({ error: { $ne: null }, status: { $ne: "closed" } }),
    offers({ command_status: "PENDING" }),
    count(() => svc.listAndCountVonHalskyCases(caseFilter("open"), { take: 1 })),
    count(() => svc.listAndCountVonHalskyCategories({}, { take: 1 })),
  ])
  const counts: Counts = {
    offers: all,
    listed,
    draft,
    blocked,
    closed,
    pending,
    orders: imported,
    awaiting_shipment: awaiting,
    tracking_waiting: trackingWaiting,
    held,
    errors: held + offerErrors,
    commands_pending: commandsPending,
    cases_open: casesOpen,
  }
  const sync = await readSyncState(req.scope).catch(() => null)
  const seen = clientOf(req.scope)?.limits() ?? null
  let lastSyncAt: string | null = null
  try {
    const [newest] = await svc.listVonHalskySyncLogs({}, { take: 1, order: { created_at: "DESC" } })
    lastSyncAt = newest?.created_at ? new Date(newest.created_at).toISOString() : null
  } catch {
    lastSyncAt = null
  }
  const target = await resolveTarget(req.scope, false).catch(() => null)
  const body: StatusResponse = {
    mode: o.mode,
    configured: o.mode !== "off",
    demo: o.demo,
    environment: o.environment,
    missing: missingOptions(o),
    problems: o.problems,
    options: {
      apiUrl: o.credentials.apiUrl,
      tokenUrl: o.credentials.tokenUrl,
      organizationId: o.credentials.organizationId,
      clientId: mask(o.credentials.clientId),
      clientSecret: mask(o.credentials.clientSecret),
      vatRate: o.vatRate,
      pricesIncludeTax: o.pricesIncludeTax,
      pricesIncludeTaxNow: await plnIncludesTax(queryOf(req.scope), o.pricesIncludeTax),
      brandKey: o.brandKey,
      mpnKey: o.mpnKey,
      eanKey: o.eanKey,
      dimensionUnit: o.dimensionUnit,
      weightUnit: o.weightUnit,
    },
    settings: await readSettings(req.scope),
    target: {
      salesChannel: target?.salesChannelId ? { id: target.salesChannelId, name: target.salesChannelName ?? target.salesChannelId } : null,
      region: target?.regionId ? { id: target.regionId, name: target.regionName ?? target.regionId, currency: target.currency ?? "" } : null,
      channelNote: target?.channelNote ?? null,
    },
    shippingOptions: await shippingOptionsOfStore(req),
    salesChannels: await salesChannelsOfStore(req),
    regions: await regionsOfStore(req),
    compliance: Boolean(complianceOf(req.scope)),
    counts,
    lastSyncAt: sync?.at.sync ?? lastSyncAt,
    limits: seen && seen.limit !== null ? { limit: seen.limit, remaining: seen.remaining, resetAt: seen.resetAt ? new Date(seen.resetAt).toISOString() : null } : null,
    categories: { count: categoryCount, syncedAt: sync?.at.categories ?? null },
  }
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  res.json(body)
}
