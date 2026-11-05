import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { dispatchView } from "../../../../../../workflows/dpd/dispatch"
import { latestProtocol, protocolById } from "../../../../../../workflows/dpd/documents"
import { ActionError, SHIPMENT_ID, dispatchIdOf, noStore, sendError, strParam } from "../../../helpers"

/** dpd-protocol-<documentId or dispatch id>.pdf, only letters, digits, "_" and "-". */
function protocolFileName(name: string): string {
  return `dpd-protocol-${name.replace(/[^A-Za-z0-9_-]/g, "")}.pdf`
}

/**
 * GET /admin/dpd/dispatches/:id/protocol?download=1&document=<id>
 *
 * A stored protocol PDF of the dispatch: the newest entry of its protocols,
 * or the one named by document. Only documents listed in the dispatch are
 * served (never an orphan of a lost claim, E6). Never calls DPD and never
 * builds a PDF on the fly, also in demo. The PDF names the receivers'
 * companies and addresses: private, no-store.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  noStore(res)
  try {
    const view = await dispatchView(req.scope, dispatchIdOf(req))
    const docId = strParam(req.query?.document)
    if (docId && !SHIPMENT_ID.test(docId)) throw new ActionError(400, "invalid", "The document id is not valid.")
    const doc = docId ? await protocolById(req.scope, view.dispatch, docId) : await latestProtocol(req.scope, view.dispatch)
    if (!doc) throw new ActionError(404, "not_found", "No stored protocol for this dispatch (not printed yet, or removed after documentRetentionDays).")
    const disposition = strParam(req.query?.download) === "1" ? "attachment" : "inline"
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `${disposition}; filename="${protocolFileName(doc.document_id ?? view.dispatch.id)}"`)
    res.status(200).send(Buffer.from(doc.data, "base64"))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
