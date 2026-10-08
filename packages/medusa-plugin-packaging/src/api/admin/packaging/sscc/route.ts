import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { formatSscc, makeSscc, ssccPayload } from "../../../../modules/packaging/lib/packaging"
import { packagingSvc } from "../../../../modules/packaging/lib/store"
import { fail } from "../../../packaging/helpers"

/**
 * GET /admin/packaging/sscc?serial=...
 *
 * Builds the SSCC label number of a pallet from the store's GS1 prefix and
 * a serial: the 18-digit SSCC, its human grouping and the GS1-128 payload
 * for the label. Pure, nothing is written.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  const options = packagingSvc(req.scope).getOptions()
  const serial = String((req.query as Record<string, unknown>).serial ?? "").trim()
  const digits = serial.replace(/\D/g, "")
  if (!digits) {
    fail(res, 400, "serial_required", "Enter a serial for the label.")
    return
  }
  const sscc = makeSscc(options.gs1Prefix, digits)
  res.setHeader("Cache-Control", "private, no-store")
  res.json({
    sscc,
    formatted: formatSscc(sscc),
    payload: ssccPayload(sscc),
    prefix: options.gs1Prefix,
  })
}
