/**
 * THE DEMO DATA, PREPARED BY A WRITE, NEVER BY A READ.
 *
 * In demo mode the page opens on sample data: the offer snapshot, the order
 * journal, the stock, price and draft plans and the customer issues. They are
 * built here, once each kind that has never run, by the job
 * `allegro-demo-seed` (every minute, demo mode only, under a lease so the
 * server and a worker do not both seed) or by "Prepare now" on the page
 * (`POST /admin/allegro/demo/seed`). `GET /admin/allegro` only reads, and
 * says in `demoSeed` what is still missing.
 *
 * One kind that fails does not stop the others; it is tried again by the
 * next run of the job.
 */

import { randomUUID } from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import type AllegroModuleService from "../../modules/allegro/service"
import { RUN_LEASE_MS } from "../../modules/allegro/lib/constants"
import type { AllegroRunKind } from "../../modules/allegro/lib/contract"
import { releaseLease, takeLease } from "../../modules/allegro/lib/store"
import { allegroOf, errorText, sqlOf } from "./runtime"
import { syncAllegroOffersWorkflow } from "./sync-allegro-offers"
import { syncAllegroOrdersWorkflow } from "./sync-allegro-orders"
import { publishAllegroOffersWorkflow, pushAllegroPricesWorkflow, pushAllegroStockWorkflow, syncAllegroIssuesWorkflow } from "./writer-workflows"

/** The kinds the demo prepares, in this order (the plans need the offers first). */
export function demoSeedKinds(o: { ordersEnabled: boolean }): AllegroRunKind[] {
  return ["offers", ...(o.ordersEnabled ? (["orders"] as const) : []), "stock", "prices", "issues", "publish"]
}

/** The kinds that never ran, from the last run of each kind (as the status already reads them). */
export function missingDemoKinds(o: { ordersEnabled: boolean }, lastRuns: Partial<Record<AllegroRunKind, unknown>>): AllegroRunKind[] {
  return demoSeedKinds(o).filter((k) => !lastRuns[k])
}

async function ranKinds(svc: AllegroModuleService, kinds: readonly AllegroRunKind[]): Promise<Set<AllegroRunKind>> {
  const out = new Set<AllegroRunKind>()
  for (const kind of kinds) {
    const rows = (await svc.listAllegroSyncRuns({ kind } as never, { take: 1, select: ["id"] })) as unknown as Array<{ id: string }>
    if (rows.length > 0) out.add(kind)
  }
  return out
}

function runKind(container: MedusaContainer, kind: AllegroRunKind): Promise<unknown> {
  switch (kind) {
    case "offers":
      return syncAllegroOffersWorkflow(container).run({ input: { trigger: "auto" } })
    case "orders":
      return syncAllegroOrdersWorkflow(container).run({ input: { trigger: "auto" } })
    case "stock":
      return pushAllegroStockWorkflow(container).run({ input: { trigger: "auto", mode: "plan" } })
    case "prices":
      return pushAllegroPricesWorkflow(container).run({ input: { trigger: "auto", mode: "plan" } })
    case "issues":
      return syncAllegroIssuesWorkflow(container).run({ input: { trigger: "auto" } })
    case "publish":
      return publishAllegroOffersWorkflow(container).run({ input: { trigger: "auto", mode: "plan" } })
    default:
      return Promise.resolve(null)
  }
}

export interface DemoSeedResult {
  skipped: null | "not_demo" | "lease" | "done"
  ran: AllegroRunKind[]
  failed: AllegroRunKind[]
}

export async function seedDemo(container: MedusaContainer): Promise<DemoSeedResult> {
  const svc = allegroOf(container)
  if (!svc.isDemo()) return { skipped: "not_demo", ran: [], failed: [] }
  const kinds = demoSeedKinds(svc.getOptions())
  const ran = await ranKinds(svc, kinds)
  const todo = kinds.filter((k) => !ran.has(k))
  if (todo.length === 0) return { skipped: "done", ran: [], failed: [] }
  const sql = sqlOf(container)
  const owner = randomUUID()
  if (sql && !(await takeLease(sql, "demo-seed", owner, RUN_LEASE_MS).catch(() => true))) return { skipped: "lease", ran: [], failed: [] }
  const done: AllegroRunKind[] = []
  const failed: AllegroRunKind[] = []
  try {
    for (const kind of todo) {
      try {
        await runKind(container, kind)
        done.push(kind)
      } catch (err) {
        failed.push(kind)
        svc.getLogger().warn(`[allegro] demo data (${kind}): ${errorText(svc, err)}`)
      }
    }
  } finally {
    if (sql) await releaseLease(sql, "demo-seed", owner).catch(() => undefined)
  }
  return { skipped: null, ran: done, failed }
}
