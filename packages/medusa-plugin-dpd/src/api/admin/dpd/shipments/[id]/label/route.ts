import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { labelFileName } from "../../../../../../modules/dpd/lib/pdf"
import { formatMinor } from "../../../../../../modules/dpd/lib/money"
import { waybillsOf } from "../../../../../../modules/dpd/lib/dto"
import { labelShipment } from "../../../../../../workflows/dpd/create"
import { demoLabelBase64 } from "../../../../../../workflows/dpd/demo-client"
import { latestLabel } from "../../../../../../workflows/dpd/documents"
import { getShipmentOfMode, settingsOf } from "../../../../../../workflows/dpd/runtime"
import { ActionError, actorOf, bodyOf, dpdService, noStore, pageOf, respondShipment, sendError, shipmentIdOf, strParam } from "../../../helpers"

/**
 * POST /admin/dpd/shipments/:id/label  { "page": "A4" | "LBL_PRINTER" }  ->  ActionResponse
 *
 * Gets the label of a created shipment from DPD (one whose label did not
 * come with the create) and stores it. Needs the armed shipment writer: the
 * label advises the parcels in DPD.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  await respondShipment(req, res, async () => {
    const id = shipmentIdOf(req)
    const page = pageOf(bodyOf(req))
    return labelShipment(req.scope, id, { page, actor: actorOf(req), trigger: "manual" })
  })
}

/**
 * GET /admin/dpd/shipments/:id/label?download=1
 *
 * The stored label PDF (the newest), streamed from the database: nothing is
 * asked of DPD, so opening it again never advises the parcels again. 404
 * no_label when none is stored; in demo mode a sample PDF is built on the
 * fly instead (and not stored), for the seeded rows.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const svc = dpdService(req.scope)
    const row = await getShipmentOfMode(svc, shipmentIdOf(req))
    if (!row) throw new ActionError(404, "not_found", "No DPD shipment with this id in the current mode.")
    const waybills = waybillsOf(row.waybills)
    const stored = await latestLabel(req.scope, row.id)
    let data: string
    if (stored) {
      data = stored.data
    } else if (svc.isDemo()) {
      const page = (await settingsOf(svc)).labelPage
      const cod = row.cod_minor !== null && row.cod_minor !== undefined ? `${formatMinor(Number(row.cod_minor))} ${row.currency ?? ""}`.trim() : null
      data = demoLabelBase64({ reference: row.reference ?? row.fulfillment_id ?? null, waybills, cod }, page)
    } else {
      throw new ActionError(404, "no_label", "No stored label for this shipment.")
    }
    const prefix = row.display_id !== null && row.display_id !== undefined ? String(row.display_id) : (row.reference ?? row.id)
    const filename = labelFileName(prefix, waybills[0] ?? null)
    const disposition = strParam(req.query?.download) === "1" ? "attachment" : "inline"
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `${disposition}; filename="${filename.replace(/"/g, "")}"`)
    res.status(200).send(Buffer.from(data, "base64"))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
