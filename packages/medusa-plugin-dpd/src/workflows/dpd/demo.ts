/**
 * DEMO MODE: the sample shipments, built once from the store's newest orders
 * (POST /admin/dpd/demo/seed, which the page asks for on its first visit),
 * and the reset that removes them. Demo rows carry `mode: "demo"` and demo
 * settings a `demo:` key; they are the only rows these functions touch.
 * Reads never seed.
 */

import { DEMO_ROWS } from "../../modules/dpd/lib/constants"
import type { DemoResetResponse } from "../../modules/dpd/lib/contract"
import { DEMO_SEED_SOURCE, demoMessage, demoRows, type DemoOrder } from "../../modules/dpd/lib/demo"
import type { SettingRow, ShipmentRow } from "../../modules/dpd/lib/dto"
import { DEMO_SEEDED_KEY, modeKeyPrefix } from "../../modules/dpd/lib/settings"
import type DpdModuleService from "../../modules/dpd/service"
import { dpdService, queryOf, storeFor, type Scope } from "./runtime"

const BATCH = 500

/**
 * Builds the demo rows once: the first caller claims the `demo:seeded` key
 * in one statement, so two tabs opening the page build one set. Returns how
 * many rows were built (0 outside demo mode, without orders, or when they
 * were built before). Nothing is sent to DPD.
 *
 * A build that fails half way gives the claim back: the rows it built are
 * removed (with their history) and the key is deleted for good, so the next
 * visit builds the whole set instead of finding the demo seeded and half
 * empty. When those rows cannot all be removed the key stays claimed, so no
 * second set is built beside what is left, and the log asks for a Reset of
 * the demo. The error is thrown again for the route to answer.
 */
export async function ensureDemoSeed(scope: Scope): Promise<number> {
  const svc = dpdService(scope)
  if (!svc.isDemo()) return 0
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: ["id", "display_id", "currency_code", "created_at"],
    pagination: { take: DEMO_ROWS, order: { created_at: "DESC" } },
  })
  const listed = (data as DemoOrder[]).filter((o) => o && typeof o.id === "string")
  /* No orders: nothing claimed, so the next visit tries again once the store has some. */
  if (listed.length === 0) return 0
  const store = storeFor(scope)
  if (!(await store.claimSetting(DEMO_SEEDED_KEY, { at: new Date().toISOString(), orders: listed.length }))) return 0
  const built: string[] = []
  try {
    return await buildDemoRows(scope, svc, listed, built)
  } catch (err) {
    try {
      if (built.length > 0) {
        const events = (await svc.listDpdEvents({ shipment_id: built } as never, { take: built.length * 4, select: ["id"] } as never)) as unknown as Array<{ id: string }>
        if (events.length > 0) await svc.deleteDpdEvents(events.map((e) => e.id))
        await svc.deleteDpdShipments(built)
      }
    } catch (cleanup) {
      /* Rows are left: the key stays claimed, so the next visit does not build a second set beside them. */
      svc
        .getLogger()
        .error(
          `[dpd] Demo: the sample rows of a failed build could not all be removed, so the demo stays marked as built; reset the demo to remove what is left and build it again: ${svc.mask((cleanup as Error)?.message ?? String(cleanup))}`,
        )
      throw err
    }
    try {
      await store.releaseSetting(DEMO_SEEDED_KEY)
    } catch (release) {
      svc.getLogger().error(`[dpd] Demo: the seed key could not be released after a failed build; reset the demo to build it again: ${svc.mask((release as Error)?.message ?? String(release))}`)
    }
    throw err
  }
}

