import { integrationEn, integrationPl } from "../../modules/fakturownia/lib/integration-texts"
import { KIT_META } from "../../modules/fakturownia/lib/kit-meta"
import {
  ADMIN_PATH,
  FAKTUROWNIA_EXTERNAL_HOSTS,
  ORDER_WIDGET,
  customerSummary,
  fakturowniaCounters,
  orderSummary,
  type OrderFacts,
  type SummaryContext,
} from "../../modules/fakturownia/lib/integration"
import { integrationRoutes, type IntegrationContext, type SummaryDraft } from "../../modules/fakturownia/lib/kit-routes"
import { addDays, warsawDate } from "../../modules/fakturownia/lib/dates"
import { paymentFacts, type PaymentCollectionRecord } from "../../modules/fakturownia/lib/document"
import { documentFilters } from "../../modules/fakturownia/lib/filters"
import { money } from "../../modules/fakturownia/lib/numbers"
import type { DocumentRow, PlanRow } from "../../modules/fakturownia/lib/dto"
import { fakturowniaService, lastRun, listDocuments, listPlans, queryOf, writerStates } from "./runtime"

/**
 * koda.integration/1 for Fakturownia: the manifest, one line per order and
 * per customer, and the board counters, read from the plugin's tables and
 * the orders read by id (status and payments only). Reads only: no demo
 * seeding, no call to Fakturownia, no write.
 *
 *   GET /admin/fakturownia/integration
 *   GET /admin/fakturownia/integration/summary?entity=order&id=order_...   (or ids=, up to 50; entity=customer too)
 *   GET /admin/fakturownia/integration/attention?scope=orders
 */

/** What an order reads to tell "waits for the payment" from "to issue". */
const ORDER_FIELDS = [
  "id",
  "display_id",
  "status",
  "total",
  "customer_id",
  "payment_collections.*",
  "payment_collections.payments.*",
  "payment_collections.payments.captures.*",
]

interface OrderRecord {
  id: string
  display_id?: number | null
  status?: string | null
  total?: unknown
  customer_id?: string | null
  payment_collections?: PaymentCollectionRecord[] | null
}

/** Open plans and the approved ones whose correction is on its way. */
const PLAN_STATUSES = ["draft", "manual", "approved"]

/** At most this many orders of one batch of customers are read. */
const CUSTOMER_ORDERS_CAP = 500

function contextOf(ctx: IntegrationContext, corrections: boolean): SummaryContext {
  const svc = fakturowniaService(ctx.scope)
  const o = svc.getOptions()
  return {
    lang: ctx.lang,
    demo: o.demo,
    configured: svc.isConfigured(),
    correctionsArmed: corrections,
    overdueOn: addDays(warsawDate(new Date()), -o.reminderAfterDays),
    date: (value) => ctx.date(value),
  }
}

function factsOf(order: OrderRecord, trigger: string, codProviders: readonly string[]): OrderFacts {
  const captured = paymentFacts(order.payment_collections ?? [], money(order.total), codProviders).captured
  return {
    id: order.id,
    displayId: typeof order.display_id === "number" ? order.display_id : null,
    canceled: order.status === "canceled",
    triggerMet: trigger === "order_placed" || captured,
  }
}

export const fakturowniaIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: ADMIN_PATH,
  entities: ["order", "customer"],
  attention: ["orders"],
  widgets: [{ id: ORDER_WIDGET, zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [...FAKTUROWNIA_EXTERNAL_HOSTS],
  timeZone: "Europe/Warsaw",

  async status(ctx) {
    const svc = fakturowniaService(ctx.scope)
    const o = svc.getOptions()
    const states = Object.values(await writerStates(svc))
    const configured = svc.isConfigured()
    const last = await lastRun(svc, "issue")
    return {
      mode: o.demo ? "demo" : configured ? "live" : "off",
      configured,
      writers: { armed: states.filter((w) => w.armed).length, total: states.length },
      lastSyncAt: last?.finishedAt ?? last?.startedAt ?? null,
      problems: o.demo ? [{ key: "integration.problem.demo" }] : configured ? [] : [{ key: "integration.problem.not_configured" }],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "order" && entity !== "customer") return out
    const svc = fakturowniaService(ctx.scope)
    const o = svc.getOptions()
    const demo = svc.isDemo()

    /* The orders: by id, or the customers' newest ones, in one query. */
    const { data } = await queryOf(ctx.scope).graph({
      entity: "order",
      fields: ORDER_FIELDS,
      filters: entity === "order" ? { id: ids } : { customer_id: ids },
      ...(entity === "customer" ? { pagination: { take: CUSTOMER_ORDERS_CAP, order: { created_at: "DESC" } } } : {}),
    })
    const orders = (data as OrderRecord[]).filter((r) => r && typeof r.id === "string")
    const orderIds = entity === "order" ? ids : orders.map((r) => r.id)
    if (orderIds.length === 0) return out

    /* The plugin's rows of those orders, one query per table, and the corrections writer (one setting). */
    const rows = await listDocuments(svc, { order_id: orderIds, demo }, { take: orderIds.length * 20, order: { created_at: "ASC" } })
    const plans = await listPlans(svc, { order_id: orderIds, demo, status: PLAN_STATUSES }, { take: orderIds.length * 10, order: { created_at: "ASC" } })
    const armed = (await writerStates(svc)).corrections.armed
    const sctx = contextOf(ctx, armed)

    const rowsOf = new Map<string, DocumentRow[]>()
    for (const r of rows) rowsOf.set(r.order_id, [...(rowsOf.get(r.order_id) ?? []), r])
    const plansOf = new Map<string, PlanRow[]>()
    for (const p of plans) plansOf.set(p.order_id, [...(plansOf.get(p.order_id) ?? []), p])
    const factsOf_ = new Map(orders.map((r) => [r.id, factsOf(r, o.trigger, o.codProviders)]))

    if (entity === "order") {
      for (const id of ids) {
        const draft = orderSummary(rowsOf.get(id) ?? [], plansOf.get(id) ?? [], factsOf_.get(id) ?? null, sctx)
        if (draft) out.set(id, draft)
      }
      return out
    }
    for (const customerId of ids) {
      const mine = orders
        .filter((r) => r.customer_id === customerId)
        .map((r) => ({ facts: factsOf_.get(r.id) as OrderFacts, rows: rowsOf.get(r.id) ?? [], plans: plansOf.get(r.id) ?? [] }))
      const draft = customerSummary(customerId, mine, sctx)
      if (draft) out.set(customerId, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = fakturowniaService(ctx.scope)
    const demo = svc.isDemo()
    const page = { take: 20, select: ["order_id"] }
    const documents = async (filter: "attention" | "ksef" | "pending") =>
      (await svc.listAndCountFakturowniaDocuments(documentFilters(filter, demo) as never, page as never)) as unknown as [Array<{ order_id: string }>, number]
    const [attention, ksef, pending] = await Promise.all([documents("attention"), documents("ksef"), documents("pending")])
    const [plans, toApprove] = (await svc.listAndCountFakturowniaCorrections({ demo, status: ["draft", "manual"] } as never, page as never)) as unknown as [Array<{ order_id: string }>, number]
    const idsOf = (list: Array<{ order_id: string }>) => list.map((r) => r.order_id)
    return fakturowniaCounters(
      { attention: attention[1], ksef: ksef[1], toApprove, toIssue: pending[1] },
      { attention: idsOf(attention[0]), ksef: idsOf(ksef[0]), toApprove: idsOf(plans), toIssue: idsOf(pending[0]) },
    )
  },
})
