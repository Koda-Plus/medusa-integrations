import { BOARD_WINDOW_DAYS } from "../../modules/emails/lib/constants"
import { templateLabels } from "../../modules/emails/lib/dto"
import { emailsCounters, recordSummary } from "../../modules/emails/lib/integration"
import { integrationEn, integrationPl } from "../../modules/emails/lib/integration-texts"
import { addressHash } from "../../modules/emails/lib/keys"
import { KIT_META } from "../../modules/emails/lib/kit-meta"
import { integrationRoutes, type MessageDraft, type SummaryDraft } from "../../modules/emails/lib/kit-routes"
import { missingOptions } from "../../modules/emails/lib/options"
import { providerNote } from "../../modules/emails/lib/provider-status"
import { isEmail } from "../../modules/emails/lib/security"
import type { SummaryRow } from "../../modules/emails/lib/store"
import { emailsService, queryOf, storeFor } from "./runtime"

/**
 * koda.integration/1 for E-mails: the manifest, one line per order and per
 * customer, and the board counters, read from the plugin's send log (and,
 * for a customer, the customer's address read by id, to find the e-mails of
 * guest orders by the hash of the address). Reads only: no demo seeding, no
 * Resend call, no write.
 *
 *   GET /admin/emails/integration
 *   GET /admin/emails/integration/summary?entity=order&id=order_...
 *   GET /admin/emails/integration/summary?entity=customer&ids=cus_1,cus_2
 *   GET /admin/emails/integration/attention?scope=orders,customers
 */
export const emailsIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "integration",
  adminPath: "/emails",
  entities: ["order", "customer"],
  attention: ["orders", "customers"],
  widgets: [{ id: "emails.order", zone: "order.details" }],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const o = emailsService(ctx.scope).getOptions()
    const note = providerNote()
    const configured = missingOptions(o).length === 0
    const problems: MessageDraft[] = []
    if (o.demo) problems.push({ key: "integration.problem.demo" })
    else if (o.mode === "dev") problems.push({ key: "integration.problem.no_key" })
    else if (!configured) problems.push({ key: "integration.problem.not_configured" })
    if (!note) problems.push({ key: "integration.problem.no_provider" })
    else if (note.mode !== o.mode) problems.push({ key: "integration.problem.mode_differs" })
    return {
      mode: o.demo ? "demo" : o.mode === "live" && configured ? "live" : "off",
      configured,
      lastSyncAt: null,
      problems,
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (entity !== "order" && entity !== "customer") return out
    const svc = emailsService(ctx.scope)
    const demo = svc.isDemo()
    const store = storeFor(ctx.scope)
    const labels = templateLabels(svc.getOptions())
    const lang = ctx.lang
    const sctx = {
      demo,
      label: (template: string) => labels[template]?.[lang] ?? labels[template]?.en ?? template,
      when: (value: string | Date) => ctx.date(value, true),
    }
    if (entity === "order") {
      const rows = await store.forOrders(ids, demo)
      for (const id of ids) {
        const draft = recordSummary(
          rows.filter((r) => r.order_id === id),
          "order",
          id,
          sctx,
        )
        if (draft) out.set(id, draft)
      }
      return out
    }
    /* Customers: their own messages, and those to their current address (orders placed as a guest), found by its hash. */
    const { data } = await queryOf(ctx.scope).graph({ entity: "customer", fields: ["id", "email"], filters: { id: ids } })
    const hashOf = new Map<string, string>()
    for (const c of data as Array<{ id?: string; email?: string | null }>) {
      const email = String(c?.email ?? "").trim()
      if (c?.id && isEmail(email)) hashOf.set(c.id, addressHash(email))
    }
    const rows = await store.forCustomers(ids, [...hashOf.values()], demo)
    for (const id of ids) {
      const hash = hashOf.get(id)
      const mine: SummaryRow[] = rows.filter((r) => r.customer_id === id || (hash !== undefined && r.recipient_hash === hash))
      const draft = recordSummary(mine, "customer", id, sctx)
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const svc = emailsService(ctx.scope)
    const since = new Date(Date.now() - BOARD_WINDOW_DAYS * 24 * 3600 * 1000)
    return emailsCounters(await storeFor(ctx.scope).boardCounts(svc.isDemo(), since))
  },
})
