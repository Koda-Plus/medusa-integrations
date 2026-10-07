/**
 * RETURNS FROM BASELINKER, READ ONLY: the return manager of the last
 * `returnsWindowDays` days (30 by default), linked to the Medusa order when
 * the BaseLinker order is one this plugin sent or imported.
 *
 * `getOrderReturns` from `date_from`, 100 per page, paging by `id_from` (the
 * highest return id plus one), at most 20 pages. Status names from
 * `getOrderReturnStatusList`, reason names from `getOrderReturnReasonsList`.
 * The parser in `lib/returns.ts` drops every personal field before anything
 * is stored. Nothing is ever written to BaseLinker or to the Medusa order.
 */

import type BaseLinkerModuleService from "../../modules/baselinker/service"
import { ORDERS_PAGE_SIZE, RETURNS_MAX_PAGES } from "../../modules/baselinker/lib/constants"
import type { RunTrigger } from "../../modules/baselinker/lib/contract"
import { DEMO_RETURN_REASONS, DEMO_RETURN_STATUSES, demoReturns, type DemoReturnSource } from "../../modules/baselinker/lib/demo-marketplace"
import type { ImportRow, OrderRow, ReturnRow } from "../../modules/baselinker/lib/dto"
import { describeAnyError } from "../../modules/baselinker/lib/errors"
import { canReadReturns } from "../../modules/baselinker/lib/options"
import { parseReturns, type ReturnRecord } from "../../modules/baselinker/lib/returns"
import { baselinkerService, clientFor, exclusive, recordRun, type Scope } from "./runtime"

export interface ReturnsStats {
  pages: number
  read: number
  created: number
  updated: number
  linked: number
  complete: boolean
}

/** Orders of ours the simulated return manager can know: imported ones and sent ones. */
async function demoSources(svc: BaseLinkerModuleService): Promise<DemoReturnSource[]> {
  const imports = (await svc.listBaseLinkerImports({ demo: true, status: "imported" } as never, { take: 200 } as never)) as unknown as ImportRow[]
  const sent = (await svc.listBaseLinkerOrders({ demo: true, status: "sent" } as never, { take: 200 } as never)) as unknown as OrderRow[]
  const lines = (name: string, total: number | null) => [{ name, sku: null, price: total ?? 49.99, quantity: 1 }]
  return [
    ...imports.map((r) => ({
      blOrderId: r.bl_order_id,
      source: r.source,
      at: new Date(r.confirmed_at ?? r.created_at ?? Date.now()),
      lines: lines(`Zamówienie ${r.source} ${r.bl_order_id}`, typeof r.total_minor === "number" ? Math.round(r.total_minor) / 100 : null),
    })),
    ...sent
      .filter((r) => r.bl_order_id)
      .map((r) => ({ blOrderId: r.bl_order_id as string, source: "personal", at: new Date(r.sent_at ?? r.created_at ?? Date.now()), lines: lines(`Zamówienie #${r.display_id ?? r.order_id}`, null) })),
  ]
}

async function readLive(svc: BaseLinkerModuleService, stats: ReturnsStats): Promise<{ records: ReturnRecord[]; statuses: Map<number, string> }> {
  const o = svc.getOptions()
  const client = clientFor(svc)
  const statuses = await client.getOrderReturnStatusList()
  const reasons = await client.getOrderReturnReasonsList()
  const from = Math.floor(Date.now() / 1000) - o.returnsWindowDays * 24 * 3600
  const raw: Record<string, unknown>[] = []
  let idFrom: number | undefined
  stats.complete = false
  for (let page = 1; page <= RETURNS_MAX_PAGES; page += 1) {
    const params: Record<string, unknown> = { date_from: from }
    if (idFrom !== undefined) params.id_from = idFrom
    const list = await client.getOrderReturns(params)
    stats.pages += 1
    raw.push(...list)
    if (list.length < ORDERS_PAGE_SIZE) {
      stats.complete = true
      break
    }
    const highest = Math.max(...list.map((r) => Number(r.return_id) || 0))
    if (!(highest > 0)) break
    idFrom = highest + 1
  }
  return { records: parseReturns(raw, reasons), statuses }
}

