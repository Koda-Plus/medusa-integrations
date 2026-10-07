import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import type { CheckResult } from "../../../../modules/inpost/lib/contract"
import { describeError } from "../../../../modules/inpost/lib/errors"
import { clientFor } from "../../../../workflows/inpost/runtime"
import { inpostService, rememberCheck, sendError } from "../helpers"

/**
 * POST /admin/inpost/check
 *
 * Checks the token and the organization: GET /v1/organizations/:id (a read).
 * Answers what ShipX says (the organization's name, status and services) or
 * why it refused (401: not a ShipX token, for example the Geowidget one;
 * 403: an organization the token does not belong to). Demo mode answers
 * without a request.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const checkedAt = new Date().toISOString()
    let result: CheckResult
    if (svc.isDemo()) {
      result = { ok: true, mode: "demo", checkedAt, error: null, organization: { id: "demo", name: "Koda Supply (demo)", status: "active", services: ["inpost_locker_standard", "inpost_courier_standard"] } }
    } else if (!svc.isConfigured()) {
      result = { ok: false, mode: "live", checkedAt, error: `Missing options: ${svc.missingOptions().join(", ")}.`, organization: null }
    } else {
      try {
        const org = await clientFor(req.scope).getOrganization()
        result = {
          ok: true,
          mode: "live",
          checkedAt,
          error: null,
          organization: { id: String(org.id), name: org.name ?? null, status: org.status ?? null, services: Array.isArray(org.services) ? org.services.slice(0, 30) : [] },
        }
      } catch (err) {
        result = { ok: false, mode: "live", checkedAt, error: svc.mask(describeError(err).message), organization: null }
      }
    }
    rememberCheck(result)
    res.json({ result })
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
