import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { labelSize } from "../../../../../../modules/inpost/lib/options"
import { labelOf } from "../../../../../../workflows/inpost/parcels"
import { sendError, strParam } from "../../../helpers"

/**
 * GET /admin/inpost/parcels/:id/label?size=A6|A4&download=1
 *
 * The label PDF, fetched server side from ShipX and streamed to the admin:
 * the ShipX token never reaches the browser. ShipX hands out a label from
 * `confirmed` on; until then this answers 409. A4 is ShipX's `normal`; a
 * courier label exists only as A6. Generated in demo mode.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const file = await labelOf(req.scope, req.params.id, labelSize(strParam(req.query.size)))
    const disposition = strParam(req.query.download) === "1" ? "attachment" : "inline"
    res.setHeader("Content-Type", file.contentType)
    res.setHeader("Content-Disposition", `${disposition}; filename="${file.filename.replace(/"/g, "")}"`)
    res.setHeader("Cache-Control", "private, no-store")
    res.status(200).send(Buffer.from(file.data))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
