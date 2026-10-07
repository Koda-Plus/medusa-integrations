import { isConnected } from "../../modules/allegro/lib/connection"
import type { ImportRow, OfferRow } from "../../modules/allegro/lib/dto"
import { ALLEGRO_EXTERNAL_HOSTS, allegroCounters, offersSummary, orderSummary } from "../../modules/allegro/lib/integration"
import { integrationEn, integrationPl } from "../../modules/allegro/lib/integration-texts"
import { KIT_META } from "../../modules/allegro/lib/kit-meta"
import { integrationRoutes, type MessageDraft, type SummaryDraft } from "../../modules/allegro/lib/kit-routes"
import { STOCK_ISSUES } from "../../modules/allegro/lib/stock"
import { WRITER_KEYS } from "../../modules/allegro/lib/writers"
import { allegroOf } from "./runtime"
import { armedWriters } from "./writers"

/**
 * koda.integration/1 for Allegro: the manifest, one line per imported order,
 * product or variant, and the board counters, read from the plugin's own
 * tables (one query per table for a whole batch, counts for the boards).
 * Reads only: no demo seeding, no call to Allegro, no write.
 *
 *   GET /admin/allegro/integration
 *   GET /admin/allegro/integration/summary?entity=order&id=order_...
 *   GET /admin/allegro/integration/summary?entity=product&ids=prod_1,prod_2
 *   GET /admin/allegro/integration/attention?scope=orders,products
 */

async function countOf(list: Promise<unknown>): Promise<number> {
  const [, count] = (await list) as [unknown[], number]
  return Number(count) || 0
}

export const allegroIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/allegro",
  entities: ["order", "product", "variant"],
  attention: ["orders", "products"],
  widgets: [
    { id: "allegro.order", zone: "order.details" },
    { id: "allegro.product", zone: "product.details" },
  ],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...ALLEGRO_EXTERNAL_HOSTS],

  async status(ctx) {
    const svc = allegroOf(ctx.scope)
    const o = svc.getOptions()
    const configured = o.demo || svc.isConfigured()
    const connected = o.demo ? true : configured ? await isConnected(svc) : false
    const armed = configured ? (await armedWriters(svc)).size : 0
    const [last] = (await svc.listAllegroSyncRuns({ kind: "offers" } as never, { take: 1, order: { started_at: "DESC" }, select: ["finished_at", "started_at"] })) as unknown as Array<{
      finished_at?: Date | string | null
      started_at?: Date | string | null
    }>
    const problems: MessageDraft[] = []
    if (o.demo) problems.push({ key: "integration.problem.demo" })
    else if (!configured) problems.push({ key: "integration.problem.not_configured" })
    else if (!connected) problems.push({ key: "integration.problem.not_connected" })
    return {
      mode: o.demo ? "demo" : !configured ? "off" : o.environment === "sandbox" ? "sandbox" : "live",
      configured,
      writers: { armed, total: WRITER_KEYS.length },
      lastSyncAt: last?.finished_at ?? last?.started_at ?? null,
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    const svc = allegroOf(ctx.scope)
    const demo = svc.isDemo()
    if (entity === "order") {
      /* Ownership: the import rows that name these orders. Never order metadata. */
      const rows = (await svc.listAllegroOrderImports({ order_id: ids, demo } as never, { take: ids.length * 4 })) as unknown as ImportRow[]
      for (const id of ids) {
        const draft = orderSummary(
          rows.filter((r) => r.order_id === id),
          { demo, money: ctx.money },
        )
        if (draft) out.set(id, draft)
      }
      return out
    }
    if (entity === "product" || entity === "variant") {
      const key = entity === "product" ? "product_id" : "variant_id"
      const offers = (await svc.listAllegroOffers({ [key]: ids, demo } as never, { take: null })) as unknown as OfferRow[]
      const environment = svc.getOptions().environment
      for (const id of ids) {
        const draft = offersSummary(
          offers.filter((r) => r[key] === id),
          { demo, environment },
        )
        if (draft) out.set(id, draft)
      }
    }
    return out
  },

  async count(ctx, scopes) {
    const svc = allegroOf(ctx.scope)
    const demo = svc.isDemo()
    const orders = scopes.includes("orders")
    const products = scopes.includes("products")
    const take = { take: 1, select: ["id"] }
    return allegroCounters({
      held: orders ? await countOf(svc.listAndCountAllegroOrderImports({ status: "held", demo } as never, take)) : 0,
      attention: orders
        ? await countOf(svc.listAndCountAllegroOrderImports({ demo, $or: [{ attention: { $ne: null } }, { total_mismatch: true }] } as never, take))
        : 0,
      issuesOpen: orders ? await countOf(svc.listAndCountAllegroIssues({ is_open: true, demo } as never, take)) : 0,
      stockProblems: products ? await countOf(svc.listAndCountAllegroOffers({ stock_state: [...STOCK_ISSUES], demo } as never, take)) : 0,
    })
  },
})
