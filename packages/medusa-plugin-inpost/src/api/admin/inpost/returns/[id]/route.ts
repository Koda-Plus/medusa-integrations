import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { ReturnDetailResponse } from "../../../../../modules/inpost/lib/contract"
import { toReturnDto } from "../../../../../modules/inpost/lib/returns"
import { actorNames, getReturnOfMode, listEvents } from "../../../../../workflows/inpost/runtime"
import { eventDtos, inpostService, sendError } from "../../helpers"

/**
 * GET /admin/inpost/returns/:id
 *
 * One InPost return with its history. Rows of the other mode answer 404.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const row = await getReturnOfMode(svc, req.params.id)
    if (!row) {
      res.status(404).json({ code: "not_found", message: "No InPost return with this id in the current mode." })
      return
    }
    const events = await listEvents(svc, { parcel_id: row.id }, { take: 50, order: { occurred_at: "DESC" } })
    const dto = toReturnDto(row)
    if (dto.createdBy) dto.createdBy = (await actorNames(req.scope, [dto.createdBy]))[dto.createdBy] ?? dto.createdBy
    const body: ReturnDetailResponse = { return: dto, events: await eventDtos(req.scope, events) }
    res.setHeader("Cache-Control", "private, no-store")
    res.json(body)
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
