import { integrationEn, integrationPl } from "../../modules/inpost/lib/integration-texts"
import { KIT_META } from "../../modules/inpost/lib/kit-meta"
import { INPOST_EXTERNAL_HOSTS, inpostCounters, orderSummary, type ChosenInpost } from "../../modules/inpost/lib/integration"
import { integrationRoutes, type SummaryDraft } from "../../modules/inpost/lib/kit-routes"
import { readFulfillmentData } from "../../modules/inpost/lib/option-data"
import { PROBLEM_STATUSES, RETURNED_STATUSES } from "../../modules/inpost/lib/statuses"
import { canCallShipx } from "../../modules/inpost/lib/options"
import { inpostService, isArmed, listParcels, queryOf, storeFor, writerStates } from "./runtime"

/**
 * koda.integration/1 for InPost: the manifest, one line per order and the
 * board counters, read from the plugin's tables and the order's shipping
 * methods. Reads only: no demo seeding, no ShipX call, no write.
 *
 *   GET /admin/inpost/integration
 *   GET /admin/inpost/integration/summary?entity=order&id=order_...
 *   GET /admin/inpost/integration/attention?scope=orders
 */

const PROBLEMS = new Set([...PROBLEM_STATUSES, ...RETURNED_STATUSES])

export const inpostIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/inpost",
  entities: ["order"],
  attention: ["orders"],
  widgets: [{ id: "inpost.order", zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...INPOST_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = inpostService(ctx.scope)
    const o = svc.getOptions()
    const writers = await writerStates(svc)
    const states = Object.values(writers)
    const configured = o.demo || canCallShipx(o)
    return {
      mode: o.demo ? "demo" : configured ? (o.sandbox ? "sandbox" : "live") : "off",
      configured,
      writers: { armed: states.filter((w) => w.armed).length, total: states.length },
      lastSyncAt: null,
      problems: o.demo ? [{ key: "integration.problem.demo" }] : configured ? [] : [{ key: "integration.problem.not_configured" }],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "order") return out
    const svc = inpostService(ctx.scope)
    const demo = svc.isDemo()
    const rows = await listParcels(svc, { order_id: ids, demo }, { take: ids.length * 10, order: { parcel_no: "ASC" } })
    const { data } = await queryOf(ctx.scope).graph({
      entity: "order",
      fields: ["id", "display_id", "shipping_methods.data"],
      filters: { id: ids },
    })
    const orders = new Map((data as Array<{ id: string; display_id?: number | null; shipping_methods?: Array<{ data?: Record<string, unknown> | null }> | null }>).map((o) => [o.id, o]))
    const armed = svc.getOptions().writers.shipment && (await isArmed(svc, "shipment"))
    for (const id of ids) {
      const order = orders.get(id)
      let chosen: ChosenInpost | null = null
      for (const m of order?.shipping_methods ?? []) {
        const read = readFulfillmentData(m.data ?? null)
        if (!read) continue
        chosen = { kind: read.spec.kind, cod: read.spec.cod, locker: read.locker?.code ?? null }
        break
      }
      const own = rows.filter((r) => r.order_id === id)
      const displayId = typeof order?.display_id === "number" ? order.display_id : (own[0]?.display_id ?? null)
      const draft = orderSummary(own, chosen, { armed, demo, displayId, money: (minor) => ctx.money(minor / 100, "PLN") })
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = inpostService(ctx.scope)
    const grouped = await storeFor(ctx.scope).counts(svc.isDemo())
    let toCreate = 0
    let failed = 0
    let problems = 0
    let awaitingPayment = 0
    for (const g of grouped) {
      if (g.state === "pending" || g.state === "creating") toCreate += g.count
      else if (g.state === "failed" || g.state === "unknown") failed += g.count
      else if (g.state === "created" && g.status && PROBLEMS.has(g.status)) problems += g.count
      else if (g.state === "created" && g.status === "offers_prepared") awaitingPayment += g.count
    }
    return inpostCounters({ toCreate, failed, problems, awaitingPayment })
  },
})