/** The sample rows and their history; the id of every row built goes into `built` as soon as it exists. */
async function buildDemoRows(scope: Scope, svc: DpdModuleService, listed: DemoOrder[], built: string[]): Promise<number> {
  const store = storeFor(scope)
  /* Totals one order at a time: Medusa refuses the totals of an order whose shipping method has no
     version (some orders imported by other plugins), and in one query that failed the whole demo.
     Without a total a sample has no cash on delivery amount. */
  const orders: DemoOrder[] = []
  for (const order of listed) {
    let total: unknown = null
    try {
      const { data: one } = await queryOf(scope).graph({ entity: "order", fields: ["id", "total"], filters: { id: order.id } })
      total = (one as Array<{ total?: unknown }>)[0]?.total ?? null
    } catch {
      total = null
    }
    orders.push({ ...order, total })
  }
  /* Oldest first, so the newest order is also the newest row of the Panel. */
  const rows = demoRows(orders, new Date()).reverse()
  for (const draft of rows) {
    const created = (await svc.createDpdShipments(draft as never)) as unknown as ShipmentRow
    built.push(created.id)
    await store.insertEvent({
      shipment_id: created.id,
      order_id: created.order_id,
      kind: "action",
      source: DEMO_SEED_SOURCE,
      message: demoMessage(draft),
      data: { action: "sample", state: draft.state, stage: draft.stage },
      dedupe_key: `demo:seed:${created.id}`,
      mode: "demo",
      occurred_at: draft.last_checked_at ?? new Date(),
    })
  }
  svc.getLogger().info(`[dpd] Demo: ${rows.length} sample shipments built from the newest orders.`)
  return rows.length
}

async function removeAll(list: () => Promise<Array<{ id: string }>>, remove: (ids: string[]) => Promise<unknown>): Promise<number> {
  let removed = 0
  for (;;) {
    const rows = await list()
    if (rows.length === 0) return removed
    await remove(rows.map((r) => r.id))
    removed += rows.length
  }
}

/**
 * Removes the demo: every row of mode `demo` (shipments, documents,
 * history, handovers) and every `demo:` setting (the seed marker, the demo
 * writer toggles and settings). Sandbox and live rows are never touched.
 * The page builds the sample rows again on its next visit.
 */
export async function resetDemo(scope: Scope): Promise<DemoResetResponse["removed"]> {
  const svc: DpdModuleService = dpdService(scope)
  const removed: DemoResetResponse["removed"] = { shipments: 0, documents: 0, events: 0, dispatches: 0, settings: 0 }
  if (!svc.isDemo()) return removed
  const demo = { mode: "demo" }
  const page = { take: BATCH, select: ["id"] }
  removed.shipments = await removeAll(
    async () => (await svc.listDpdShipments(demo as never, page as never)) as unknown as Array<{ id: string }>,
    (ids) => svc.deleteDpdShipments(ids),
  )
  removed.documents = await removeAll(
    async () => (await svc.listDpdDocuments(demo as never, page as never)) as unknown as Array<{ id: string }>,
    (ids) => svc.deleteDpdDocuments(ids),
  )
  removed.events = await removeAll(
    async () => (await svc.listDpdEvents(demo as never, page as never)) as unknown as Array<{ id: string }>,
    (ids) => svc.deleteDpdEvents(ids),
  )
  removed.dispatches = await removeAll(
    async () => (await svc.listDpdDispatches(demo as never, page as never)) as unknown as Array<{ id: string }>,
    (ids) => svc.deleteDpdDispatches(ids),
  )
  const prefix = modeKeyPrefix("demo")
  const settings = (await svc.listDpdSettings({ key: { $ilike: `${prefix}%` } } as never, { take: BATCH } as never)) as unknown as SettingRow[]
  const demoKeys = settings.filter((s) => typeof s.key === "string" && s.key.startsWith(prefix)).map((s) => s.id)
  if (demoKeys.length > 0) await svc.deleteDpdSettings(demoKeys)
  removed.settings = demoKeys.length
  svc.getLogger().info(
    `[dpd] Demo reset: ${removed.shipments} shipments, ${removed.documents} documents, ${removed.events} history rows, ${removed.dispatches} handovers, ${removed.settings} settings removed.`,
  )
  return removed
}
