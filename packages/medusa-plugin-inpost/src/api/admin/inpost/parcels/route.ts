import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ParcelsResponse } from "../../../../modules/inpost/lib/contract"
import type { ParcelRow } from "../../../../modules/inpost/lib/dto"
import { inpostService, intParam, isFilter, parcelDtos, parcelFilters, searchFilter, sendError, strParam } from "../helpers"

/**
 * GET /admin/inpost/parcels?filter=to_create&q=&limit=20&offset=0
 *
 * The shipments of a Panel list (to_create, waiting, in_transit, in_locker,
 * delivered, problems, canceled, skipped, all), newest first, with a search
 * over the order number, the shipment id, the tracking number, the locker
 * and the reference.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const filter = isFilter(req.query.filter) ? req.query.filter : "all"
    const limit = intParam(req.query.limit, 20, 1, 100)
    const offset = intParam(req.query.offset, 0, 0, 100_000)
    const where = parcelFilters(filter, svc.isDemo())
    const search = searchFilter(strParam(req.query.q))
    const filters = search ? { $and: [where, search] } : where
    const [rows, count] = (await svc.listAndCountInpostParcels(filters as never, { take: limit, skip: offset, order: { created_at: "DESC" } } as never)) as unknown as [ParcelRow[], number]
    const body: ParcelsResponse = { parcels: parcelDtos(rows), count, limit, offset }
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
