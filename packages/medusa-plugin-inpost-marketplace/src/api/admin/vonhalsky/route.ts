import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { Counts, StatusResponse } from "../../../modules/vonhalsky/lib/contract"
import { mask, missingOptions } from "../../../modules/vonhalsky/lib/options"
import { readSettings, vonHalskySvc } from "../../../modules/vonhalsky/lib/store"
import { complianceOf, plnIncludesTax } from "../../../workflows/vonhalsky/catalog"
import { resolveTarget } from "../../../workflows/vonhalsky/orders"
import { optionsOf, queryOf } from "../../../workflows/vonhalsky/runtime"
import { regionsOfStore, salesChannelsOfStore, shippingOptionsOfStore } from "../../vonhalsky/admin-helpers"

/**
 * GET /admin/vonhalsky: the page in one read: the mode, the options in use
 * (the token masked), the settings, where imported orders land, the lists
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
  const [all, listed, draft, blocked, closed, imported, awaiting, trackingSent, held, trackingFailed, offerErrors] = await Promise.all([
    offers({}),
    offers({ status: "listed" }),
    offers({ status: "draft" }),
    offers({ status: "blocked" }),
    offers({ status: "closed" }),
    orders({ status: "imported" }),
    orders({ status: "imported", tracking_status: ["none", "pending_api"] }),
    orders({ tracking_status: "sent" }),
    orders({ status: "held" }),
    orders({ tracking_status: "failed" }),
    offers({ error: { $ne: null }, status: { $ne: "closed" } }),
  ])
  const counts: Counts = { offers: all, listed, draft, blocked, closed, orders: imported, awaiting_shipment: awaiting, tracking_sent: trackingSent, held, tracking_failed: trackingFailed, errors: held + trackingFailed + offerErrors }
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
    apiPending: o.mode === "live" || o.mode === "sandbox",
    missing: missingOptions(o),
    problems: o.problems,
    options: {
      apiUrl: o.credentials.apiUrl,
      organizationId: o.credentials.organizationId,
      accessToken: mask(o.credentials.accessToken),
      sendTracking: o.sendTracking,
      vatRate: o.vatRate,
      pricesIncludeTax: o.pricesIncludeTax,
      pricesIncludeTaxNow: await plnIncludesTax(queryOf(req.scope), o.pricesIncludeTax),
      brandKey: o.brandKey,
      mpnKey: o.mpnKey,
      eanKey: o.eanKey,
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
    lastSyncAt,
  }
  res.setHeader("Cache-Control", "no-store, must-revalidate")
  res.json(body)
}
