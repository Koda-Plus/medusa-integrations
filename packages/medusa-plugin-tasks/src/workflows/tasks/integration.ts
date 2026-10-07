import { integrationEn, integrationPl } from "../../modules/tasks/lib/integration-texts"
import { KIT_META } from "../../modules/tasks/lib/kit-meta"
import { dayIn, recordSummary, tasksCounters, type LinkedTask, type RecordType } from "../../modules/tasks/lib/integration"
import { ContractError, integrationRoutes, type IntegrationContext, type SummaryDraft } from "../../modules/tasks/lib/kit-routes"
import type { RequestContext } from "../../modules/tasks/lib/actor"
import { contextOf } from "./context"
import { ActionError, envOf } from "./runtime"

/**
 * koda.integration/1 for Tasks: the manifest, one line per order, product or
 * customer with linked tasks, and the board counters.
 *
 *   GET /admin/tasks/integration
 *   GET /admin/tasks/integration/summary?entity=order&id=order_...
 *   GET /admin/tasks/integration/attention?scope=orders,integration
 *
 * THE SAME BOARD AS EVERY OTHER ROUTE. The board comes from the account (or
 * key) behind the request through `contextOf`, exactly as the plugin's own
 * routes decide it: a sandbox account reads the sandbox board and nothing
 * else, everyone else the main board. When the account cannot be read the
 * answer fails closed (summaries say "unavailable", counters refuse).
 *
 * Reads only: one statement for the summaries (links joined with their
 * tasks), two grouped counts for the counters, no seeding, no event, no
 * outside call. "Overdue" is counted by the day in the request's time zone
 * (`tz`), the same rule as the board's own counters.
 */

const RECORD_TYPES: readonly RecordType[] = ["order", "product", "customer"]

/** The request context of the asking account, as the plugin's own routes get it. */
async function boardOf(ctx: IntegrationContext): Promise<RequestContext> {
  try {
    return await contextOf(ctx.scope, { actor_id: ctx.actor.id, actor_type: ctx.actor.type })
  } catch (err) {
    if (err instanceof ActionError) throw new ContractError(err.status, err.code, err.message)
    throw err
  }
}

/** The start of the request's day in its time zone, as the stored due dates compare (a due day is stored at noon UTC). */
function dayStart(ctx: IntegrationContext): { today: string; start: Date } {
  const today = dayIn(ctx.tz)
  return { today, start: new Date(`${today}T00:00:00.000Z`) }
}

export const tasksIntegration = integrationRoutes({
  ns: KIT_META.ns,
  package: KIT_META.pkg,
  version: KIT_META.version,
  name: KIT_META.name,
  kind: "module",
  adminPath: "/tasks",
  entities: ["order", "product", "customer"],
  attention: ["orders", "products", "customers", "integration"],
  widgets: [
    { id: "tasks.order", zone: "order.details" },
    { id: "tasks.product", zone: "product.details" },
    { id: "tasks.customer", zone: "customer.details" },
  ],
  texts: { en: integrationEn, pl: integrationPl },
  externalHosts: [],

  async status(ctx) {
    const o = envOf(ctx.scope).options
    let sandbox: boolean | null = null
    try {
      sandbox = (await boardOf(ctx)).sandbox
    } catch {
      /* an account that cannot be read hears nothing about the setup */
    }
    /* The setup problem is for the team: a sandbox account is told nothing about the store's options. */
    const unguarded = sandbox === false && o.sandboxAccounts.length > 0 && !o.sandboxGuard.enabled
    return {
      mode: sandbox ? "sandbox" : "live",
      configured: true,
      lastSyncAt: null,
      problems: unguarded ? [{ key: "integration.problem.sandbox_unguarded" }] : [],
    }
  },

  async summarize(ctx, entity, ids) {
    const out = new Map<string, SummaryDraft>()
    if (!(RECORD_TYPES as readonly string[]).includes(entity)) return out
    const type = entity as RecordType
    const board = await boardOf(ctx)
    const rows = await envOf(ctx.scope).stores.board(board.board).linkedTasks(type, ids)
    const { today } = dayStart(ctx)
    const byRecord = new Map<string, LinkedTask[]>()
    for (const r of rows) {
      const list = byRecord.get(r.entity_id) ?? []
      list.push(r)
      byRecord.set(r.entity_id, list)
    }
    for (const id of ids) {
      const draft = recordSummary(type, id, byRecord.get(id) ?? [], today, ctx.lang)
      if (draft) out.set(id, draft)
    }
    return out
  },

  async count(ctx) {
    const board = await boardOf(ctx)
    const { start } = dayStart(ctx)
    /* "Mine" is the admin user asking; a key has no tasks of its own. */
    const me = board.actor.type === "user" ? board.actor.id : null
    const c = await envOf(ctx.scope).stores.board(board.board).attentionCounts(start, me)
    return tasksCounters({
      overdueOrders: c.overdue_orders,
      overdueProducts: c.overdue_products,
      overdueCustomers: c.overdue_customers,
      unassigned: c.unassigned,
      mine: c.mine,
    })
  },
})
