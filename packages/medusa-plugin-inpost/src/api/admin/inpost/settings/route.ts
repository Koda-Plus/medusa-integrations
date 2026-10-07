import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { settingsKey, validateSettingsInput } from "../../../../modules/inpost/lib/settings"
import { storeFor } from "../../../../workflows/inpost/runtime"
import { actorOf, buildStatus, inpostService, sendError } from "../helpers"

/**
 * POST /admin/inpost/settings
 *   { sender?: { companyName, firstName, lastName, email, phone, street, buildingNumber, flatNumber, city, postCode } | null,
 *     defaultParcelSize?: "small" | "medium" | "large", labelFormat?: "A6" | "A4" }
 *
 * The settings of the current mode (demo and live are kept apart), stored
 * with who changed them. A saved value wins over the option; `sender: null`
 * goes back to the option (or to the organization's data in InPost). Answers
 * the whole status.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse): Promise<void> {
  try {
    const svc = inpostService(req.scope)
    const checked = validateSettingsInput(req.body)
    if (!checked.ok) {
      res.status(400).json({ code: "invalid", message: `Check these fields: ${checked.errors.join(", ")}.`, fields: checked.errors })
      return
    }
    await storeFor(req.scope).setSetting(settingsKey(svc.isDemo()), checked.value, actorOf(req))
    svc.getLogger().info(`[inpost] settings (${svc.isDemo() ? "demo" : "live"}) changed by ${actorOf(req) ?? "unknown"}`)
    res.json(await buildStatus(req))
  } catch (err) {
    sendError(req.scope, res, err)
  }
}
