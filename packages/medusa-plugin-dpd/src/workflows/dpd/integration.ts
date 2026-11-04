import { countsOf } from "../../modules/dpd/lib/dto"
import { DPD_EXTERNAL_HOSTS, dpdCounters, orderSummary, type ChosenDpd } from "../../modules/dpd/lib/integration"
import { integrationEn, integrationPl } from "../../modules/dpd/lib/integration-texts"
import { KIT_META } from "../../modules/dpd/lib/kit-meta"
import { integrationRoutes, type MessageDraft, type SummaryDraft } from "../../modules/dpd/lib/kit-routes"
import { pickDpdMethod } from "../../modules/dpd/lib/option-data"
import { statusSourceOf } from "../../modules/dpd/lib/infoservices"
import { statusSettingKey } from "../../modules/dpd/lib/tracking"
import { dpdService, getSetting, listShipments, queryOf, storeFor, writerStates } from "./runtime"

/**
 * koda.integration/1 for DPD: the manifest, one line per order and the
 * board counters, read from the plugin's tables and the order's shipping
 * methods. Reads only: no demo seeding, no DPD call, no write.
 *
 *   GET /admin/dpd/integration
 *   GET /admin/dpd/integration/summary?entity=order&id=order_...
 *   GET /admin/dpd/integration/attention?scope=orders
 */

/** StatusSyncValue.at read leniently: an ISO string of a valid date, else null. */
function isoAt(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const at = (value as { at?: unknown }).at
  if (typeof at !== "string" || at === "") return null
  const ms = Date.parse(at)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function problemCode(value: unknown): unknown {
  return value && typeof value === "object" ? (value as { code?: unknown }).code : null
}

type OrderLite = {
  id: string
  display_id?: number | null
  shipping_methods?: Array<{ data?: Record<string, unknown> | null }> | null
}

export const dpdIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/dpd",
  entities: ["order"],
  attention: ["orders"],
  widgets: [{ id: "dpd.order", zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...DPD_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = dpdService(ctx.scope)
    const writers = Object.values(await writerStates(svc))
    const configured = svc.isConfigured()
    const problems: MessageDraft[] = []
    if (svc.isDemo()) problems.push({ key: "integration.problem.demo" })
    else if (!configured) problems.push({ key: "integration.problem.not_configured" })
    if (svc.senderProblems().length > 0) problems.push({ key: "integration.problem.sender" })
    const mode = svc.mode()
    const source = statusSourceOf(svc.getOptions())
    if (source === "off") problems.push({ key: "integration.problem.statuses_not_configured" })
    else if (source === "dpd" && problemCode((await getSetting(svc, statusSettingKey(mode, "problem")))?.value) === "statuses_auth") {
      problems.push({ key: "integration.problem.statuses_auth" })
    }
    return {
      mode: svc.isDemo() ? "demo" : configured ? svc.mode() : "off",
      configured,
      writers: { armed: writers.filter((w) => w.armed).length, total: writers.length },
      lastSyncAt: isoAt((await getSetting(svc, statusSettingKey(mode, "lastSyncAt")))?.value),
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "order") return out
    const svc = dpdService(ctx.scope)
    const mode = svc.mode()
    /* The id breaks a tie of created_at, as in codCarrierOf: the cash on delivery fact names the same row the plan does. */
    const rows = await listShipments(svc, { order_id: ids, mode }, { take: ids.length * 20, order: { created_at: "ASC", id: "ASC" } })
    const { data } = await queryOf(ctx.scope).graph({
      entity: "order",
      fields: ["id", "display_id", "shipping_methods.data"],
      filters: { id: ids },
    })
    const orders = new Map((data as OrderLite[]).map((o) => [o.id, o]))
    const armed = (await writerStates(svc)).shipment.armed
    for (const id of ids) {
      const order = orders.get(id)
      /* The same choice as the order card: the method the checkout validated, else the first DPD method. */
      const picked = pickDpdMethod(order?.shipping_methods)
      const chosen: ChosenDpd | null = picked ? { kind: picked.read.spec.kind, cod: picked.read.spec.cod, pudoId: picked.read.pudoId, country: picked.read.country } : null
      const own = rows.filter((r) => r.order_id === id)
      const displayId = typeof order?.display_id === "number" ? order.display_id : (own[0]?.display_id ?? null)
      const draft = orderSummary(own, chosen, { armed, demo: svc.isDemo(), displayId, money: (minor, currency) => ctx.money(minor / 100, currency) })
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = dpdService(ctx.scope)
    const store = storeFor(ctx.scope)
    const mode = svc.mode()
    return dpdCounters(countsOf(await store.counts(mode), await store.dispatchCounts(mode), await store.statusCounts(mode)))
  },
})
