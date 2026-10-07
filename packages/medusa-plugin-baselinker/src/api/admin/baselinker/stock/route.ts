import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { StockResponse } from "../../../../modules/baselinker/lib/contract"
import { toStockChangeDto, type StockChangeRow } from "../../../../modules/baselinker/lib/dto"
import { lastRun } from "../../../../workflows/baselinker/runtime"
import { baselinkerService, guarded, intParam, like, strParam } from "../helpers"

/**
 * GET /admin/baselinker/stock?q=&limit=&offset=
 *
 * The current stock plan: every inventory level BaseLinker would change, with
 * Medusa stocked and reserved, the BaseLinker number, the target and the
 * units. Decreases first. In `plan` mode nothing of it was written.
 */
export const GET = guarded(async (req: MedusaRequest, res: MedusaResponse): Promise<void> => {
  const svc = baselinkerService(req.scope)
  const o = svc.getOptions()
  const demo = svc.isDemo()
  const limit = intParam(req.query.limit, 20, 1, 100)
  const offset = intParam(req.query.offset, 0, 0, 1_000_000)
  const q = strParam(req.query.q).slice(0, 80)

  const where: Record<string, unknown> = { demo }
  if (q) {
    const pattern = like(q)
    where.$or = [{ sku: { $ilike: pattern } }, { product_title: { $ilike: pattern } }, { bl_product_id: { $ilike: pattern } }]
  }
  const [rows, count] = (await svc.listAndCountBaseLinkerStockChanges(where as never, {
    take: limit,
    skip: offset,
    order: { delta: "ASC", sku: "ASC" },
  } as never)) as unknown as [StockChangeRow[], number]

  const all = (await svc.listBaseLinkerStockChanges({ demo } as never, { take: null, select: ["delta", "status"] } as never)) as unknown as Array<{
    delta: number
    status: string
  }>
  const summary = { changes: all.length, unitsAdded: 0, unitsRemoved: 0, applied: 0, overCap: 0 }
  for (const c of all) {
    if (c.delta > 0) summary.unitsAdded += c.delta
    else summary.unitsRemoved -= c.delta
    if (c.status === "applied") summary.applied += 1
    if (c.status === "over_cap") summary.overCap += 1
  }

  const body: StockResponse = {
    mode: demo ? "demo" : "live",
    stockSync: o.stockSync,
    run: await lastRun(svc, "stock"),
    changes: rows.map(toStockChangeDto),
    count,
    limit,
    offset,
    summary,
  }
  res.json(body)
})