/** Reads the returns of the window and refreshes the snapshot. One read per process at a time. */
export async function syncReturns(scope: Scope, trigger: RunTrigger): Promise<ReturnsStats | null> {
  return exclusive(scope, "returns", async () => {
    const svc = baselinkerService(scope)
    const o = svc.getOptions()
    const stats: ReturnsStats = { pages: 0, read: 0, created: 0, updated: 0, linked: 0, complete: true }
    if (!canReadReturns(o)) return stats
    const startedAt = new Date()
    let records: ReturnRecord[]
    let statuses: Map<number, string>
    try {
      if (o.demo) {
        statuses = new Map(DEMO_RETURN_STATUSES.map((s) => [s.id, s.name]))
        records = parseReturns(demoReturns(await demoSources(svc), new Date()), new Map(DEMO_RETURN_REASONS.map((r) => [r.return_reason_id, r.name])))
        stats.pages = 1
      } else {
        ;({ records, statuses } = await readLive(svc, stats))
      }
    } catch (err) {
      const message = svc.mask(describeAnyError(err).message)
      await recordRun(svc, { kind: "returns", trigger, status: "error", startedAt, message })
      return stats
    }
    stats.read = records.length

    /* Our orders behind the returns: sent by the outbox or imported. */
    const blIds = [...new Set(records.map((r) => r.blOrderId).filter((x): x is string => Boolean(x)))]
    const sent = blIds.length
      ? ((await svc.listBaseLinkerOrders({ bl_order_id: blIds, demo: o.demo } as never, { take: blIds.length } as never)) as unknown as OrderRow[])
      : []
    const imported = blIds.length
      ? ((await svc.listBaseLinkerImports({ bl_order_id: blIds, demo: o.demo } as never, { take: blIds.length } as never)) as unknown as ImportRow[])
      : []
    const orderOf = new Map<string, { orderId: string | null; displayId: number | null }>()
    for (const r of sent) if (r.bl_order_id) orderOf.set(r.bl_order_id, { orderId: r.order_id, displayId: r.display_id })
    for (const r of imported) if (r.order_id) orderOf.set(r.bl_order_id, { orderId: r.order_id, displayId: r.display_id })

    const existing = (await svc.listBaseLinkerReturns({ bl_return_id: records.map((r) => r.blReturnId), demo: o.demo } as never, {
      take: records.length + 1,
    } as never)) as unknown as ReturnRow[]
    const byId = new Map(existing.map((r) => [r.bl_return_id, r]))
    for (const rec of records) {
      const order = rec.blOrderId ? orderOf.get(rec.blOrderId) : undefined
      if (order?.orderId) stats.linked += 1
      const data = {
        bl_return_id: rec.blReturnId,
        bl_order_id: rec.blOrderId,
        order_id: order?.orderId ?? null,
        display_id: order?.displayId ?? null,
        source: rec.source,
        external_return_id: rec.externalReturnId,
        status_id: rec.statusId,
        status_name: rec.statusId !== null ? statuses.get(rec.statusId) ?? null : null,
        fulfillment_status: rec.fulfillmentStatus,
        refunded_minor: rec.refundedMinor,
        currency: rec.currency,
        products: rec.products,
        created_in_bl_at: rec.createdAt,
        status_changed_at: rec.statusChangedAt,
        demo: o.demo,
      }
      const row = byId.get(rec.blReturnId)
      if (!row) {
        try {
          await svc.createBaseLinkerReturns(data as never)
          stats.created += 1
        } catch {
          /* written by a parallel read: the next one updates it */
        }
      } else if (row.status_id !== data.status_id || row.order_id !== data.order_id || row.refunded_minor !== data.refunded_minor) {
        await svc.updateBaseLinkerReturns({ id: row.id, ...data } as never)
        stats.updated += 1
      }
    }

    if (stats.created + stats.updated > 0 || trigger === "manual" || !stats.complete) {
      await recordRun(svc, {
        kind: "returns",
        trigger,
        status: stats.complete ? "ok" : "partial",
        complete: stats.complete,
        startedAt,
        counts: { ...stats },
        message: `${stats.read} return(s) read, ${stats.created} new, ${stats.updated} changed, ${stats.linked} linked to Medusa orders.${
          stats.complete ? "" : ` Stopped at ${RETURNS_MAX_PAGES} pages.`
        }`,
      })
    }
    return stats
  })
}
