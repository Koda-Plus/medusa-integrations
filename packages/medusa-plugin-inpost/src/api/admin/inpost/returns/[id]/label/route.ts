import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { returnLabelOf } from "../../../../../../workflows/inpost/returns"
import { sendError, strParam } from "../../../helpers"

/**
 * GET /admin/inpost/returns/:id/label?download=1
 *
 * The A4 label PDF of a return created without a drop-off code, fetched
 * server side from the Returns API and streamed to the admin: the token never
 * reaches the browser. A return with a drop-off code has no label (409).
 * Generated, and marked as simulated, in demo mode.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const file = await returnLabelOf(req.scope, req.params.id)
    const disposition = strParam(req.query.download) === "1" ? "attachment" : "inline"
    res.setHeader("Content-Type", file.contentType)
    res.setHeader("Content-Disposition", `${disposition}; filename="${file.filename.replace(/"/g, "")}"`)
    res.setHeader("Cache-Control", "private, no-store")
    res.status(200).send(Buffer.from(file.data))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
