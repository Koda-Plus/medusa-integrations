/**
 * DEMO MODE: the sample shipments, built once from the store's newest orders
 * (the first visit of the InPost page or the first status pass), and the
 * reset that starts the simulation over. Demo rows, their history and the
 * demo settings carry `demo` (or a `demo:` key) and are the only rows these
 * functions ever touch.
 */

import { DEMO_ROWS } from "../../modules/inpost/lib/constants"
import { demoRows, type DemoOrder } from "../../modules/inpost/lib/demo"
import type { EventRow, ParcelRow, SettingRow } from "../../modules/inpost/lib/dto"
import { inpostService, listEvents, listParcels, queryOf, storeFor, type Scope } from "./runtime"

export const DEMO_SEEDED_KEY = "demo:seeded"

/** Builds the demo rows once (an atomic claim of the `demo:seeded` key). Returns how many were built. */
export async function ensureDemoSeed(scope: Scope): Promise<number> {
  const svc = inpostService(scope)
  if (!svc.isDemo()) return 0
  const existing = await listParcels(svc, { demo: true }, { take: 1, select: ["id"] })
  if (existing.length > 0) return 0
  const { data } = await queryOf(scope).graph({
    entity: "order",
    fields: ["id", "display_id", "currency_code", "total", "created_at"],
    pagination: { take: DEMO_ROWS, order: { created_at: "DESC" } },
  })
  const orders = (data as DemoOrder[]).filter((o) => o && typeof o.id === "string")
  if (orders.length === 0) return 0
  const store = storeFor(scope)
  if (!(await store.claimSetting(DEMO_SEEDED_KEY, { at: new Date().toISOString(), orders: orders.length }))) return 0
  const rows = demoRows(orders, new Date())
  const created = (await svc.createInpostParcels(rows as never)) as unknown as ParcelRow[]
  for (const row of Array.isArray(created) ? created : [created]) {
    await store.insertEvent({
      parcel_id: row.id,
      order_id: row.order_id,
      shipment_id: row.shipment_id,
      kind: row.status ? "status" : "action",
      status: row.status,
      source: "demo",
      message: row.state === "skipped" ? "Sample: an order shipped outside Medusa (inpost_shipment in its metadata)." : row.status ? null : "Sample shipment waiting to be created.",
      data: row.status ? null : { action: "sample", outcome: row.state === "skipped" ? "skipped" : "pending" },
      demo: true,
      occurred_at: row.status_at ? new Date(row.status_at) : new Date(),
    })
  }
  svc.getLogger().info(`[inpost] Demo: ${rows.length} sample shipments built from the newest orders.`)
  return rows.length
}

/** Starts the simulation over: demo rows, their history and the demo settings go, the sample rows come back. */
export async function resetDemo(scope: Scope): Promise<number> {
  const svc = inpostService(scope)
  if (!svc.isDemo()) return 0
  for (;;) {
    const rows = await listParcels(svc, { demo: true }, { take: 500, select: ["id"] })
    if (rows.length === 0) break
    await svc.deleteInpostParcels(rows.map((r) => r.id))
  }
  for (;;) {
    const events = (await listEvents(svc, { demo: true }, { take: 500, select: ["id"] })) as EventRow[]
    if (events.length === 0) break
    await svc.deleteInpostParcelEvents(events.map((e) => e.id))
  }
  const settings = (await svc.listInpostSettings({}, { take: 500 } as never)) as unknown as SettingRow[]
  const demoKeys = settings.filter((s) => s.key.startsWith("demo:")).map((s) => s.id)
  if (demoKeys.length > 0) await svc.deleteInpostSettings(demoKeys)
  return ensureDemoSeed(scope)
}
